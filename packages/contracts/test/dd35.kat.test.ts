// KAT (DD-35): fixes from the external review.
//
//  - Published roots are keyed by (chain, UTC day), and epoch e of an engagement is day
//    startDay + e - 1, so engagements that start on different days each prove against
//    their own day's root, and a root for one chain never stands in for another.
//  - Registration fixes tier, chain, the required bond and the beneficiary publicly, with
//    a fixed minimum bond per tier.
//  - disputeRoot: a 2-of-3 committee vote that stops a root from settling, releasing or
//    defaulting anything (the challenge window made real).

import { beforeAll, describe, expect, it } from "vitest";
import { nextTranche } from "@mmr/protocol";
import {
  ATTESTERS, BLOCK_TIME, BOND_COIN, CLIENT_PK, HAVE_BUILD, KAT_CHAIN, T, buildScenario,
  dayOfEpoch, epochEndOf, graceDeadlineOf, publishRoot, rootKey, runDisputeRoot, runLifecycle,
  runProveEpoch, runRegister, runningEngagement, settle, startDayFor,
  type Engagement,
} from "./harness.js";

const [A, B, C] = ATTESTERS as [Uint8Array, Uint8Array, Uint8Array];
const OUTSIDER = new Uint8Array(32).fill(0xee);

describe.skipIf(!HAVE_BUILD)("DD-35: roots keyed by (chain, day)", () => {
  it("engagements that start on different days each prove their own epoch 1", async () => {
    // A: activated on BLOCK_TIME's day (epoch 1 = KAT day 1). B: registered and activated a
    // day later (epoch 1 = KAT day 2). Day 1 and day 2 have different published roots.
    const a = buildScenario();
    const b = buildScenario(undefined, 0, { xferIn: 7n });
    expect(a.rootOfRoots).not.toEqual(b.rootOfRoots);
    const regA = await runRegister(a.witness, new Uint8Array(32).fill(0xa0));
    let state = (await runProveEpoch(a.witness, regA.id, a.rootOfRoots, 1n, regA.state)).state;

    const later = BLOCK_TIME + T.EPOCH;
    const regB = await runRegister(b.witness, new Uint8Array(32).fill(0xb0), later, later, state);
    state = (await runLifecycle("postBond", [regB.id], { state: regB.state, coin: BOND_COIN })).state;
    state = (await runLifecycle("activate", [regB.id, startDayFor(later), later], { state, blockTime: later })).state;
    expect(startDayFor(later)).toBe(dayOfEpoch(2n));
    state = await publishRoot(state, 2n, b.rootOfRoots); // day 2's root
    const r = await runProveEpoch(b.witness, regB.id, b.rootOfRoots, 1n, state, { publish: false });
    expect(r.uptime).toBe(48n);
    // ... and B's epoch 1 cannot be proven against day 1's root (A's epoch 1)
    await expect(runProveEpoch(b.witness, regB.id, a.rootOfRoots, 1n, state, { publish: false }))
      .rejects.toThrow();
  });

  it("a root published for another chain does not count", async () => {
    const s = buildScenario();
    const reg = await runRegister(s.witness, new Uint8Array(32).fill(0xc0));
    // the engagement is on Base (8453); the committee publishes this root for Ethereum (1)
    const st = await publishRoot(reg.state, 1n, s.rootOfRoots, 1n);
    await expect(runProveEpoch(s.witness, reg.id, s.rootOfRoots, 1n, st, { publish: false }))
      .rejects.toThrow(/rootOfRoots is not the epoch's published root \(I8\)/);
    expect(KAT_CHAIN).toBe(8453n);
  });
});

describe.skipIf(!HAVE_BUILD)("DD-35: registration fixes tier, chain, bond and beneficiary", () => {
  const { witness } = buildScenario();
  const secret = new Uint8Array(32).fill(0xd0);

  it("records them publicly", async () => {
    const reg = await runRegister(witness, secret, BLOCK_TIME, BLOCK_TIME, undefined, { tier: 3n, bond: 2_500n });
    const st = await runLifecycle("postBond", [reg.id], { state: reg.state, coin: { ...BOND_COIN, value: 2_500n } });
    expect(st.ledger.tier.lookup(reg.id)).toBe(3n);
    expect(st.ledger.chainOf.lookup(reg.id)).toBe(8453n);
    expect(st.ledger.bondRequired.lookup(reg.id)).toBe(2_500n);
    expect(st.ledger.bondBeneficiary.lookup(reg.id).bytes).toEqual(CLIENT_PK);
  });

  it("enforces the per-tier minimum bond (A 10,000 / B 5,000 / C 2,500)", async () => {
    for (const [tier, min] of [[1n, 10_000n], [2n, 5_000n], [3n, 2_500n]] as const) {
      await expect(runRegister(witness, secret, BLOCK_TIME, BLOCK_TIME, undefined, { tier, bond: min - 1n }))
        .rejects.toThrow(/bond below the tier minimum \(DD-35\)/);
      await expect(runRegister(witness, secret, BLOCK_TIME, BLOCK_TIME, undefined, { tier, bond: min })).resolves.toBeDefined();
    }
  });

  it("rejects an unknown tier, an unsupported chain and an unset beneficiary", async () => {
    for (const tier of [0n, 4n]) {
      await expect(runRegister(witness, secret, BLOCK_TIME, BLOCK_TIME, undefined, { tier }))
        .rejects.toThrow(/unknown tier \(DD-35\)/);
    }
    await expect(runRegister(witness, secret, BLOCK_TIME, BLOCK_TIME, undefined, { chain: 10n }))
      .rejects.toThrow(/unsupported chain \(DD-35\)/);
    await expect(runRegister(witness, secret, BLOCK_TIME, BLOCK_TIME, undefined, { beneficiary: new Uint8Array(32) }))
      .rejects.toThrow(/beneficiary not set \(DD-35\)/);
    await expect(runRegister(witness, secret, BLOCK_TIME, BLOCK_TIME, undefined, { chain: 1n })).resolves.toBeDefined();
  });
});

describe.skipIf(!HAVE_BUILD)("DD-35: disputeRoot (2 of 3) blocks a root", () => {
  let g: Engagement;
  beforeAll(async () => { g = await runningEngagement({ proven: 2 }); });
  const disputed = async (epoch: bigint, state = g.state) =>
    (await runDisputeRoot(B, epoch, (await runDisputeRoot(A, epoch, state)).state)).state;

  it("needs a committee member and a published root; one vote is not enough, a repeat counts once", async () => {
    await expect(runDisputeRoot(OUTSIDER, 1n, g.state)).rejects.toThrow(/not a committee attester \(I8\)/);
    await expect(runDisputeRoot(A, 31n, g.state)).rejects.toThrow(/no published root to dispute \(DD-35\)/);
    const one = await runDisputeRoot(A, 1n, g.state);
    expect(one.disputed).toBe(false);
    const again = await runDisputeRoot(A, 1n, one.state);
    expect(again.disputed).toBe(false);
    const two = await runDisputeRoot(C, 1n, again.state);
    expect(two.disputed).toBe(true);
    expect(two.state).toBeDefined();
    expect(rootKey(KAT_CHAIN, dayOfEpoch(1n))).toHaveLength(32);
  });

  it("a disputed root cannot be settled", async () => {
    const state = await disputed(1n);
    await expect(settle(g, state, 1n, epochEndOf(g, 1n))).rejects.toThrow(/epoch root disputed \(DD-35\)/);
  });

  it("a settled epoch whose root is disputed releases as neutral: paid to the MM, never credited (DD-37)", async () => {
    const s = (await settle(g, g.state, 1n, epochEndOf(g, 1n))).state;
    const at = graceDeadlineOf(g, 1n);
    const release = (state: typeof s) =>
      runLifecycle("releaseEpoch", [g.id, 1n, nextTranche(BOND_COIN.value, 30, 0)], { state, blockTime: at });
    const plain = await release(s); // undisputed: releases and credits the record
    const neutral = await release(await disputed(1n, s)); // disputed: releases, credits nothing
    expect(plain.ledger.creditedRecords.findPathForLeaf(g.records[0]!)).toBeDefined();
    expect(neutral.ledger.creditedRecords.findPathForLeaf(g.records[0]!)).toBeUndefined();
    expect(neutral.ledger.releasedEpochs.lookup(g.id)).toBe(1n);
  });

  it("an epoch on a disputed root is not defaultable (the MM is not slashed for a bad root)", async () => {
    const state = await disputed(2n);
    await expect(runLifecycle("defaultEngagement", [g.id, 2n], { state, blockTime: graceDeadlineOf(g, 2n) }))
      .rejects.toThrow(/epoch root disputed: not defaultable \(DD-35\)/);
    // undisputed, the same epoch defaults (it was never settled)
    await expect(runLifecycle("defaultEngagement", [g.id, 2n], { state: g.state, blockTime: graceDeadlineOf(g, 2n) }))
      .resolves.toBeDefined();
  });
});
