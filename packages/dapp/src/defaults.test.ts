// Engagements a default can be declared on: the rules on a hand-made ledger, then the same
// rules against the compiled contract, which must accept every candidate and only those.

import { describe, expect, it } from "vitest";
import { HAVE_BUILD, Status, epochKey, graceDeadlineOf, rootKey, runLifecycle, runningEngagement } from "@mmr/contracts/harness";
import { ledger } from "@mmr/contracts/epoch_proof";
import { type DefaultLedger, defaultCandidates } from "./defaults.js";

const DAY = 86_400n;
const AFTER_END = 237_600n;
const CHAIN = 8453n;
const START = 20_781n; // 24 Nov 2026
const deadline = (e: bigint) => (START + e) * DAY + AFTER_END;

const key = (b: Uint8Array) => Buffer.from(b).toString("hex");
function map<V>(entries: [Uint8Array, V][] = []) {
  const m = new Map(entries.map(([k, v]) => [key(k), v] as const));
  return { member: (k: Uint8Array) => m.has(key(k)), lookup: (k: Uint8Array) => m.get(key(k))! };
}
function fakeLedger(o: { id: Uint8Array; status?: number; published?: bigint[]; disputed?: bigint[]; settled?: bigint[]; slashed?: boolean }): DefaultLedger {
  const roots = (o.published ?? []).map((e) => [rootKey(CHAIN, START + e - 1n), new Uint8Array(32)] as [Uint8Array, Uint8Array]);
  return {
    status: [[o.id, o.status ?? Status.Funded]],
    startDay: map([[o.id, START]]),
    chainOf: map([[o.id, CHAIN]]),
    contractEpochs: map([[o.id, 30n]]),
    settledAt: map((o.settled ?? []).map((e) => [epochKey(o.id, e), 1n] as [Uint8Array, bigint])),
    publishedRoot: map(roots),
    disputedRoot: map((o.disputed ?? []).map((e) => [rootKey(CHAIN, START + e - 1n), true] as [Uint8Array, boolean])),
    slashed: map(o.slashed ? [[o.id, true]] : []),
  };
}

const ID = new Uint8Array(32).fill(0x42);

describe("which engagements a default can be declared on", () => {
  it("a day attested and unsettled, from its deadline on", () => {
    const led = fakeLedger({ id: ID, published: [1n] });
    expect(defaultCandidates(led, deadline(1n) - 1n)).toEqual([]);
    expect(defaultCandidates(led, deadline(1n))).toEqual([{ id: ID, epoch: 1n, day: START }]);
  });

  it("never a settled or disputed day, nor one whose root was never attested", () => {
    const now = deadline(3n);
    expect(defaultCandidates(fakeLedger({ id: ID, published: [1n, 2n, 3n], settled: [1n, 2n, 3n] }), now)).toEqual([]);
    expect(defaultCandidates(fakeLedger({ id: ID, published: [1n], disputed: [1n] }), now)).toEqual([]);
    expect(defaultCandidates(fakeLedger({ id: ID, published: [3n], settled: [] }), now)).toEqual([{ id: ID, epoch: 3n, day: START + 2n }]);
  });

  it("only running engagements, not slashed, not skipped", () => {
    const now = deadline(1n);
    expect(defaultCandidates(fakeLedger({ id: ID, published: [1n], status: Status.Registered }), now)).toEqual([]);
    expect(defaultCandidates(fakeLedger({ id: ID, published: [1n], status: Status.Defaulted }), now)).toEqual([]);
    expect(defaultCandidates(fakeLedger({ id: ID, published: [1n], slashed: true }), now)).toEqual([]);
    expect(defaultCandidates(fakeLedger({ id: ID, published: [1n] }), now, [new Uint8Array(32).fill(0x42)])).toEqual([]);
  });
});

describe.skipIf(!HAVE_BUILD)("against the compiled contract", () => {
  it("finds the day the contract defaults, and nothing once it has", async () => {
    const g = await runningEngagement({ proven: 1 });
    const at = graceDeadlineOf(g, 1n);
    expect(defaultCandidates(ledger(g.state), at - 1n)).toEqual([]);
    const [c, ...rest] = defaultCandidates(ledger(g.state), at);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ epoch: 1n, day: g.startDay });
    const r = await runLifecycle("defaultEngagement", [c!.id, c!.epoch], { state: g.state, blockTime: at });
    expect(r.status).toBe(Status.Defaulted);
    expect(defaultCandidates(ledger(r.state), at)).toEqual([]);
  });
});
