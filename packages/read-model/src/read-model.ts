// Public read model — a DISPLAY projection, downstream of the indexer/prover.
//
// Amounts are pre-formatted strings so consumers never handle bigint or raw chain
// data, and it only ever carries what the privacy model says is public (completed
// engagements, KPI hit-rates, custody record, bond history, tier) — never clients,
// tokens, wallets, KPI targets, or live results. Shared by the API and the web app.

export type Tier = "A" | "B" | "C";

export type BondStatus = "intact" | "released" | "slashed";

export interface KpiHitRates {
  /** Percent of epochs the KPI was met, 0-100. */
  depth: number;
  uptime: number;
  utilization: number;
  custody: number;
  noRoundTrips: number;
}

export interface EngagementRecord {
  /** Opaque public record id (not the private engagement id). */
  id: string;
  tier: Tier;
  sandbox: boolean;
  epochsPassed: number;
  epochsTotal: number;
  kpis: KpiHitRates;
  custodyIntact: boolean;
  bond: {
    /** Pre-formatted, e.g. "$10,000 USDM". */
    posted: string;
    status: BondStatus;
  };
  /** ISO date the engagement completed. */
  completedAt: string;
  /** Set when the attestation backing this engagement has been revoked (EAS-style). */
  revoked?: boolean;
}

/**
 * Honest scope statement — what the record covers and, as importantly, what it does not.
 * Mirrors @mmr/attest's Coverage so a display and a verifier agree on the caveat. The
 * public engagements are self-selected by the market maker, so an absent engagement is
 * not evidence of good conduct; this must be stated, not implied.
 */
export interface Coverage {
  /** Chain ids indexed (e.g. [8453, 1]). */
  chains: number[];
  /** DEX venues covered (e.g. ["uniswap-v3"]). */
  venues: string[];
  scope: "self-selected-public-engagements";
  note: string;
}

export const DEFAULT_COVERAGE_NOTE =
  "This record is built from on-chain DEX activity and shows engagements the market " +
  "maker has chosen to make public. It is not a complete trading history — off-chain " +
  "and CEX venues are out of scope, and the absence of an engagement is not evidence " +
  "of good conduct.";

export type Freshness = "fresh" | "ageing" | "stale";

/** One epoch's headline metrics, for the change-over-time chart. */
export interface EpochPoint {
  epoch: number;
  /** Uptime hit-rate for the epoch, 0-100. */
  uptime: number;
  /** Depth hit-rate for the epoch, 0-100. */
  depth: number;
}

export interface MmProfile {
  handle: string;
  displayName: string;
  /** Headline uptime across completed, non-sandbox engagements, 0-100. */
  headlineUptime: number;
  tierCounts: Record<Tier, number>;
  /** Recent per-epoch uptime/depth, oldest→newest, for the hero chart. */
  epochSeries: EpochPoint[];
  /** Completed, headline (non-sandbox) engagements. */
  engagements: EngagementRecord[];
  /** Sandbox (tier C) engagements, shown separately. */
  sandbox: EngagementRecord[];
  /** Scope statement (optional; use coverageOf for a safe default). */
  coverage?: Coverage;
}

export function totalCompleted(profile: MmProfile): number {
  return profile.engagements.length + profile.sandbox.length;
}

/** A record's non-revoked engagements — the only ones that should feed headline stats. */
export function liveEngagements(records: readonly EngagementRecord[]): EngagementRecord[] {
  return records.filter((e) => !e.revoked);
}

/**
 * The scope statement, defaulting to the platform's indexed scope (Base + Ethereum
 * Uniswap v3) and the honest caveat when a profile omits one.
 */
export function coverageOf(profile: MmProfile): Coverage {
  return (
    profile.coverage ?? {
      chains: [8453, 1],
      venues: ["uniswap-v3"],
      scope: "self-selected-public-engagements",
      note: DEFAULT_COVERAGE_NOTE,
    }
  );
}

/** Freshness bucket for an ISO date against `now` (defaults: <30d fresh, <90d ageing, else stale). */
export function freshnessOf(
  iso: string,
  now: number = Date.now(),
  freshDays = 30,
  ageingDays = 90,
): Freshness {
  const ageDays = (now - Date.parse(iso)) / 86_400_000;
  if (ageDays < freshDays) return "fresh";
  if (ageDays < ageingDays) return "ageing";
  return "stale";
}

/** Most recent completion across live engagements + sandbox, or null if none. */
export function lastActivityAt(profile: MmProfile): string | null {
  const dates = [...liveEngagements(profile.engagements), ...liveEngagements(profile.sandbox)]
    .map((e) => e.completedAt)
    .sort();
  return dates.length ? dates[dates.length - 1]! : null;
}

/** How current the record is, by its most recent engagement. */
export function profileFreshness(profile: MmProfile, now: number = Date.now()): Freshness | null {
  const last = lastActivityAt(profile);
  return last ? freshnessOf(last, now) : null;
}

export function overallKpiHitRate(e: EngagementRecord): number {
  const v = e.kpis;
  const avg = (v.depth + v.uptime + v.utilization + v.custody + v.noRoundTrips) / 5;
  return Math.round(avg);
}
