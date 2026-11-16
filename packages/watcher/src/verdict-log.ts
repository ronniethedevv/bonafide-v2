// Client verdict log.
//
// The client watcher combines two independent judgements per epoch:
//   - settlement outcome (did the root settle, is the MM in proving/grace/default)
//     from @mmr/protocol, and
//   - the delivery verdict (I1-I8) from @mmr/prover's reference oracle.
// This is what the client sees in its per-engagement view (exact per-epoch figures
// for its own engagement), and what a watcher uses to decide whether to challenge.

import {
  evaluateEpoch,
  type Engagement,
  type EpochVerdict,
} from "@mmr/prover";
import {
  evaluateEpochSettlement,
  rootIsSettled,
  isScored,
  type EpochOutcome,
  type RootState,
  type Timing,
} from "@mmr/protocol";
import type { AddressActivity, EpochRange, IndexerConfig } from "@mmr/indexer";

export interface EpochObservation {
  range: EpochRange;
  /** The MM's per-wallet activity the client can see for its own engagement. */
  activities: ReadonlyMap<bigint, AddressActivity>;
  root: RootState | null;
  now: number;
  challenged: boolean;
  proofAcceptedTs: number | null;
  threshold: number;
}

export interface EpochLogEntry {
  epoch: number;
  outcome: EpochOutcome;
  scored: boolean;
  settled: boolean;
  verdict: EpochVerdict;
}

export function buildClientVerdictLog(
  engagement: Engagement,
  observations: readonly EpochObservation[],
  config: IndexerConfig,
  timing: Timing,
): EpochLogEntry[] {
  return observations.map((obs) => {
    const base = {
      epochEndTs: obs.range.endTs,
      now: obs.now,
      root: obs.root,
      threshold: obs.threshold,
      challenged: obs.challenged,
      timing,
    };
    const settlement = evaluateEpochSettlement({ ...base, proofAcceptedTs: obs.proofAcceptedTs });
    const settled = rootIsSettled(base);
    const verdict = evaluateEpoch(engagement, obs.activities, config, obs.range, { settled });
    return {
      epoch: obs.range.epoch,
      outcome: settlement.outcome,
      scored: isScored(settlement.outcome),
      settled,
      verdict,
    };
  });
}

export interface LogSummary {
  epochsObserved: number;
  epochsScored: number;
  /** Scored epochs whose delivery verdict passed every invariant. */
  epochsPassed: number;
  /** Average uptime-bucket hit-rate (0-100) over scored epochs. */
  avgUptimePct: number;
}

/**
 * The inputs a nullifier claim should carry, derived from the watcher's own
 * verdict log rather than taken on trust. The claim circuit (H4) should verify
 * these against the on-chain per-epoch record (epochUptime) before crediting the
 * profile, so the record can't be inflated.
 */
export interface ClaimInput {
  engagementId: string;
  /** Difficulty tier as the claim circuit expects it (0=C/sandbox, 1=B, 2=A). */
  tier: number;
  /** Scored epochs whose delivery verdict passed every invariant. */
  epochsPassed: number;
  /** Total scored (settled) epochs. */
  epochsTotal: number;
}

export function buildClaimInput(
  engagement: Engagement,
  entries: readonly EpochLogEntry[],
  tier: number,
): ClaimInput {
  const s = summarizeLog(entries);
  return {
    engagementId: engagement.id,
    tier,
    epochsPassed: s.epochsPassed,
    epochsTotal: s.epochsScored,
  };
}

/**
 * One epoch's on-chain record, mirroring an `epochUptime` ledger entry for the
 * engagement. An entry exists only for an epoch whose proof `proveEpoch` accepted
 * (I1-I7 held and the root settled), so its mere presence already means the epoch
 * passed every asserted invariant; the recorded `uptime` is what the claim checks
 * against the contracted threshold for I6.
 */
export interface EpochRecord {
  /** Epoch number, 1-based, within the engagement's contracted range. */
  epoch: number;
  /** Uptime bucket count recorded by proveEpoch. */
  uptime: number;
}

/**
 * H4: derive the claim counters from the ON-CHAIN per-epoch records rather than
 * the client's self-reported verdict log, so the public record can't be inflated.
 *
 * "Passed" = a record exists for the epoch AND its uptime meets the contracted
 * threshold. The denominator is the committed contract length (`epochsTotal`), so
 * a failed or unproven epoch (no qualifying record) counts toward the total but
 * not toward passed; passed can never exceed total. `minUptimeBuckets` and
 * `epochsTotal` are the committed terms (EngagementTerms, A1 / B1; DD-12).
 *
 * This is the known-answer spec epoch_proof.claim mirrors (H4, DD-15): for epochs
 * 1..epochsTotal it privately proves each presented record is in the epochRecords
 * tree, counts those meeting the threshold, and asserts the claimed counters equal
 * the count and the committed total. (On-chain, an MM may withhold a record, which
 * only lowers its own count.)
 */
export function deriveClaimFromRecords(
  engagementId: string,
  tier: number,
  records: readonly EpochRecord[],
  minUptimeBuckets: number,
  epochsTotal: number,
): ClaimInput {
  const byEpoch = new Map<number, number>();
  for (const r of records) {
    // only records within the contracted range count; last writer per epoch wins
    if (r.epoch >= 1 && r.epoch <= epochsTotal) byEpoch.set(r.epoch, r.uptime);
  }
  let epochsPassed = 0;
  for (let e = 1; e <= epochsTotal; e++) {
    const uptime = byEpoch.get(e);
    if (uptime !== undefined && uptime >= minUptimeBuckets) epochsPassed++;
  }
  return { engagementId, tier, epochsPassed, epochsTotal };
}

/** Completeness of an engagement's record set over its contracted range. */
export interface EpochCoverage {
  readonly epochsTotal: number;
  /** Epochs (1..epochsTotal) that have at least one record. */
  readonly present: number;
  /** Epoch numbers in range with NO record — withheld or unproven epochs, made visible. */
  readonly missing: number[];
  /** No gaps: every contracted epoch has a record. */
  readonly contiguous: boolean;
}

/**
 * Report which contracted epochs have on-chain records and which are missing. A
 * missing epoch already lowers the derived pass-rate (deriveClaimFromRecords counts it
 * toward the total but not toward passed), so withholding can't inflate a claim — but
 * this surfaces the gaps so a client SEES an incomplete record instead of reading a
 * silently-penalised rate as if it were complete (the completeness / cherry-pick
 * concern, see specs/COMPETITIVE_LANDSCAPE.md §3 C3).
 */
export function epochCoverageOfRecords(
  records: readonly EpochRecord[],
  epochsTotal: number,
): EpochCoverage {
  const seen = new Set<number>();
  for (const r of records) if (r.epoch >= 1 && r.epoch <= epochsTotal) seen.add(r.epoch);
  const missing: number[] = [];
  for (let e = 1; e <= epochsTotal; e++) if (!seen.has(e)) missing.push(e);
  return { epochsTotal, present: seen.size, missing, contiguous: missing.length === 0 };
}

/**
 * H4: verify a claim's counters against the on-chain records and the committed
 * contract length. The claim's `epochsTotal` must equal the committed value (the
 * circuit checks this against the terms commitment), and `epochsPassed` must equal
 * the count derived from the records at the contracted threshold.
 */
export function verifyClaimAgainstRecords(
  claim: ClaimInput,
  records: readonly EpochRecord[],
  minUptimeBuckets: number,
  committedEpochsTotal: number,
): boolean {
  if (claim.epochsTotal !== committedEpochsTotal) return false;
  const expected = deriveClaimFromRecords(
    claim.engagementId,
    claim.tier,
    records,
    minUptimeBuckets,
    committedEpochsTotal,
  );
  return claim.epochsPassed === expected.epochsPassed;
}

/**
 * The compile-time bound on the claim loop (DD-15): `epoch_proof.claim` iterates a
 * fixed `MAX_EPOCHS` slots regardless of the real `epochsTotal`, so the number of
 * iterations never leaks the contract length. `epochsTotal` must be <= this.
 */
export const MAX_EPOCHS = 90;

/** One slot of the claim witness: slot `s` (0-based) corresponds to epoch `s + 1`. */
export interface ClaimSlot {
  readonly slot: number;
  readonly epoch: number;
  /**
   * The record the MM presents for this slot, or null when nothing is presented
   * (epoch outside the contracted range, no on-ledger record, or deliberately
   * withheld). A null slot gets the genesis path on-chain and never counts.
   */
  readonly record: EpochRecord | null;
  /** Whether a record is presented here (mirrors the circuit's `claimRecordPresent`). */
  readonly present: boolean;
  /** present && epoch within range && uptime meets the threshold — this slot is credited. */
  readonly credited: boolean;
}

export interface ClaimWitnessPlan {
  readonly slots: readonly ClaimSlot[]; // exactly MAX_EPOCHS
  readonly epochsPassed: number;
  readonly epochsTotal: number;
}

/**
 * Assemble the claim witness layout the production claim-builder feeds to
 * `epoch_proof.claim` (DD-15): a fixed MAX_EPOCHS-slot vector of present flags and
 * the record presented in each slot, plus the resulting counters. Slot `s` binds
 * epoch `s + 1`; a slot is credited only when `s < epochsTotal`, a record is
 * presented, and its uptime meets `minUptimeBuckets`. Records outside the
 * contracted range are dropped; absent/withheld epochs are left empty (genesis
 * path on-chain) and only lower the count.
 *
 * This produces everything the claim witness needs EXCEPT the raw
 * `MerkleTreePath<20, EpochRecord>` for each presented record — those are read from
 * the published `epochRecords` tree at claim time via the ledger's
 * `findPathForLeaf`, a chain-state operation outside this package. `epochsPassed`
 * here equals `deriveClaimFromRecords(...).epochsPassed` by construction.
 */
export function planClaimWitness(
  records: readonly EpochRecord[],
  minUptimeBuckets: number,
  epochsTotal: number,
): ClaimWitnessPlan {
  if (!Number.isInteger(epochsTotal) || epochsTotal < 1 || epochsTotal > MAX_EPOCHS) {
    throw new RangeError(`epochsTotal must be in 1..${MAX_EPOCHS}, got ${epochsTotal}`);
  }
  // Latest record wins per epoch; only epochs within the contracted range are usable.
  const byEpoch = new Map<number, EpochRecord>();
  for (const r of records) {
    if (r.epoch >= 1 && r.epoch <= epochsTotal) byEpoch.set(r.epoch, r);
  }

  const slots: ClaimSlot[] = [];
  let epochsPassed = 0;
  for (let slot = 0; slot < MAX_EPOCHS; slot++) {
    const epoch = slot + 1;
    const inRange = slot < epochsTotal;
    const record = inRange ? byEpoch.get(epoch) ?? null : null;
    const present = record !== null;
    const credited = present && record!.uptime >= minUptimeBuckets;
    if (credited) epochsPassed++;
    slots.push({ slot, epoch, record, present, credited });
  }
  return { slots, epochsPassed, epochsTotal };
}

export function summarizeLog(entries: readonly EpochLogEntry[]): LogSummary {
  const scored = entries.filter((e) => e.scored);
  const passed = scored.filter((e) => e.verdict.pass).length;
  const uptimePct = scored.map((e) =>
    e.verdict.totalBuckets === 0
      ? 0
      : (e.verdict.uptimeBuckets / e.verdict.totalBuckets) * 100,
  );
  const avg = uptimePct.length === 0 ? 0 : uptimePct.reduce((a, b) => a + b, 0) / uptimePct.length;
  return {
    epochsObserved: entries.length,
    epochsScored: scored.length,
    epochsPassed: passed,
    avgUptimePct: Math.round(avg),
  };
}
