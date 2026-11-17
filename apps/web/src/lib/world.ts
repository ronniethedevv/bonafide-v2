// The app's demo world: two market makers, two clients, five engagements — every epoch
// a REAL @mmr/witness capture record (I1–I8 oracle + carry-forward chaining), produced by
// packages/witness/scripts/seed-dashboard.mts. The MM workspace AND the client portal
// both project from this one dataset, so the two sides of an engagement always agree.
//
// In production this file is replaced by the engagement registry (on-chain) plus each
// MM's live witness store and the attestation feed; the projections stay the same.

import worldJson from "@/data/world.json";

export interface WitnessRecord {
  engagementId: string;
  epoch: number;
  range: { startBlock: number; endBlock: number; startTs: number; endTs: number; endBlockHash: string };
  settled: boolean;
  pass: boolean;
  uptimeBuckets: number;
  totalBuckets: number;
  invariants: Record<string, boolean>;
  sums: {
    heldBase: string;
    heldQuoteAtP: string;
    xferIn: string;
    xferOut: string;
    fromTreasury: string;
    roundTripVolume: string;
    grossVolume: string;
  };
  carry: {
    newTotals: { xferIn: string; xferOut: string; fromTreasury: string };
    newCommitment: string;
    capHolds: boolean;
    ok: boolean;
  };
}

export interface EngagementRecord {
  id: string;
  clientId: string;
  pair: string;
  privateLabel: string;
  bond: { postedLabel: string; status: "intact" | "releasing" | "released" | "slashed"; releasedEpochs: number; totalEpochs: number };
  loanLabel: string;
  depthTargetLabel: string;
  bandBps: number;
  minUptimePct: number;
  minUptimeBuckets: number;
  roundtripCapPct: number;
  epochsTotal: number;
  disposalD: string;
  witnesses: WitnessRecord[];
}

export interface WorkspaceRecord {
  handle: string;
  displayName: string;
  engagements: EngagementRecord[];
}

export interface World {
  clients: Record<string, { name: string }>;
  workspaces: WorkspaceRecord[];
}

export const WORLD = worldJson as unknown as World;

/** Did the MM meet every KPI invariant this epoch (I1–I7) — settlement (I8) aside. */
export function metKpis(inv: Record<string, boolean>): boolean {
  return Object.entries(inv).every(([k, v]) => k === "I8_settled" || v === true);
}

export function fmtUsd(raw: bigint): string {
  const n = Number(raw);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

/** Every engagement in the world with its owning MM. */
export function allEngagements(): Array<{ mm: WorkspaceRecord; e: EngagementRecord }> {
  return WORLD.workspaces.flatMap((mm) => mm.engagements.map((e) => ({ mm, e })));
}
