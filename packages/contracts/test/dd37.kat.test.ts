// KAT (DD-37): fixes from the second external review.
//
//  - proveFunding accepts the attested root of any day from the registration day through
//    day 1 (a loan that lands before day 1 is provable), never a disputed one.
//  - postBond is the engagement owner's, like activate: the bond's owner receives every
//    released tranche.
//  - Disputes count only until the day's deadline (its end + 66 h). After it, every day is
//    final: settled (released, credited to claim), disputed (neutral: released to the MM,
//    not credited, not defaultable) or neither (defaultable).
//  - claim reads only credited days, and must present at least one.

import { beforeAll, describe, expect, it } from "vitest";
import * as rt from "@midnight-ntwrk/compact-runtime";
import { nextTranche } from "@mmr/protocol";
import {
  ATTESTERS, BLOCK_TIME, BOND_CALLER_PK, BOND_COIN, FUNDED_A, HAVE_BUILD, buildScenario,
  creditEpochs, dayOfEpoch, graceDeadlineOf, publishRoot, runClaim, runDisputeRoot,
  runLifecycle, runProveFunding, runRegister, runningEngagement, startDayFor,
  type BondRun, type ClaimArgs, type Engagement, type Scenario,
} from "./harness.js";

const [A, B] = ATTESTERS as [Uint8Array, Uint8Array, Uint8Array];
const SECRET = new Uint8Array(32).fill(0x99);
const PROFILE = new Uint8Array(32).fill(0x77);
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const sentTo = (r: BondRun, pk: Uint8Array) =>
  r.outputs.filter((o) => o.recipient.is_left && eq(o.recipient.left.bytes, pk)).reduce((a, o) => a + o.coinInfo.value, 0n);

/** A 2-of-3 dispute of KAT epoch `epoch`'s root (votes from A and B at `at`). */
const dispute = async (epoch: bigint, state: rt.ChargedState, at = BLOCK_TIME) =>
  (await runDisputeRoot(B, epoch, (await runDisputeRoot(A, epoch, state, at)).state, at)).state;

/** register (BLOCK_TIME) -> postBond -> activate (BLOCK_TIME + 100): epoch 1 is KAT day 1. */
async function activated(s: Scenario): Promise<{ id: Uint8Array; state: rt.ChargedState }> {
  const reg = await runRegister(s.witness, SECRET);
  let state = (await runLifecycle("postBond", [reg.id], { state: reg.state, coin: BOND_COIN })).state;
  state = (await runLifecycle("activate", [reg.id, startDayFor(BLOCK_TIME + 100n), BLOCK_TIME + 100n],
    { state, blockTime: BLOCK_TIME + 100n })).state;
  return { id: reg.id, state };
}

describe.skipIf(!HAVE_BUILD)("DD-37: proveFunding takes any attested day from registration through day 1", () => {
  const s = buildScenario(undefined, 0, FUNDED_A);

  it("proves against the registration day's root (the loan landed before day 1)", async () => {
    const a = await activated(s);
    const state = await publishRoot(a.state, 0n, s.rootOfRoots); // day 0: registration and activation
    const f = await runProveFunding(s.witness, a.id, s.rootOfRoots, state, dayOfEpoch(0n));
    expect(f.proven).toBe(true);
  });

  it("refuses a day before registration and a day after day 1", async () => {
    const a = await activated(s);
    const before = await publishRoot(a.state, -1n, s.rootOfRoots);
    await expect(runProveFunding(s.witness, a.id, s.rootOfRoots, before, dayOfEpoch(-1n)))
      .rejects.toThrow(/funding day before registration \(DD-37\)/);
    const after = await publishRoot(a.state, 2n, s.rootOfRoots);
    await expect(runProveFunding(s.witness, a.id, s.rootOfRoots, after, dayOfEpoch(2n)))
      .rejects.toThrow(/funding day after day 1 \(DD-37\)/);
  });

  it("refuses a disputed root", async () => {
    const a = await activated(s);
    const state = await dispute(0n, await publishRoot(a.state, 0n, s.rootOfRoots));
    await expect(runProveFunding(s.witness, a.id, s.rootOfRoots, state, dayOfEpoch(0n)))
      .rejects.toThrow(/funding root disputed \(DD-37\)/);
  });
});

describe.skipIf(!HAVE_BUILD)("DD-37: only the engagement owner posts the bond", () => {
  it("refuses a bond posted without the owner's secret", async () => {
    const reg = await runRegister(buildScenario().witness, new Uint8Array(32).fill(0x61));
    await expect(runLifecycle("postBond", [reg.id], { state: reg.state, coin: BOND_COIN, secret: new Uint8Array(32).fill(0x55) }))
      .rejects.toThrow(/only the engagement owner can post the bond \(DD-37\)/);
    const own = await runLifecycle("postBond", [reg.id], { state: reg.state, coin: BOND_COIN });
    expect(own.escrowed?.value).toBe(BOND_COIN.value);
  });
});

describe.skipIf(!HAVE_BUILD)("DD-37: disputes close at the day's deadline; a disputed day is neutral", () => {
  let g: Engagement;
  beforeAll(async () => { g = await runningEngagement({ proven: 3 }); });
  const release = (e: bigint, k: number, state: rt.ChargedState, blockTime: bigint) =>
    runLifecycle("releaseEpoch", [g.id, e, nextTranche(BOND_COIN.value, 30, k)], { state, blockTime });

  it("a vote counts until the deadline, not at it", async () => {
    const d = graceDeadlineOf(g, 1n);
    await expect(runDisputeRoot(A, 1n, g.state, d - 1n)).resolves.toBeDefined();
    await expect(runDisputeRoot(A, 1n, g.state, d)).rejects.toThrow(/dispute window closed \(DD-37\)/);
  });

  it("an unsettled disputed day releases its tranche to the MM at the deadline, uncredited", async () => {
    const state = await dispute(2n, g.state);
    await expect(release(2n, 0, state, graceDeadlineOf(g, 2n) - 1n)).rejects.toThrow(/dispute window open \(DD-37\)/);
    const r = await release(2n, 0, state, graceDeadlineOf(g, 2n));
    expect(sentTo(r, BOND_CALLER_PK)).toBe(nextTranche(BOND_COIN.value, 30, 0));
    expect(r.ledger.creditedRecords.findPathForLeaf(g.records[1]!)).toBeUndefined();
    await expect(runLifecycle("defaultEngagement", [g.id, 2n], { state: r.state, blockTime: graceDeadlineOf(g, 2n) }))
      .rejects.toThrow(/epoch root disputed: not defaultable \(DD-35\)/);
  });

  it("a day neither settled nor disputed does not release; it defaults", async () => {
    await expect(release(3n, 0, g.state, graceDeadlineOf(g, 3n))).rejects.toThrow(/epoch not settled \(H3b\)/);
    await expect(runLifecycle("defaultEngagement", [g.id, 3n], { state: g.state, blockTime: graceDeadlineOf(g, 3n) }))
      .resolves.toBeDefined();
  });
});

describe.skipIf(!HAVE_BUILD)("DD-37: claim counts credited days only, and needs at least one", () => {
  let g: Engagement;
  let base: ClaimArgs;
  beforeAll(async () => {
    g = await runningEngagement({ proven: 3 });
    const { terms, termsSalt } = g.scenario.witness;
    base = {
      engagementId: g.id, engagementSecret: SECRET, profileSecret: PROFILE, terms, termsSalt,
      present: new Map(g.records.map((r) => [Number(r.epoch), r])), epochsPassed: 3n, epochsTotal: 30n,
    };
  });

  it("refuses a claim that presents no day", async () => {
    const state = await creditEpochs(g.state, g.id, g.records);
    await expect(runClaim({ ...base, present: new Map(), epochsPassed: 0n }, state))
      .rejects.toThrow(/a claim presents at least one credited day \(DD-37\)/);
  });

  it("a proven day is not credited until it is released", async () => {
    await expect(runClaim(base, g.state)).rejects.toThrow(/epoch record not credited \(H4, DD-37\)/);
    const r = await runClaim(base, await creditEpochs(g.state, g.id, g.records));
    expect([r.completed, r.kpiHits, r.kpiTotal]).toEqual([1n, 3n, 30n]);
  });

  it("a disputed day is never credited, even after its neutral release", async () => {
    const [r1, r2, r3] = g.records as [typeof g.records[0], typeof g.records[0], typeof g.records[0]];
    let state = await dispute(2n, g.state);
    state = await creditEpochs(state, g.id, [r1, r3]);
    state = (await release(2n, 2, state, graceDeadlineOf(g, 2n))).state;
    await expect(runClaim(base, state)).rejects.toThrow(/epoch record not credited \(H4, DD-37\)/);
    const present = new Map([[1, r1], [3, r3]]);
    const c = await runClaim({ ...base, present, epochsPassed: 2n }, state);
    expect([c.completed, c.kpiHits, c.kpiTotal]).toEqual([1n, 2n, 30n]);
  });

  function release(e: bigint, k: number, state: rt.ChargedState, blockTime: bigint) {
    return runLifecycle("releaseEpoch", [g.id, e, nextTranche(BOND_COIN.value, 30, k)], { state, blockTime });
  }
});
