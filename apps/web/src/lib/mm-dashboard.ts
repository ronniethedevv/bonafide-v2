// MM-side dashboard projection — the market maker's private workspace view.
//
// Driven by REAL @mmr/witness capture output (see lib/world.ts): the per-epoch verdicts,
// uptime and the running outflow budget are projected from the captured records. The
// client portal projects from the same records, so both sides always agree. In
// production the dataset is replaced by the MM's live witness store read at request time.

import { WORLD, fmtUsd, metKpis, type EngagementRecord } from "./world";

export type EngagementState =
  | "registered" // committed on-chain, awaiting first epoch
  | "active" // running: capturing / proving epochs
  | "at_risk" // a failing streak or the budget cap is close
  | "completed" // all contracted epochs settled; claim available
  | "claimed" // claim proven; public reputation updated
  | "defaulted"; // failed / slashed

/** Each epoch moves through this pipeline. */
export type EpochPhase =
  | "pending" // not yet reached
  | "captured" // witness captured locally (@mmr/witness)
  | "proven" // proveEpoch generated + published
  | "attested" // >=2/3 committee signed the root
  | "settled"; // challenge window passed — final

export interface EpochStatus {
  epoch: number;
  phase: EpochPhase;
  /** Set once captured. */
  pass?: boolean;
  uptimeBuckets?: number;
  totalBuckets?: number;
}

export interface EngagementTermsView {
  pair: string; // e.g. "WETH / USDC"
  depthTargetLabel: string; // pre-formatted, e.g. "$250k / side"
  bandBps: number;
  minUptimePct: number; // minUptimeBuckets / totalBuckets, as %
  epochsTotal: number;
  loanLabel: string;
  roundtripCapPct: number;
}

export interface CarryBudget {
  usedLabel: string; // Σ outflow + from-treasury, pre-formatted
  capLabel: string; // disposal D, pre-formatted
  usedPct: number; // 0-100
  capHolds: boolean;
}

export interface BondView {
  postedLabel: string;
  status: "intact" | "releasing" | "released" | "slashed";
  releasedEpochs: number; // tranches released so far
  totalEpochs: number;
}

export interface MmEngagement {
  id: string; // public record id
  privateLabel: string; // the MM's own label for the deal (never published)
  clientName: string; // the counterparty (private to the two parties)
  state: EngagementState;
  terms: EngagementTermsView;
  currentEpoch: number; // 0 before the first epoch
  epochs: EpochStatus[]; // length = terms.epochsTotal
  carry: CarryBudget;
  bond: BondView;
}

export interface MmWorkspace {
  handle: string;
  displayName: string;
  engagements: MmEngagement[];
}

// --- derived views -------------------------------------------------------------------

export interface ClaimProgress {
  passed: number;
  captured: number;
  total: number;
  /** pass-rate over the contracted total (missing/failed epochs count against). */
  ratePct: number;
}

export function claimProgress(e: MmEngagement): ClaimProgress {
  let passed = 0;
  let captured = 0;
  for (const ep of e.epochs) {
    if (ep.phase !== "pending") captured++;
    if (ep.pass) passed++;
  }
  const total = e.terms.epochsTotal;
  return { passed, captured, total, ratePct: Math.round((passed / total) * 100) };
}

export type PipelineStage = "register" | "capture" | "prove" | "attest" | "claim" | "done";

export const PIPELINE: readonly PipelineStage[] = ["register", "capture", "prove", "attest", "claim"];

/** The engagement's current overall stage, for the stepper. */
export function pipelineStage(e: MmEngagement): PipelineStage {
  if (e.state === "registered") return "capture";
  if (e.state === "claimed") return "done";
  if (e.state === "completed") return "claim";
  // active / at_risk: the stage of the earliest not-yet-settled epoch that's been reached
  const reached = e.epochs.filter((x) => x.epoch <= e.currentEpoch);
  if (reached.some((x) => x.phase === "captured")) return "prove";
  if (reached.some((x) => x.phase === "proven")) return "attest";
  return "capture";
}

/** The single next thing the MM should do. */
export function nextAction(e: MmEngagement): string {
  switch (e.state) {
    case "registered":
      return "Capture epoch 1";
    case "completed":
      return `Claim (${claimProgress(e).passed}/${e.terms.epochsTotal} epochs passed)`;
    case "claimed":
      return "Complete — reputation updated";
    case "defaulted":
      return "Defaulted — bond slashed";
    default: {
      const cap = e.epochs.find((x) => x.epoch === e.currentEpoch);
      if (cap && cap.phase === "pending") return `Capture epoch ${e.currentEpoch}`;
      if (cap && cap.phase === "captured") return `Prove epoch ${e.currentEpoch}`;
      if (cap && cap.phase === "proven") return "Awaiting attesters";
      return `Capture epoch ${Math.min(e.currentEpoch + 1, e.terms.epochsTotal)}`;
    }
  }
}

export const STATE_LABEL: Record<EngagementState, string> = {
  registered: "Registered",
  active: "Active",
  at_risk: "At risk",
  completed: "Claim ready",
  claimed: "Claimed",
  defaulted: "Defaulted",
};

// --- projection from real @mmr/witness capture output --------------------------------

/** Engagement lifecycle state from how far capture has got. Shared with the client view. */
export function stateOf(e: EngagementRecord): EngagementState {
  const captured = e.witnesses.length;
  return captured === 0 ? "registered" : captured < e.epochsTotal ? "active" : "completed";
}

function projectEngagement(e: EngagementRecord): MmEngagement {
  const byEpoch = new Map(e.witnesses.map((w) => [w.epoch, w] as const));
  const epochs: EpochStatus[] = [];
  for (let n = 1; n <= e.epochsTotal; n++) {
    const w = byEpoch.get(n);
    if (!w) {
      epochs.push({ epoch: n, phase: "pending" });
      continue;
    }
    // A captured-but-unsettled epoch is in flight: show its phase, leave the result
    // pending (no pass) so it isn't counted or coloured as a miss. Settled epochs carry
    // the real KPI verdict (met / missed).
    epochs.push({
      epoch: n,
      phase: w.settled ? "settled" : "captured",
      ...(w.settled ? { pass: metKpis(w.invariants) } : {}),
      uptimeBuckets: w.uptimeBuckets,
      totalBuckets: w.totalBuckets,
    });
  }

  const captured = e.witnesses.length;
  const currentEpoch = captured ? Math.max(...e.witnesses.map((w) => w.epoch)) : 0;
  const state = stateOf(e);

  const last = captured ? e.witnesses.reduce((a, b) => (b.epoch > a.epoch ? b : a)) : undefined;
  const capRaw = BigInt(e.disposalD);
  const usedRaw = last ? BigInt(last.carry.newTotals.xferOut) : 0n;
  const carry: CarryBudget = {
    usedLabel: fmtUsd(usedRaw),
    capLabel: fmtUsd(capRaw),
    usedPct: capRaw === 0n ? 0 : Math.min(100, Math.round((Number(usedRaw) / Number(capRaw)) * 100)),
    capHolds: last ? last.carry.capHolds : true,
  };

  return {
    id: e.id,
    privateLabel: e.privateLabel,
    clientName: WORLD.clients[e.clientId]?.name ?? e.clientId,
    state,
    terms: {
      pair: e.pair,
      depthTargetLabel: e.depthTargetLabel,
      bandBps: e.bandBps,
      minUptimePct: e.minUptimePct,
      epochsTotal: e.epochsTotal,
      loanLabel: e.loanLabel,
      roundtripCapPct: e.roundtripCapPct,
    },
    currentEpoch,
    epochs,
    carry,
    bond: e.bond,
  };
}

const WORKSPACES: MmWorkspace[] = WORLD.workspaces.map((ws) => ({
  handle: ws.handle,
  displayName: ws.displayName,
  engagements: ws.engagements.map(projectEngagement),
}));

/** One MM's private workspace. Callers must check the signed-in MM owns `handle`. */
export function fetchWorkspace(handle: string): MmWorkspace | undefined {
  return WORKSPACES.find((w) => w.handle === handle);
}

/** Which MM workspace an engagement id belongs to (for ownership checks). */
export function ownerOf(id: string): string | undefined {
  return WORKSPACES.find((w) => w.engagements.some((e) => e.id === id))?.handle;
}

export function fetchEngagement(handle: string, id: string): { workspace: MmWorkspace; engagement: MmEngagement } | undefined {
  const workspace = fetchWorkspace(handle);
  const engagement = workspace?.engagements.find((e) => e.id === id);
  return workspace && engagement ? { workspace, engagement } : undefined;
}
