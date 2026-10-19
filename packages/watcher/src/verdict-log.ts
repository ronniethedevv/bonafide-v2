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
