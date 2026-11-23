// KAT (H3b): the bond gates read their anchors from ledger state, not arguments.
//
// Every anchor is recorded on-chain, checked against the recording block's time
// (block - 600 s < ts <= block), and the gates read it back: voidUnfunded reads
// registeredAt, settleEpoch / defaultEngagement read activatedAt (epoch e ends at
// activatedAt + e * 24h), releaseEpoch reads settledAt. So the most a caller can
// back-date any anchor — and open a window early — is the 599 s tolerance, and a
// window can never open on an anchor that was not recorded.

import { beforeAll, describe, expect, it } from "vitest";
import { nextTranche } from "@mmr/protocol";
import {
  BLOCK_TIME, BOND_COIN, HAVE_BUILD, Status, T, buildScenario, cloneWitness, epochEndOf, epochKey,
  graceDeadlineOf, runLifecycle, runProveEpoch, runRegister, runningEngagement, settle, startDayFor,
  type BondRun, type Engagement, type Registered,
} from "./harness.js";

const SECRET = new Uint8Array(32).fill(0x99);
/** DD-35: activation needs the bond posted first. */
const bonded = async (reg: Registered) =>
  (await runLifecycle("postBond", [reg.id], { state: reg.state, coin: BOND_COIN })).state;

describe.skipIf(!HAVE_BUILD)("H3b: funding window anchored on the stored registeredAt", () => {
  const { witness } = buildScenario();

  it("void opens exactly 72h after the recorded registeredAt — no anchor argument", async () => {
    const reg = await runRegister(witness, SECRET);
    const end = reg.registeredAt + T.FUNDING;
    await expect(runLifecycle("voidUnfunded", [reg.id], { state: reg.state, blockTime: end - 1n }))
      .rejects.toThrow(/funding window open/);
    const r = await runLifecycle("voidUnfunded", [reg.id], { state: reg.state, blockTime: end });
    expect(r.status).toBe(Status.Voided);
  });

  it("a back-dated registration moves the window by at most the 599 s tolerance", async () => {
    const reg = await runRegister(witness, SECRET, BLOCK_TIME - 599n, BLOCK_TIME);
    expect(reg.registeredAt).toBe(BLOCK_TIME - 599n);
    await expect(runLifecycle("voidUnfunded", [reg.id], { state: reg.state, blockTime: BLOCK_TIME - 600n + T.FUNDING }))
      .rejects.toThrow(/funding window open/);
    await expect(runRegister(witness, SECRET, BLOCK_TIME - 600n, BLOCK_TIME))
      .rejects.toThrow(/registeredTs too far in the past \(H3\)/);
  });

  it("void needs a registered, unfunded engagement; activation closes with the window", async () => {
    await expect(runLifecycle("voidUnfunded", [new Uint8Array(32).fill(0x42)], { blockTime: BLOCK_TIME + T.FUNDING }))
      .rejects.toThrow(/not awaiting funding/);
    const reg = await runRegister(witness, SECRET);
    const st = await bonded(reg);
    const at = BLOCK_TIME + 10n;
    const act = await runLifecycle("activate", [reg.id, startDayFor(at), at], { state: st, blockTime: at });
    expect(act.status).toBe(Status.Funded);
    await expect(runLifecycle("voidUnfunded", [reg.id], { state: act.state, blockTime: BLOCK_TIME + T.FUNDING }))
      .rejects.toThrow(/not awaiting funding/);
    const late = BLOCK_TIME + T.FUNDING;
    await expect(runLifecycle("activate", [reg.id, startDayFor(late), late], { state: st, blockTime: late }))
      .rejects.toThrow(/funding window closed \(H3b\)/);
  });

  it("activatedAt is recorded within 600 s of the block", async () => {
    const reg = await runRegister(witness, SECRET);
    const st = await bonded(reg);
    const b = BLOCK_TIME + 1_000n;
    const activate = (ts: bigint) => runLifecycle("activate", [reg.id, startDayFor(ts), ts], { state: st, blockTime: b });
    const ok = await activate(b - 599n);
    expect(ok.ledger.activatedAt.lookup(reg.id)).toBe(b - 599n);
    expect(ok.ledger.startDay.lookup(reg.id)).toBe(startDayFor(b - 599n));
    await expect(activate(b - 600n)).rejects.toThrow(/activatedTs too far in the past \(H3b\)/);
    await expect(activate(b + 1n)).rejects.toThrow(/activatedTs is in the future \(H3b\)/);
  });

  it("only the owner activates, only once the bond is posted, on the day after activation (DD-35)", async () => {
    const reg = await runRegister(witness, SECRET);
    const at = BLOCK_TIME + 10n;
    const day = startDayFor(at);
    await expect(runLifecycle("activate", [reg.id, day, at], { state: reg.state, blockTime: at }))
      .rejects.toThrow(/bond not posted \(DD-35\)/);
    const st = await bonded(reg);
    await expect(runLifecycle("activate", [reg.id, day, at], { state: st, blockTime: at, secret: new Uint8Array(32).fill(0x55) }))
      .rejects.toThrow(/only the engagement owner can activate \(DD-35\)/);
    for (const wrong of [day - 1n, day + 1n]) {
      await expect(runLifecycle("activate", [reg.id, wrong, at], { state: st, blockTime: at }))
        .rejects.toThrow(/start day is not the day after activation \(DD-35\)/);
    }
    await expect(runLifecycle("activate", [reg.id, day, at], { state: st, blockTime: at })).resolves.toMatchObject({ status: Status.Funded });
  });
});

describe.skipIf(!HAVE_BUILD)("H3b: settledAt is recorded on-chain, bounded, for proven epochs only", () => {
  let g: Engagement;
  beforeAll(async () => { g = await runningEngagement({ proven: 1 }); });

  it("records settledAt within 600 s of the block it was recorded in", async () => {
    const b = epochEndOf(g, 1n) + 5_000n;
    const r = await settle(g, g.state, 1n, b, b - 599n);
    expect(r.ledger.settledAt.lookup(epochKey(g.id, 1n))).toBe(b - 599n);
    await expect(settle(g, g.state, 1n, b, b - 600n)).rejects.toThrow(/settledTs too far in the past \(H3b\)/);
    await expect(settle(g, g.state, 1n, b, b + 1n)).rejects.toThrow(/settledTs is in the future \(H3b\)/);
  });

  it("only between the epoch's end and its grace deadline (both from activatedAt)", async () => {
    const end = epochEndOf(g, 1n);
    await expect(settle(g, g.state, 1n, end - 1n)).rejects.toThrow(/epoch has not ended \(H3b\)/);
    await expect(settle(g, g.state, 1n, end)).resolves.toBeDefined();
    const last = graceDeadlineOf(g, 1n);
    await expect(settle(g, g.state, 1n, last - 1n)).resolves.toBeDefined();
    await expect(settle(g, g.state, 1n, last)).rejects.toThrow(/settlement deadline passed \(H3b\)/);
  });

  it("rejects an unproven epoch, another epoch's record, and a second settlement", async () => {
    const b = epochEndOf(g, 2n);
    const fake = { ...g.records[0]!, epoch: 2n }; // epoch 2 was never proven
    await expect(settle(g, g.state, 2n, b, b, fake)).rejects.toThrow(/epoch record not on the ledger \(H3b\)/);
    await expect(settle(g, g.state, 2n, b, b, g.records[0]!)).rejects.toThrow(/record is not this engagement's epoch \(H3b\)/);
    const once = await settle(g, g.state, 1n, b);
    await expect(settle(g, once.state, 1n, b + 1n)).rejects.toThrow(/epoch already settled/);
  });

  it("rejects an epoch proven under terms other than the registered ones", async () => {
    const h = await runningEngagement({ proven: 0 });
    const w = cloneWitness(h.scenario.witness);
    w.terms.min_uptime_buckets = 0n; // loosened: the proof passes, but tc != termsCommit[id]
    const r = await runProveEpoch(w, h.id, h.scenario.rootOfRoots, 1n, h.state);
    const rec = { id: h.id, epoch: 1n, uptime: r.uptime, termsCommit: r.termsCommit, tier: r.tier };
    await expect(settle(h, r.state, 1n, epochEndOf(h, 1n), undefined, rec))
      .rejects.toThrow(/epoch proven under unregistered terms \(H3b\)/);
  });
});

describe.skipIf(!HAVE_BUILD)("H3b / DD-37: releaseEpoch opens at the day's deadline", () => {
  let g: Engagement;
  beforeAll(async () => { g = await runningEngagement({ proven: 1 }); });
  const release = (state: BondRun["state"], blockTime: bigint) =>
    runLifecycle("releaseEpoch", [g.id, 1n, nextTranche(BOND_COIN.value, 30, 0)], { state, blockTime });

  it("an unsettled epoch never releases, however late", async () => {
    await expect(release(g.state, graceDeadlineOf(g, 1n) + 10n * T.EPOCH)).rejects.toThrow(/epoch not settled \(H3b\)/);
  });

  it("a settled epoch releases exactly at its day's deadline, however early it settled", async () => {
    const b = epochEndOf(g, 1n) + 1_000n; // the block the settlement lands in
    const { state } = await settle(g, g.state, 1n, b, b - 599n);
    await expect(release(state, graceDeadlineOf(g, 1n) - 1n)).rejects.toThrow(/dispute window open \(DD-37\)/);
    await expect(release(state, graceDeadlineOf(g, 1n))).resolves.toBeDefined();
    // back-dating is still bounded at settlement
    await expect(settle(g, g.state, 1n, b, b - 600n)).rejects.toThrow(/settledTs too far in the past \(H3b\)/);
  });
});

describe.skipIf(!HAVE_BUILD)("H3b: defaultEngagement reads activatedAt and the settlement record", () => {
  let g: Engagement;
  beforeAll(async () => { g = await runningEngagement({ proven: 1 }); });

  it("an unsettled epoch defaults exactly at its grace deadline", async () => {
    const last = graceDeadlineOf(g, 2n);
    await expect(runLifecycle("defaultEngagement", [g.id, 2n], { state: g.state, blockTime: last - 1n }))
      .rejects.toThrow(/proving window open/);
    const r = await runLifecycle("defaultEngagement", [g.id, 2n], { state: g.state, blockTime: last });
    expect(r.slashed).toBe(true);
    expect(r.status).toBe(Status.Defaulted);
  });

  it("a settled epoch cannot be defaulted", async () => {
    const { state } = await settle(g, g.state, 1n, epochEndOf(g, 1n));
    await expect(runLifecycle("defaultEngagement", [g.id, 1n], { state, blockTime: graceDeadlineOf(g, 1n) + 1n }))
      .rejects.toThrow(/epoch was settled/);
  });

  it("an engagement that never activated has no schedule to default on", async () => {
    const reg = await runRegister(buildScenario().witness, SECRET);
    await expect(runLifecycle("defaultEngagement", [reg.id, 1n], { state: reg.state, blockTime: BLOCK_TIME + 100n * T.EPOCH }))
      .rejects.toThrow(/engagement not running/);
  });
});
