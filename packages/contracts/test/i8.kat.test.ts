// I8 (DD-26): the attester-root registry. Committee members (fixed at deploy, 2 of 3)
// each submit publishRoot; the root is published at the threshold; proveEpoch must open
// against the published root; settleEpoch needs a published root; an epoch whose root
// was never published is never defaultable. Every assert runs against the compiled
// circuit.

import { describe, it, expect } from "vitest";
import * as rt from "@midnight-ntwrk/compact-runtime";
import { AttesterCommitteeMembers, attesterId as protoAttesterId, cidBytes as protoCidBytes } from "@mmr/protocol";
import {
  ATTESTERS,
  BOND_TOKEN,
  BUILD_DIR,
  KAT_CHAIN,
  dayOfEpoch,
  rootKey,
  HAVE_BUILD,
  KAT_CID,
  KAT_COMMITTEE,
  attesterId,
  buildScenario,
  cidBytes,
  epochEndOf,
  freshState,
  graceDeadlineOf,
  publishRoot,
  runLifecycle,
  runProveEpoch,
  runProveFunding,
  runPublishRoot,
  runPublishRootAt,
  runRegister,
  runningEngagement,
  settle,
  stubWitnesses,
  KAT_ID,
  Status,
  T,
} from "./harness.js";

const R1 = new Uint8Array(32).fill(0x11);
const R2 = new Uint8Array(32).fill(0x22);
const OUTSIDER = new Uint8Array(32).fill(0xee);
const [A, B, C] = ATTESTERS as [Uint8Array, Uint8Array, Uint8Array];
const NOT_MEMBER = /not a committee attester \(I8\)/;
const EQUIVOCATE = /attester already voted another root for this epoch \(I8\)/;
const NOT_PUBLISHED_ROOT = /rootOfRoots is not the epoch's published root \(I8\)/;

describe.skipIf(!HAVE_BUILD)("I8: publishRoot (2-of-3 committee fixed at deploy)", () => {
  it("the constructor stores exactly the three member ids", async () => {
    const mod = await import(BUILD_DIR);
    const led = mod.ledger(await freshState());
    for (const id of KAT_COMMITTEE) expect(led.committee.member(id)).toBe(true);
    expect(led.committee.member(attesterId(OUTSIDER))).toBe(false);
  });

  it("the constructor rejects a duplicate member", async () => {
    const mod = await import(BUILD_DIR);
    const c = new mod.Contract(stubWitnesses());
    const dup = [KAT_COMMITTEE[0]!, KAT_COMMITTEE[0]!, KAT_COMMITTEE[2]!];
    await expect(c.initialState(rt.createConstructorContext({}, "0".repeat(64)), dup, BOND_TOKEN))
      .rejects.toThrow(/committee members must be distinct \(I8\)/);
  });

  it("one vote does not publish; a second distinct member does (root + cid)", async () => {
    const s0 = await freshState();
    const a = await runPublishRoot(A, 1n, R1, s0);
    expect(a.published).toBeUndefined();
    const b = await runPublishRoot(B, 1n, R1, a.state);
    expect(b.published).toEqual(R1);
    expect(b.cid).toEqual(KAT_CID);
  });

  it("any two members reach the threshold", async () => {
    const s0 = await freshState();
    const ac = await runPublishRoot(C, 5n, R1, (await runPublishRoot(A, 5n, R1, s0)).state);
    expect(ac.published).toEqual(R1);
  });

  it("a secret outside the committee is rejected, even with a member's id public", async () => {
    await expect(runPublishRoot(OUTSIDER, 1n, R1, await freshState())).rejects.toThrow(NOT_MEMBER);
  });

  it("a member's repeated vote counts once", async () => {
    const s0 = await freshState();
    const a1 = await runPublishRoot(A, 1n, R1, s0);
    const a2 = await runPublishRoot(A, 1n, R1, a1.state);
    expect(a2.published).toBeUndefined();
    expect((await runPublishRoot(B, 1n, R1, a2.state)).published).toEqual(R1);
  });

  it("a member cannot vote a second root for the same epoch (no equivocation)", async () => {
    const a = await runPublishRoot(A, 1n, R1, await freshState());
    await expect(runPublishRoot(A, 1n, R2, a.state)).rejects.toThrow(EQUIVOCATE);
    await expect(runPublishRoot(A, 1n, R1, a.state, cidBytes("other-cid"))).rejects.toThrow(EQUIVOCATE);
    // a different epoch is a fresh vote
    expect((await runPublishRoot(A, 2n, R2, a.state)).published).toBeUndefined();
  });

  it("votes count the exact (root, cid): different cids do not combine", async () => {
    const s0 = await freshState();
    const a = await runPublishRoot(A, 1n, R1, s0, cidBytes("cid-1"));
    const b = await runPublishRoot(B, 1n, R1, a.state, cidBytes("cid-2"));
    expect(b.published).toBeUndefined();
    const c = await runPublishRoot(C, 1n, R1, b.state, cidBytes("cid-1"));
    expect(c.published).toEqual(R1);
    expect(c.cid).toEqual(cidBytes("cid-1"));
  });

  it("after publication a lone vote for another root cannot replace it", async () => {
    const s = await publishRoot(await freshState(), 1n, R1);
    const c = await runPublishRoot(C, 1n, R2, s);
    expect(c.published).toEqual(R1);
  });
});

describe.skipIf(!HAVE_BUILD)("I8: proveEpoch opens against the published root", () => {
  it("an honest proof against the published root passes", async () => {
    const { witness, rootOfRoots } = buildScenario();
    const reg = await runRegister(witness, new Uint8Array(32).fill(0x5e));
    const s = await publishRoot(reg.state, 1n, rootOfRoots);
    await expect(runProveEpoch(witness, KAT_ID, rootOfRoots, 1n, s, { publish: false })).resolves.toBeDefined();
  });

  it("reverts when the epoch has no published root", async () => {
    const { witness, rootOfRoots } = buildScenario();
    const reg = await runRegister(witness, new Uint8Array(32).fill(0x5e));
    await expect(runProveEpoch(witness, KAT_ID, rootOfRoots, 1n, reg.state, { publish: false }))
      .rejects.toThrow(NOT_PUBLISHED_ROOT);
  });

  it("reverts when the openings are valid against a root other than the published one", async () => {
    const { witness, rootOfRoots } = buildScenario();
    const reg = await runRegister(witness, new Uint8Array(32).fill(0x5e));
    const s = await publishRoot(reg.state, 1n, R1); // the committee published a different root
    await expect(runProveEpoch(witness, KAT_ID, rootOfRoots, 1n, s, { publish: false }))
      .rejects.toThrow(NOT_PUBLISHED_ROOT);
    // ... and the same openings pass for an epoch whose published root is theirs
    const s2 = await publishRoot(s, 2n, rootOfRoots);
    await expect(runProveEpoch(witness, KAT_ID, rootOfRoots, 2n, s2, { publish: false })).resolves.toBeDefined();
  });
});

describe.skipIf(!HAVE_BUILD)("I8: settle and default gate on a published root", () => {
  it("settleEpoch reverts until the epoch's root is published", async () => {
    const g = await runningEngagement({ proven: 0, publish: false });
    const fake = { id: g.id, epoch: 1n, uptime: 48n, termsCommit: g.reg.termsCommit, tier: 1n };
    await expect(settle(g, g.state, 1n, epochEndOf(g, 1n), undefined, fake)).rejects.toThrow(/epoch root not published \(I8\)/);
    // once published (and funding proven, DD-27), the next gate (the record) is what stops it
    const s = await publishRoot(g.state, 1n, g.scenario.rootOfRoots);
    const f = await runProveFunding(g.scenario.witness, g.id, g.scenario.rootOfRoots, s);
    await expect(settle(g, f.state, 1n, epochEndOf(g, 1n), undefined, fake)).rejects.toThrow(/epoch record not on the ledger \(H3b\)/);
  });

  it("a published, proven epoch settles", async () => {
    const g = await runningEngagement({ proven: 1 });
    await expect(settle(g, g.state, 1n, epochEndOf(g, 1n))).resolves.toBeDefined();
  });

  it("an unpublished epoch is never defaultable — not at its grace deadline, not 100 epochs later", async () => {
    const g = await runningEngagement({ proven: 0, publish: false });
    for (const t of [graceDeadlineOf(g, 1n), graceDeadlineOf(g, 1n) + 100n * T.EPOCH]) {
      await expect(runLifecycle("defaultEngagement", [g.id, 1n], { state: g.state, blockTime: t }))
        .rejects.toThrow(/epoch root never published: not defaultable \(I8\)/);
    }
  });

  it("once published, an unsettled epoch defaults at its grace deadline (not before)", async () => {
    const g = await runningEngagement({ proven: 0, publish: false });
    const s = await publishRoot(g.state, 1n, g.scenario.rootOfRoots);
    await expect(runLifecycle("defaultEngagement", [g.id, 1n], { state: s, blockTime: graceDeadlineOf(g, 1n) - 1n }))
      .rejects.toThrow(/proving window open/);
    const r = await runLifecycle("defaultEngagement", [g.id, 1n], { state: s, blockTime: graceDeadlineOf(g, 1n) });
    expect(r.status).toBe(Status.Defaulted);
    expect(r.slashed).toBe(true);
  });
});

describe.skipIf(!HAVE_BUILD)("I8: the protocol committee drives the compiled publishRoot", () => {
  it("@mmr/protocol attesterId equals the contract's persistentHash member id", () => {
    for (const s of ATTESTERS) expect(protoAttesterId(s)).toEqual(attesterId(s));
  });

  async function runCommittee(online: number[]) {
    let state = await freshState();
    const committee = new AttesterCommitteeMembers({
      secrets: ATTESTERS, threshold: 2, online,
      submit: async (tx) => { state = (await runPublishRootAt(tx.secret, tx.chain, tx.day, tx.rootOfRoots, state, tx.cid)).state; },
    });
    const votes = await committee.publishRoot(Number(KAT_CHAIN), Number(dayOfEpoch(3n)), `0x${Buffer.from(R1).toString("hex")}`, "bafy-epoch-3");
    const led = (await import(BUILD_DIR)).ledger(state);
    return { votes, led };
  }

  it("two online members publish the root on-chain; the votes name their committee ids", async () => {
    const { votes, led } = await runCommittee([0, 2]);
    expect(led.publishedRoot.lookup(rootKey(KAT_CHAIN, dayOfEpoch(3n)))).toEqual(R1);
    expect(led.publishedCid.lookup(rootKey(KAT_CHAIN, dayOfEpoch(3n)))).toEqual(protoCidBytes("bafy-epoch-3"));
    expect(votes.map((v) => v.attester)).toEqual([0, 2].map((i) => `0x${Buffer.from(KAT_COMMITTEE[i]!).toString("hex")}`));
  });

  it("one online member is not enough", async () => {
    const { led } = await runCommittee([1]);
    expect(led.publishedRoot.member(rootKey(KAT_CHAIN, dayOfEpoch(3n)))).toBe(false);
  });
});
