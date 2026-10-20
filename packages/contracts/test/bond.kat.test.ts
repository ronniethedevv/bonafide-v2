// KAT (M3): postBond takes real shielded custody; release / void / slash move
// real value out of escrow.
//
// The runtime simulates Zswap: postBond's receiveShielded shows up as an output to
// the contract and the coin is stored as a contract-owned qualified coin; a payout
// spends that coin (a Zswap input) and creates an output to the recipient, with the
// change returned to escrow as a fresh contract-owned coin.
//
// The bond lives in the epoch_proof contract (DD-17), so every run starts from a
// registered engagement; releases need a settled epoch (H3b).

import { beforeAll, describe, expect, it } from "vitest";
import {
  BLOCK_TIME, BOND_CALLER_PK, BOND_COIN, CLIENT_PK, HAVE_BUILD, Status, T, TIER_MIN,
  buildScenario, epochEndOf, graceDeadlineOf, runLifecycle, runRegister, runningEngagement, settle,
  type BondRun, type CoinW, type Engagement, type Registered,
} from "./harness.js";

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
/** Value sent to a user key (left) by this call. */
const sentTo = (r: BondRun, pk: Uint8Array) =>
  r.outputs.filter((o) => o.recipient.is_left && eq(o.recipient.left.bytes, pk)).reduce((a, o) => a + o.coinInfo.value, 0n);
/** Value returned to the contract (right) by this call: escrow change. */
const toContract = (r: BondRun) =>
  r.outputs.filter((o) => !o.recipient.is_left).reduce((a, o) => a + o.coinInfo.value, 0n);

describe.skipIf(!HAVE_BUILD)("M3: bond takes real shielded custody", () => {
  let reg: Registered;
  let g: Engagement;
  /** Ledger with epoch 1 settled at its end; `releaseAt` is when its challenge window closes. */
  let settled: BondRun["state"];
  let releaseAt: bigint;
  beforeAll(async () => {
    reg = await runRegister(buildScenario().witness, new Uint8Array(32).fill(0x99));
    g = await runningEngagement({ proven: 1 });
    const end = epochEndOf(g, 1n);
    settled = (await settle(g, g.state, 1n, end)).state;
    releaseAt = end + T.CHALLENGE;
  });
  const post = (coin: CoinW = BOND_COIN, state = reg.state) =>
    runLifecycle("postBond", [reg.id, TIER_MIN, { bytes: CLIENT_PK }], { coin, state });
  const release = (amount: bigint, state = settled) =>
    runLifecycle("releaseEpoch", [g.id, 1n, amount], { state, blockTime: releaseAt });

  it("posting escrows the coin: received into the contract, held as a qualified coin", async () => {
    const r = await post();
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0]!.recipient.is_left).toBe(false); // to the contract itself
    expect(r.outputs[0]!.coinInfo.value).toBe(1_000n);
    expect(r.escrowed).toMatchObject({ value: 1_000n, color: BOND_COIN.color, nonce: BOND_COIN.nonce });
  });

  it("rejects a bond below the tier minimum, a second bond, and a bond for an unregistered id", async () => {
    await expect(post({ ...BOND_COIN, value: TIER_MIN - 1n })).rejects.toThrow(/bond below tier minimum/);
    const { state } = await post();
    await expect(post({ ...BOND_COIN, nonce: new Uint8Array(32).fill(8) }, state)).rejects.toThrow(/bond already posted/);
    await expect(runLifecycle("postBond", [new Uint8Array(32).fill(0x42), 0n, { bytes: CLIENT_PK }],
      { coin: BOND_COIN, state: reg.state })).rejects.toThrow(/engagement not open for a bond/);
  });

  it("release returns value to the owner; change stays escrowed; draining empties escrow", async () => {
    const r1 = await release(400n);
    expect(r1.inputs.map((c) => c.value)).toEqual([1_000n]); // the escrowed coin is spent
    expect(sentTo(r1, BOND_CALLER_PK)).toBe(400n);
    expect(toContract(r1)).toBe(600n);
    expect(r1.escrowed?.value).toBe(600n);

    const r2 = await release(600n, r1.state);
    expect(sentTo(r2, BOND_CALLER_PK)).toBe(600n);
    expect(r2.escrowed).toBeUndefined();
  });

  it("rejects a release of more than is escrowed", async () => {
    await expect(release(1_001n)).rejects.toThrow(/release exceeds escrow \(M3\)/);
    const r1 = await release(400n);
    await expect(release(601n, r1.state)).rejects.toThrow(/release exceeds escrow \(M3\)/);
  });

  it("slash redirects the whole bond to the beneficiary; no later release", async () => {
    const r = await runLifecycle("defaultEngagement", [g.id, 2n], { state: settled, blockTime: graceDeadlineOf(g, 2n) });
    expect(sentTo(r, CLIENT_PK)).toBe(1_000n);
    expect(sentTo(r, BOND_CALLER_PK)).toBe(0n);
    expect(r.escrowed).toBeUndefined();
    expect(r.slashed).toBe(true);
    expect(r.status).toBe(Status.Defaulted);
    await expect(runLifecycle("releaseEpoch", [g.id, 1n, 1n], { state: r.state, blockTime: graceDeadlineOf(g, 2n) }))
      .rejects.toThrow(/already slashed/);
  });

  it("slash after a partial release takes only what is still escrowed", async () => {
    const r1 = await release(300n);
    const r2 = await runLifecycle("defaultEngagement", [g.id, 2n], { state: r1.state, blockTime: graceDeadlineOf(g, 2n) });
    expect(sentTo(r2, CLIENT_PK)).toBe(700n);
  });

  it("void returns the whole bond to the owner", async () => {
    const { state } = await post();
    const r = await runLifecycle("voidUnfunded", [reg.id], { state, blockTime: BLOCK_TIME + T.FUNDING });
    expect(sentTo(r, BOND_CALLER_PK)).toBe(1_000n);
    expect(r.escrowed).toBeUndefined();
    expect(r.status).toBe(Status.Voided);
  });
});
