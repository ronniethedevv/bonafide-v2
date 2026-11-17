// Client-side projection — the counterparty's privileged view of an engagement.
//
// The crucial difference from the public profile: as the client (the party to the deal)
// you hold the opened commitments, so you see the ACTUAL per-epoch figures the MM proved
// — how many 30-minute buckets met the depth target, round-trip share, custody and outflow
// checks — against the agreed terms. The public only ever sees the pass/fail outcome.
//
// Projected from the SAME real @mmr/witness records as the MM workspace (lib/world.ts),
// so what the client sees always matches what the MM sees. In production it is served
// from the MM's published data opened to the client's key, plus on-chain settlement state.

import { WORLD, allEngagements, metKpis, type EngagementRecord, type WorkspaceRecord } from "./world";
import { stateOf, type EngagementState, type EpochPhase } from "./mm-dashboard";

export interface ClientEpoch {
  epoch: number;
  phase: EpochPhase;
  /** Only set once the epoch has settled. */
  pass?: boolean;
  /** 30-min buckets where the MM's depth met the target, out of the epoch's buckets. */
  bucketsAtTarget: number;
  totalBuckets: number;
  uptimePct: number;
  uptimeOk: boolean;
  /** Share of the MM's volume that round-tripped (wash-style), vs the agreed cap. */
  roundTripPct: number;
  roundTripOk: boolean;
  custodyIntact: boolean;
  outflowOk: boolean;
}

export interface ClientEngagement {
  id: string;
  clientId: string;
  mmHandle: string;
  mmName: string;
  pair: string;
  state: EngagementState;
  currentEpoch: number;
  epochsTotal: number;
  epochs: ClientEpoch[]; // captured epochs only, ascending
  /** The MM's bond that protects the client (slashed on default). */
  bondAtStakeLabel: string;
  depthTargetLabel: string;
  bandBps: number;
  uptimeTargetPct: number;
  minUptimeBuckets: number;
  roundtripCapPct: number;
  /** The latest settled epoch of a running engagement is still inside its challenge window. */
  challengeableEpoch: number | null;
  challengeWindowHours: number;
}

export interface ClientPortal {
  clientId: string;
  clientName: string;
  engagements: ClientEngagement[];
}

export interface ClientSummary {
  met: number;
  settled: number;
  total: number;
  avgUptime: number;
}

export function clientSummary(e: ClientEngagement): ClientSummary {
  const settled = e.epochs.filter((x) => x.phase === "settled");
  const met = settled.filter((x) => x.pass).length;
  const avgUptime = e.epochs.length ? Math.round(e.epochs.reduce((s, x) => s + x.uptimePct, 0) / e.epochs.length) : 0;
  return { met, settled: settled.length, total: e.epochsTotal, avgUptime };
}

function pct(num: bigint, den: bigint): number {
  return den === 0n ? 0 : Math.round((Number(num) / Number(den)) * 100);
}

function project(mm: WorkspaceRecord, e: EngagementRecord): ClientEngagement {
  const epochs: ClientEpoch[] = e.witnesses
    .slice()
    .sort((a, b) => a.epoch - b.epoch)
    .map((w) => ({
      epoch: w.epoch,
      phase: w.settled ? "settled" : "captured",
      ...(w.settled ? { pass: metKpis(w.invariants) } : {}),
      bucketsAtTarget: w.uptimeBuckets,
      totalBuckets: w.totalBuckets,
      uptimePct: Math.round((w.uptimeBuckets / w.totalBuckets) * 100),
      uptimeOk: w.invariants.I6_uptime === true,
      roundTripPct: pct(BigInt(w.sums.roundTripVolume), BigInt(w.sums.grossVolume)),
      roundTripOk: w.invariants.I7_roundTripCap === true,
      custodyIntact: w.invariants.I3_custodyFloor === true,
      outflowOk: w.invariants.I5_outflowCap === true && w.carry.capHolds,
    }));
  const state = stateOf(e);
  const lastSettled = [...epochs].reverse().find((x) => x.phase === "settled");
  return {
    id: e.id,
    clientId: e.clientId,
    mmHandle: mm.handle,
    mmName: mm.displayName,
    pair: e.pair,
    state,
    currentEpoch: epochs.length ? epochs[epochs.length - 1]!.epoch : 0,
    epochsTotal: e.epochsTotal,
    epochs,
    bondAtStakeLabel: e.bond.postedLabel,
    depthTargetLabel: e.depthTargetLabel,
    bandBps: e.bandBps,
    uptimeTargetPct: e.minUptimePct,
    minUptimeBuckets: e.minUptimeBuckets,
    roundtripCapPct: e.roundtripCapPct,
    challengeableEpoch: state === "active" && lastSettled ? lastSettled.epoch : null,
    challengeWindowHours: 24,
  };
}

/** One client's portal. Callers must check the signed-in client is `clientId`. */
export function fetchPortal(clientId: string): ClientPortal | undefined {
  const client = WORLD.clients[clientId];
  if (!client) return undefined;
  return {
    clientId,
    clientName: client.name,
    engagements: allEngagements()
      .filter(({ e }) => e.clientId === clientId)
      .map(({ mm, e }) => project(mm, e)),
  };
}

export function fetchClientEngagement(clientId: string, id: string): ClientEngagement | undefined {
  return fetchPortal(clientId)?.engagements.find((e) => e.id === id);
}

/** Which client an engagement id belongs to (for ownership checks). */
export function clientOf(id: string): string | undefined {
  return allEngagements().find(({ e }) => e.id === id)?.e.clientId;
}
