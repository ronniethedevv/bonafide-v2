// KAT (M3): bond.postBond takes real shielded custody; release / void / slash move
// real value out of escrow.
//
// The runtime simulates Zswap: postBond's receiveShielded shows up as an output to
// the contract and the coin is stored as a contract-owned qualified coin; a payout
// spends that coin (a Zswap input) and creates an output to the recipient, with the
// change returned to escrow as a fresh contract-owned coin.

import { describe, expect, it } from "vitest";
import { BOND_CALLER_PK, HAVE_BOND_BUILD, runBond, runBondGate, type BondRun, type CoinW } from "./harness.js";

const ID = new Uint8Array(32).fill(0x42);
const CLIENT = new Uint8Array(32).fill(0xbe); // slash beneficiary
const COIN: CoinW = { nonce: new Uint8Array(32).fill(7), color: new Uint8Array(32).fill(3), value: 1_000n };
const TIER_MIN = 500n;
const SETTLED = 1_700_000_000n;
const AFTER_CHALLENGE = SETTLED + 43_200n;
const AFTER_PROVING = SETTLED + 86_400n;
const AFTER_FUNDING = SETTLED + 259_200n;

const post = (coin: CoinW = COIN, state?: BondRun["state"]) =>
  runBond("postBond", [ID, TIER_MIN, { bytes: CLIENT }], { coin, state });
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
/** Value sent to a user key (left) by this call. */
const sentTo = (r: BondRun, pk: Uint8Array) =>
  r.outputs.filter((o) => o.recipient.is_left && eq(o.recipient.left.bytes, pk)).reduce((a, o) => a + o.coinInfo.value, 0n);
/** Value returned to the contract (right) by this call: escrow change. */
const toContract = (r: BondRun) =>
  r.outputs.filter((o) => !o.recipient.is_left).reduce((a, o) => a + o.coinInfo.value, 0n);

describe.skipIf(!HAVE_BOND_BUILD)("M3: bond takes real shielded custody", () => {
  it("posting escrows the coin: received into the contract, held as a qualified coin", async () => {
    const r = await post();
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0]!.recipient.is_left).toBe(false); // to the contract itself
    expect(r.outputs[0]!.coinInfo.value).toBe(1_000n);
    expect(r.escrowed).toMatchObject({ value: 1_000n, color: COIN.color, nonce: COIN.nonce });
  });

  it("rejects a bond below the tier minimum and a second bond for the same engagement", async () => {
    await expect(post({ ...COIN, value: TIER_MIN - 1n })).rejects.toThrow(/bond below tier minimum/);
    const { state } = await post();
    await expect(post({ ...COIN, nonce: new Uint8Array(32).fill(8) }, state)).rejects.toThrow(/bond already posted/);
  });

  it("release returns value to the owner; change stays escrowed; draining empties escrow", async () => {
    const { state } = await post();
    const r1 = await runBondGate("releaseEpoch", ID, SETTLED, AFTER_CHALLENGE, { state, amount: 400n });
    expect(r1.inputs.map((c) => c.value)).toEqual([1_000n]); // the escrowed coin is spent
    expect(sentTo(r1, BOND_CALLER_PK)).toBe(400n);
    expect(toContract(r1)).toBe(600n);
    expect(r1.escrowed?.value).toBe(600n);

    const r2 = await runBondGate("releaseEpoch", ID, SETTLED, AFTER_CHALLENGE, { state: r1.state, amount: 600n });
    expect(sentTo(r2, BOND_CALLER_PK)).toBe(600n);
    expect(r2.escrowed).toBeUndefined();
  });

  it("rejects a release of more than is escrowed", async () => {
    const { state } = await post();
    await expect(runBondGate("releaseEpoch", ID, SETTLED, AFTER_CHALLENGE, { state, amount: 1_001n }))
      .rejects.toThrow(/release exceeds escrow \(M3\)/);
    const r1 = await runBondGate("releaseEpoch", ID, SETTLED, AFTER_CHALLENGE, { state, amount: 400n });
    await expect(runBondGate("releaseEpoch", ID, SETTLED, AFTER_CHALLENGE, { state: r1.state, amount: 601n }))
      .rejects.toThrow(/release exceeds escrow \(M3\)/);
  });

  it("slash redirects the whole bond to the beneficiary; no later release", async () => {
    const { state } = await post();
    const r = await runBondGate("defaultEngagement", ID, SETTLED, AFTER_PROVING, { state });
    expect(sentTo(r, CLIENT)).toBe(1_000n);
    expect(sentTo(r, BOND_CALLER_PK)).toBe(0n);
    expect(r.escrowed).toBeUndefined();
    expect(r.slashed).toBe(true);
    await expect(runBondGate("releaseEpoch", ID, SETTLED, AFTER_CHALLENGE + 86_400n, { state: r.state, amount: 1n }))
      .rejects.toThrow(/already slashed/);
  });

  it("slash after a partial release takes only what is still escrowed", async () => {
    const { state } = await post();
    const r1 = await runBondGate("releaseEpoch", ID, SETTLED, AFTER_CHALLENGE, { state, amount: 300n });
    const r2 = await runBondGate("defaultEngagement", ID, SETTLED, AFTER_PROVING, { state: r1.state });
    expect(sentTo(r2, CLIENT)).toBe(700n);
  });

  it("void returns the whole bond to the owner", async () => {
    const { state } = await post();
    const r = await runBondGate("voidUnfunded", ID, SETTLED, AFTER_FUNDING, { state });
    expect(sentTo(r, BOND_CALLER_PK)).toBe(1_000n);
    expect(r.escrowed).toBeUndefined();
  });
});
