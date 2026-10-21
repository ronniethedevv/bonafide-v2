// DB-backed ProfileRepository.
//
// Reconstructs the nested MmProfile projection from flat store rows. It is pure
// assembly over an injected ProfileStore — no formatting, no I/O of its own — so it
// is a drop-in for FixtureProfileRepository and is fully unit-tested against a fake
// store. tierCounts are derived here (not stored) so they cannot drift from the
// engagement rows.

import type {
  EngagementRecord,
  EpochPoint,
  MmProfile,
  ProfileRepository,
  Tier,
} from "@mmr/read-model";
import type { EngagementRow, EpochPointRow, MmRow, ProfileStore } from "./store.js";

const TIERS: readonly Tier[] = ["A", "B", "C"];

export class DbProfileRepository implements ProfileRepository {
  constructor(private readonly store: ProfileStore) {}

  async list(): Promise<MmProfile[]> {
    const mms = await this.store.listMms();
    return Promise.all(mms.map((mm) => this.assemble(mm)));
  }

  async get(handle: string): Promise<MmProfile | undefined> {
    const mm = await this.store.getMm(handle);
    if (!mm) return undefined;
    return this.assemble(mm);
  }

  private async assemble(mm: MmRow): Promise<MmProfile> {
    const [engagementRows, epochRows] = await Promise.all([
      this.store.engagementsFor(mm.handle),
      this.store.epochSeriesFor(mm.handle),
    ]);

    const records = engagementRows.map(toEngagementRecord);
    return {
      handle: mm.handle,
      displayName: mm.displayName,
      headlineUptime: mm.headlineUptime,
      tierCounts: tierCounts(records),
      epochSeries: epochRows.map(toEpochPoint).sort((a, b) => a.epoch - b.epoch),
      engagements: records.filter((e) => !e.sandbox),
      sandbox: records.filter((e) => e.sandbox),
    };
  }
}

function toEngagementRecord(r: EngagementRow): EngagementRecord {
  return {
    id: r.recordId,
    tier: r.tier,
    sandbox: r.sandbox,
    epochsPassed: r.epochsPassed,
    epochsTotal: r.epochsTotal,
    kpis: {
      depth: r.kpiDepth,
      uptime: r.kpiUptime,
      utilization: r.kpiUtilization,
      custody: r.kpiCustody,
      noRoundTrips: r.kpiNoRoundTrips,
    },
    custodyIntact: r.custodyIntact,
    bond: { posted: r.bondPosted, status: r.bondStatus },
    completedAt: r.completedAt,
  };
}

function toEpochPoint(r: EpochPointRow): EpochPoint {
  return { epoch: r.epoch, uptime: r.uptime, depth: r.depth };
}

function tierCounts(records: readonly EngagementRecord[]): Record<Tier, number> {
  const counts: Record<Tier, number> = { A: 0, B: 0, C: 0 };
  for (const e of records) if (TIERS.includes(e.tier)) counts[e.tier] += 1;
  return counts;
}
