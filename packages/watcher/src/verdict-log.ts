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
 * not toward passed; passed can never exceed total. Both `minUptimeBuckets` and
 * `epochsTotal` are the committed terms the claim circuit reads (A1 / B1); here
 * they are explicit parameters until the Terms-schema change lands with the
 * circuit (see specs/progress_tracker.md DD-12).
 *
 * This is the known-answer spec the claim circuit (H4 circuit half) mirrors:
 * iterate epochs 1..epochsTotal, look up each in epochUptime, count those meeting
 * the threshold, and assert the claimed counters equal the counts.
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
