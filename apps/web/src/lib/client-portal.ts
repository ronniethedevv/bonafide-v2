// Client-side projection — the counterparty's privileged view of an engagement.
//
// The crucial difference from the public profile: as the client (the party to the deal)
// you hold the opened commitments, so you see the ACTUAL per-epoch figures the MM proved
// — depth achieved, uptime, utilization, custody, flow — against the agreed targets. The
// public only ever sees the pass/fail outcome. This is the product's selective-disclosure
// value made concrete, and the surface where a client monitors, verifies and can dispute.
//
// Seeded here; in production it is served from the MM's published data opened to the
// client's key, plus on-chain settlement state.

import type { EngagementState, EpochPhase } from "./mm-dashboard";

export interface ClientEpoch {
  epoch: number;
  phase: EpochPhase;
  pass: boolean;
  /** Actual figures (opened commitments) vs the agreed targets. */
  depthAchievedLabel: string;
  depthMet: boolean;
  uptimePct: number;
  utilizationPct: number;
  custodyIntact: boolean;
  noRoundTrips: boolean;
}

export interface ClientEngagement {
  id: string;
  mmHandle: string;
  mmName: string;
  pair: string;
  state: EngagementState;
  currentEpoch: number;
  epochsTotal: number;
  epochs: ClientEpoch[];
  /** The MM's bond that protects the client (slashed on default). */
  bondAtStakeLabel: string;
  depthTargetLabel: string;
  uptimeTargetPct: number;
  /** An epoch recently settled is still inside its challenge window; null = none open. */
  challengeableEpoch: number | null;
  challengeWindowHours: number;
}

export interface ClientPortal {
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
  const reached = e.epochs.filter((x) => x.phase !== "pending");
  const met = reached.filter((x) => x.pass).length;
  const avgUptime = reached.length ? Math.round(reached.reduce((s, x) => s + x.uptimePct, 0) / reached.length) : 0;
  return { met, settled: reached.filter((x) => x.phase === "settled").length, total: e.epochsTotal, avgUptime };
}

// --- seed -----------------------------------------------------------------------------

function wobble(base: number, i: number, amp: number): number {
  // deterministic pseudo-variation so the fixture is stable across renders
  return Math.round((base + Math.sin(i * 1.7) * amp) * 10) / 10;
}

function mkEpochs(total: number, settledThrough: number, targetDepthK: number, targetUptime: number, opts: { failed?: number[]; capturedThrough?: number } = {}): ClientEpoch[] {
  const failed = new Set(opts.failed ?? []);
  const out: ClientEpoch[] = [];
  for (let e = 1; e <= total; e++) {
    let phase: EpochPhase = "pending";
    if (e <= settledThrough) phase = "settled";
    else if (opts.capturedThrough && e <= opts.capturedThrough) phase = e === opts.capturedThrough ? "captured" : "attested";
    if (phase === "pending") {
      out.push({ epoch: e, phase, pass: false, depthAchievedLabel: "—", depthMet: false, uptimePct: 0, utilizationPct: 0, custodyIntact: true, noRoundTrips: true });
      continue;
    }
    const fail = failed.has(e);
    const depthK = fail ? targetDepthK * 0.82 : wobble(targetDepthK * 1.06, e, targetDepthK * 0.05);
    const uptime = fail ? Math.max(0, targetUptime - wobble(14, e, 6)) : Math.min(100, wobble(targetUptime + 5, e, 3));
    out.push({
      epoch: e,
      phase,
      pass: !fail,
      depthAchievedLabel: `$${Math.round(depthK)}k`,
      depthMet: depthK >= targetDepthK,
      uptimePct: Math.round(uptime),
      utilizationPct: Math.round(wobble(72, e, 8)),
      custodyIntact: true,
      noRoundTrips: !fail,
    });
  }
  return out;
}

const PORTAL: ClientPortal = {
  clientName: "Orion Capital",
  engagements: [
    {
      id: "rec_07",
      mmHandle: "vega-mm",
      mmName: "Vega Market Making",
      pair: "WETH / USDC",
      state: "active",
      currentEpoch: 14,
      epochsTotal: 30,
      epochs: mkEpochs(30, 13, 250, 90, { failed: [5], capturedThrough: 14 }),
      bondAtStakeLabel: "$120k USDM",
      depthTargetLabel: "$250k / side @ ±100bps",
      uptimeTargetPct: 90,
      challengeableEpoch: 13,
      challengeWindowHours: 24,
    },
    {
      id: "rec_06",
      mmHandle: "vega-mm",
      mmName: "Vega Market Making",
      pair: "cbBTC / USDC",
      state: "completed",
      currentEpoch: 30,
      epochsTotal: 30,
      epochs: mkEpochs(30, 30, 180, 90, { failed: [9, 22] }),
      bondAtStakeLabel: "$90k USDM",
      depthTargetLabel: "$180k / side @ ±100bps",
      uptimeTargetPct: 90,
      challengeableEpoch: null,
      challengeWindowHours: 24,
    },
  ],
};

export function fetchPortal(): ClientPortal {
  return PORTAL;
}

export function fetchClientEngagement(id: string): ClientEngagement | undefined {
  return PORTAL.engagements.find((e) => e.id === id);
}
