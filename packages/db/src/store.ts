// Narrow read port between the repository and the database.
//
// Rows are DISPLAY-READY (pre-formatted strings, e.g. "$10,000 USDM", ISO dates),
// exactly as the read model exposes them — the projection worker that fills these
// tables owns all formatting and the privacy filter (it only ever writes public
// fields). This port therefore carries no bigint / raw chain data, and the
// repository above it does structure assembly only, never formatting. Keeping the
// port hand-written (no Prisma types) lets the repository be unit-tested against a
// fake with no database, and keeps @prisma/client out of the typecheck graph until
// the client is generated (see prisma/schema.prisma).

import type { Tier, BondStatus } from "@mmr/read-model";

export interface MmRow {
  readonly handle: string;
  readonly displayName: string;
  /** Headline uptime, 0-100, computed and stored by the projection worker. */
  readonly headlineUptime: number;
}

export interface EngagementRow {
  readonly recordId: string;
  readonly handle: string;
  readonly tier: Tier;
  readonly sandbox: boolean;
  readonly epochsPassed: number;
  readonly epochsTotal: number;
  readonly kpiDepth: number;
  readonly kpiUptime: number;
  readonly kpiUtilization: number;
  readonly kpiCustody: number;
  readonly kpiNoRoundTrips: number;
  readonly custodyIntact: boolean;
  /** Pre-formatted, e.g. "$10,000 USDM" or "n/a". */
  readonly bondPosted: string;
  readonly bondStatus: BondStatus;
  /** ISO date the engagement completed. */
  readonly completedAt: string;
}

export interface EpochPointRow {
  readonly handle: string;
  readonly epoch: number;
  readonly uptime: number;
  readonly depth: number;
}

/** Everything the repository reads. A Prisma implementation lives in prisma/. */
export interface ProfileStore {
  getMm(handle: string): Promise<MmRow | null>;
  listMms(): Promise<MmRow[]>;
  engagementsFor(handle: string): Promise<EngagementRow[]>;
  epochSeriesFor(handle: string): Promise<EpochPointRow[]>;
}
