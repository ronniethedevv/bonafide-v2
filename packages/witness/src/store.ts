// The MM's local witness store. Private, on-disk, per-engagement: one record per
// epoch, appended as the contract runs, and read back in full at claim time (the
// claim circuit needs every epoch 1..epochsTotal). Capturing epoch N chains its
// carry-forward from epoch N-1's stored record, so the lifetime budget ledger is
// built incrementally and is resumable across restarts.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Digest } from "@mmr/merkle";
import type { CarryTotals } from "@mmr/prover";
import {
  captureEpochWitness,
  carryStateFromWitness,
  genesisCarryState,
  type CarryState,
  type CaptureEpochArgs,
  type EpochWitness,
} from "./epoch-witness.js";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const unhex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "hex"));
const totalsToJson = (t: CarryTotals) => ({
  xferIn: t.xferIn.toString(),
  xferOut: t.xferOut.toString(),
  fromTreasury: t.fromTreasury.toString(),
});
const totalsFromJson = (o: Record<string, string>): CarryTotals => ({
  xferIn: BigInt(o.xferIn!),
  xferOut: BigInt(o.xferOut!),
  fromTreasury: BigInt(o.fromTreasury!),
});

/** JSON-safe serialization of an EpochWitness (bigints → decimal, digests → hex). */
export function serializeWitness(w: EpochWitness): string {
  const sums = Object.fromEntries(
    Object.entries(w.sums).map(([k, v]) => [k, (v as bigint).toString()]),
  );
  return JSON.stringify(
    {
      engagementId: w.engagementId,
      epoch: w.epoch,
      range: w.range,
      settled: w.settled,
      pass: w.pass,
      uptimeBuckets: w.uptimeBuckets,
      totalBuckets: w.totalBuckets,
      invariants: w.invariants,
      sums,
      members: w.members.map((m) => "0x" + m.toString(16)),
      carry: {
        prevTotals: totalsToJson(w.carry.prevTotals),
        newTotals: totalsToJson(w.carry.newTotals),
        newCommitment: hex(w.carry.newCommitment),
        newSalt: hex(w.carry.newSalt),
        ok: w.carry.ok,
        capHolds: w.carry.capHolds,
      },
      capturedAt: w.capturedAt,
    },
    null,
    1,
  );
}

export function deserializeWitness(text: string): EpochWitness {
  const o = JSON.parse(text);
  const sums = Object.fromEntries(
    Object.entries(o.sums as Record<string, string>).map(([k, v]) => [k, BigInt(v)]),
  ) as EpochWitness["sums"];
  return {
    engagementId: o.engagementId,
    epoch: o.epoch,
    range: o.range,
    settled: o.settled,
    pass: o.pass,
    uptimeBuckets: o.uptimeBuckets,
    totalBuckets: o.totalBuckets,
    invariants: o.invariants,
    sums,
    members: (o.members as string[]).map((m) => BigInt(m)),
    carry: {
      prevTotals: totalsFromJson(o.carry.prevTotals),
      newTotals: totalsFromJson(o.carry.newTotals),
      newCommitment: unhex(o.carry.newCommitment) as unknown as Digest,
      newSalt: unhex(o.carry.newSalt),
      ok: o.carry.ok,
      capHolds: o.carry.capHolds,
    },
    capturedAt: o.capturedAt,
  };
}

export interface WitnessStore {
  append(w: EpochWitness): void;
  get(engagementId: string, epoch: number): EpochWitness | undefined;
  list(engagementId: string): EpochWitness[];
}

/** On-disk witness store: <root>/<engagementId>/epoch-<n>.json. */
export class FsWitnessStore implements WitnessStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }
  private dir(engagementId: string): string {
    return join(this.root, engagementId.replace(/[^a-zA-Z0-9_-]/g, "_"));
  }
  append(w: EpochWitness): void {
    const dir = this.dir(w.engagementId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `epoch-${w.epoch}.json`), serializeWitness(w) + "\n");
  }
  get(engagementId: string, epoch: number): EpochWitness | undefined {
    const file = join(this.dir(engagementId), `epoch-${epoch}.json`);
    if (!existsSync(file)) return undefined;
    return deserializeWitness(readFileSync(file, "utf8"));
  }
  list(engagementId: string): EpochWitness[] {
    const dir = this.dir(engagementId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => /^epoch-\d+\.json$/.test(f))
      .map((f) => deserializeWitness(readFileSync(join(dir, f), "utf8")))
      .sort((a, b) => a.epoch - b.epoch);
  }
}

/** In-memory store (tests, dry runs). */
export class MemoryWitnessStore implements WitnessStore {
  private readonly byEng = new Map<string, Map<number, EpochWitness>>();
  append(w: EpochWitness): void {
    const m = this.byEng.get(w.engagementId) ?? new Map<number, EpochWitness>();
    // round-trip through serialization so in-memory behaves like on-disk
    m.set(w.epoch, deserializeWitness(serializeWitness(w)));
    this.byEng.set(w.engagementId, m);
  }
  get(engagementId: string, epoch: number): EpochWitness | undefined {
    return this.byEng.get(engagementId)?.get(epoch);
  }
  list(engagementId: string): EpochWitness[] {
    return [...(this.byEng.get(engagementId)?.values() ?? [])].sort((a, b) => a.epoch - b.epoch);
  }
}

/** Coverage of a stored engagement over its contracted range — which epochs are captured. */
export interface WitnessCoverage {
  readonly epochsTotal: number;
  readonly present: number;
  /** Epochs 1..epochsTotal with no stored witness. */
  readonly missing: number[];
  readonly contiguous: boolean;
  /** Stored epochs whose verdict passed. */
  readonly passed: number;
}

export function witnessCoverage(
  store: WitnessStore,
  engagementId: string,
  epochsTotal: number,
): WitnessCoverage {
  const seen = new Map<number, EpochWitness>();
  for (const w of store.list(engagementId)) if (w.epoch >= 1 && w.epoch <= epochsTotal) seen.set(w.epoch, w);
  const missing: number[] = [];
  for (let e = 1; e <= epochsTotal; e++) if (!seen.has(e)) missing.push(e);
  let passed = 0;
  for (const w of seen.values()) if (w.pass) passed++;
  return { epochsTotal, present: seen.size, missing, contiguous: missing.length === 0, passed };
}

/**
 * Capture the next epoch and append it, chaining the carry-forward from the stored
 * previous epoch (or genesis for epoch 1). Enforces in-order capture: epoch N requires
 * epoch N-1 to already be stored, so the budget ledger can't be chained across a gap.
 */
export function captureAndStore(
  store: WitnessStore,
  args: Omit<CaptureEpochArgs, "prevCarry"> & { genesisSalt: Uint8Array },
): EpochWitness {
  const { hasher, engagement, range, genesisSalt } = args;
  let prevCarry: CarryState;
  if (range.epoch === 1) {
    prevCarry = genesisCarryState(hasher, genesisSalt);
  } else {
    const prev = store.get(engagement.id, range.epoch - 1);
    if (prev === undefined) {
      throw new Error(`cannot capture epoch ${range.epoch}: epoch ${range.epoch - 1} not yet captured`);
    }
    prevCarry = carryStateFromWitness(prev);
  }
  const w = captureEpochWitness({ ...args, prevCarry });
  store.append(w);
  return w;
}
