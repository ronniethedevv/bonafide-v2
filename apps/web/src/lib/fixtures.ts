// Fixture profiles for the scaffold (no live backend yet). Shapes match the
// read model exactly, so swapping in a real data source later is a drop-in.

import type { EngagementRecord, MmProfile } from "./read-model";

function engagement(over: Partial<EngagementRecord> & Pick<EngagementRecord, "id">): EngagementRecord {
  return {
    tier: "B",
    sandbox: false,
    epochsPassed: 28,
    epochsTotal: 30,
    kpis: { depth: 97, uptime: 96, utilization: 71, custody: 100, noRoundTrips: 100 },
    custodyIntact: true,
    bond: { posted: "$10,000 USDM", status: "released" },
    completedAt: "2026-09-30",
    ...over,
  };
}

const vegaEpochSeries = [
  { epoch: 1, uptime: 88, depth: 90 },
  { epoch: 2, uptime: 91, depth: 92 },
  { epoch: 3, uptime: 90, depth: 93 },
  { epoch: 4, uptime: 94, depth: 95 },
  { epoch: 5, uptime: 93, depth: 94 },
  { epoch: 6, uptime: 96, depth: 97 },
  { epoch: 7, uptime: 95, depth: 96 },
  { epoch: 8, uptime: 97, depth: 98 },
  { epoch: 9, uptime: 96, depth: 97 },
  { epoch: 10, uptime: 98, depth: 99 },
  { epoch: 11, uptime: 97, depth: 98 },
  { epoch: 12, uptime: 99, depth: 99 },
];

const vega: MmProfile = {
  handle: "vega-mm",
  displayName: "Vega Market Making",
  headlineUptime: 96,
  tierCounts: { A: 2, B: 3, C: 1 },
  epochSeries: vegaEpochSeries,
  engagements: [
    engagement({
      id: "rec_01",
      tier: "A",
      epochsPassed: 30,
      epochsTotal: 30,
      kpis: { depth: 99, uptime: 99, utilization: 78, custody: 100, noRoundTrips: 100 },
      bond: { posted: "$12,500 USDM", status: "released" },
      completedAt: "2026-10-05",
    }),
    engagement({
      id: "rec_02",
      tier: "A",
      epochsPassed: 29,
      epochsTotal: 30,
      kpis: { depth: 98, uptime: 97, utilization: 74, custody: 100, noRoundTrips: 100 },
      bond: { posted: "$10,000 USDM", status: "released" },
      completedAt: "2026-09-18",
    }),
    engagement({ id: "rec_03" }),
    engagement({
      id: "rec_04",
      tier: "B",
      epochsPassed: 26,
      epochsTotal: 30,
      kpis: { depth: 94, uptime: 91, utilization: 64, custody: 100, noRoundTrips: 98 },
      bond: { posted: "$5,000 USDM", status: "released" },
      completedAt: "2026-08-22",
    }),
    engagement({
      id: "rec_05",
      tier: "B",
      epochsPassed: 30,
      epochsTotal: 30,
      kpis: { depth: 96, uptime: 95, utilization: 70, custody: 100, noRoundTrips: 100 },
      completedAt: "2026-07-30",
    }),
  ],
  sandbox: [
    engagement({
      id: "rec_sbx_01",
      tier: "C",
      sandbox: true,
      epochsPassed: 12,
      epochsTotal: 14,
      kpis: { depth: 88, uptime: 85, utilization: 59, custody: 100, noRoundTrips: 96 },
      bond: { posted: "—", status: "intact" },
      completedAt: "2026-06-10",
    }),
  ],
};

const PROFILES: Record<string, MmProfile> = {
  [vega.handle]: vega,
};

export function getProfile(handle: string): MmProfile | undefined {
  return PROFILES[handle];
}

export function listProfiles(): MmProfile[] {
  return Object.values(PROFILES);
}
