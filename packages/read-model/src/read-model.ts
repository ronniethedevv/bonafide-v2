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
}

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
}

export function totalCompleted(profile: MmProfile): number {
  return profile.engagements.length + profile.sandbox.length;
}

export function overallKpiHitRate(e: EngagementRecord): number {
  const v = e.kpis;
  const avg = (v.depth + v.uptime + v.utilization + v.custody + v.noRoundTrips) / 5;
  return Math.round(avg);
}
