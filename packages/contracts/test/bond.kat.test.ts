// KAT (M3): postBond takes real shielded custody; release / void / slash move
// real value out of escrow.
//
// The runtime simulates Zswap: postBond's receiveShielded shows up as an output to
// the contract and the coin is stored as a contract-owned qualified coin; a payout
// spends that coin (a Zswap input) and creates an output to the recipient, with the
// change returned to escrow as a fresh contract-owned coin.
//
// The bond lives in the epoch_proof contract (DD-17), so every run starts from a
// registered engagement; releases need a settled epoch (H3b) and pay exactly the
// earned tranche (M3b; schedule KAT in tranche.kat.test.ts).

import { beforeAll, describe, expect, it } from "vitest";
import { nextTranche } from "@mmr/protocol";
import {
  BLOCK_TIME, BOND_CALLER_PK, BOND_COIN, CLIENT_PK, HAVE_BUILD, REQUIRED_BOND, Status, T,
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
  /** Ledger with epoch 1 settled at its end, and with all 3 epochs settled at theirs. */
  let settled: BondRun["state"];
  let allSettled: BondRun["state"];
  /** When every settled epoch's challenge window has closed. */
  let releaseAt: bigint;
  beforeAll(async () => {
    reg = await runRegister(buildScenario().witness, new Uint8Array(32).fill(0x99));
    g = await runningEngagement({ proven: 3 });
    settled = (await settle(g, g.state, 1n, epochEndOf(g, 1n))).state;
    allSettled = settled;
    for (const e of [2n, 3n]) allSettled = (await settle(g, allSettled, e, epochEndOf(g, e))).state;
    releaseAt = epochEndOf(g, 3n) + T.CHALLENGE;
  });
  const post = (coin: CoinW = BOND_COIN, state = reg.state) =>
    runLifecycle("postBond", [reg.id], { coin, state });
  /** Release epoch `e`'s tranche, the k-th one out (k = tranches already released) of 30. */
  const release = (e: bigint, k: number, state = settled) =>
    runLifecycle("releaseEpoch", [g.id, e, nextTranche(BOND_COIN.value, 30, k)], { state, blockTime: releaseAt });

  it("posting escrows the coin: received into the contract, held as a qualified coin", async () => {
    const r = await post();
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0]!.recipient.is_left).toBe(false); // to the contract itself
    expect(r.outputs[0]!.coinInfo.value).toBe(10_000n);
    expect(r.escrowed).toMatchObject({ value: 10_000n, color: BOND_COIN.color, nonce: BOND_COIN.nonce });
  });

  it("rejects a bond below the registered amount or in another token, a second bond, and an unregistered id", async () => {
    await expect(post({ ...BOND_COIN, value: REQUIRED_BOND - 1n })).rejects.toThrow(/bond below the registered amount \(DD-35\)/);
    await expect(post({ ...BOND_COIN, color: new Uint8Array(32).fill(9) })).rejects.toThrow(/not the protocol bond token \(DD-35\)/);
    const { state } = await post();
    await expect(post({ ...BOND_COIN, nonce: new Uint8Array(32).fill(8) }, state)).rejects.toThrow(/bond already posted/);
    await expect(runLifecycle("postBond", [new Uint8Array(32).fill(0x42)],
      { coin: BOND_COIN, state: reg.state })).rejects.toThrow(/engagement not open for a bond/);
  });

  it("the beneficiary is the one registered (the MM cannot redirect a slash)", async () => {
    const { ledger } = await post();
    expect(ledger.bondBeneficiary.lookup(reg.id).bytes).toEqual(CLIENT_PK);
  });

  it("release returns each tranche to the owner; change stays escrowed", async () => {
    const r1 = await release(1n, 0, allSettled);
    expect(r1.inputs.map((c) => c.value)).toEqual([10_000n]); // the escrowed coin is spent
    expect(sentTo(r1, BOND_CALLER_PK)).toBe(333n);
    expect(toContract(r1)).toBe(9_667n);
    expect(r1.escrowed?.value).toBe(9_667n);

    const r2 = await release(2n, 1, r1.state);
    expect(sentTo(r2, BOND_CALLER_PK)).toBe(333n);
    const r3 = await release(3n, 2, r2.state);
    expect(sentTo(r3, BOND_CALLER_PK)).toBe(334n);
    // 3 of 30 tranches: the rest stays escrowed and the engagement keeps running
    // (draining on the last tranche is covered in tranche.kat.test.ts).
    expect(r3.escrowed?.value).toBe(9_000n);
    expect(r3.status).toBe(Status.Funded);
  });

  it("slash redirects the whole bond to the beneficiary; no later release", async () => {
    const r = await runLifecycle("defaultEngagement", [g.id, 2n], { state: settled, blockTime: graceDeadlineOf(g, 2n) });
    expect(sentTo(r, CLIENT_PK)).toBe(10_000n);
    expect(sentTo(r, BOND_CALLER_PK)).toBe(0n);
    expect(r.escrowed).toBeUndefined();
    expect(r.slashed).toBe(true);
    expect(r.status).toBe(Status.Defaulted);
    await expect(runLifecycle("releaseEpoch", [g.id, 1n, 1n], { state: r.state, blockTime: graceDeadlineOf(g, 2n) }))
      .rejects.toThrow(/already slashed/);
  });

  it("slash after a partial release takes only what is still escrowed", async () => {
    const r1 = await release(1n, 0);
    const r2 = await runLifecycle("defaultEngagement", [g.id, 2n], { state: r1.state, blockTime: graceDeadlineOf(g, 2n) });
    expect(sentTo(r2, CLIENT_PK)).toBe(9_667n);
  });

  it("void returns the whole bond to the owner", async () => {
    const { state } = await post();
    const r = await runLifecycle("voidUnfunded", [reg.id], { state, blockTime: BLOCK_TIME + T.FUNDING });
    expect(sentTo(r, BOND_CALLER_PK)).toBe(10_000n);
    expect(r.escrowed).toBeUndefined();
    expect(r.status).toBe(Status.Voided);
  });
});
