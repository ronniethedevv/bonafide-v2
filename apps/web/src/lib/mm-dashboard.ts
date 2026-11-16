// MM-side dashboard projection — the market maker's private workspace view.
//
// This mirrors the shape the real pipeline produces: engagement lifecycle state
// (protocol settlement machine), per-epoch phase + verdict (from @mmr/witness capture
// → proveEpoch → attesters → challenge window), the running carry-forward budget, bond
// status, and the single next action. It is seeded with realistic fixtures here; in
// production it is fed by the MM's local witness store + on-chain settlement state. The
// private fields (client label, wallet set, targets) never leave the MM's own session.

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

// --- seed -----------------------------------------------------------------------------

function mkEpochs(total: number, settledThrough: number, opts: {
  failed?: number[]; // epochs that were captured but failed
  capturedThrough?: number; // captured (not yet proven) up to here
  provenThrough?: number; // proven (not yet attested) up to here
  attestedThrough?: number; // attested (not yet settled) up to here
} = {}): EpochStatus[] {
  const out: EpochStatus[] = [];
  const failed = new Set(opts.failed ?? []);
  for (let e = 1; e <= total; e++) {
    let phase: EpochPhase = "pending";
    if (e <= settledThrough) phase = "settled";
    else if (opts.attestedThrough && e <= opts.attestedThrough) phase = "attested";
    else if (opts.provenThrough && e <= opts.provenThrough) phase = "proven";
    else if (opts.capturedThrough && e <= opts.capturedThrough) phase = "captured";
    if (phase === "pending") {
      out.push({ epoch: e, phase });
      continue;
    }
    const pass = !failed.has(e);
    out.push({ epoch: e, phase, pass, uptimeBuckets: pass ? 46 : 31, totalBuckets: 48 });
  }
  return out;
}

const WORKSPACE: MmWorkspace = {
  handle: "vega-mm",
  displayName: "Vega Market Making",
  engagements: [
    {
      id: "rec_07",
      privateLabel: "Orion desk — WETH pair",
      state: "active",
      terms: {
        pair: "WETH / USDC", depthTargetLabel: "$250k / side", bandBps: 100, minUptimePct: 90,
        epochsTotal: 30, loanLabel: "$2.0M", roundtripCapPct: 60,
      },
      currentEpoch: 14,
      // 1–12 settled (epoch 5 failed), 13 attested, 14 captured (awaiting prove)
      epochs: mkEpochs(30, 12, { failed: [5], attestedThrough: 13, capturedThrough: 14 }),
      carry: { usedLabel: "$1.21M", capLabel: "$2.00M", usedPct: 61, capHolds: true },
      bond: { postedLabel: "$120k USDM", status: "intact", releasedEpochs: 0, totalEpochs: 30 },
    },
    {
      id: "rec_06",
      privateLabel: "Helix — cbBTC pair",
      state: "completed",
      terms: {
        pair: "cbBTC / USDC", depthTargetLabel: "$180k / side", bandBps: 100, minUptimePct: 90,
        epochsTotal: 30, loanLabel: "$1.5M", roundtripCapPct: 60,
      },
      currentEpoch: 30,
      epochs: mkEpochs(30, 30, { failed: [9, 22] }), // all settled, 28/30 passed
      carry: { usedLabel: "$1.38M", capLabel: "$1.60M", usedPct: 86, capHolds: true },
      bond: { postedLabel: "$90k USDM", status: "intact", releasedEpochs: 0, totalEpochs: 30 },
    },
    {
      id: "rec_05",
      privateLabel: "Aster — WETH pair",
      state: "claimed",
      terms: {
        pair: "WETH / USDC", depthTargetLabel: "$200k / side", bandBps: 100, minUptimePct: 85,
        epochsTotal: 30, loanLabel: "$1.8M", roundtripCapPct: 60,
      },
      currentEpoch: 30,
      epochs: mkEpochs(30, 30, { failed: [] }),
      carry: { usedLabel: "$1.52M", capLabel: "$2.00M", usedPct: 76, capHolds: true },
      bond: { postedLabel: "$100k USDM", status: "releasing", releasedEpochs: 12, totalEpochs: 30 },
    },
    {
      id: "rec_08",
      privateLabel: "Nimbus — new desk",
      state: "registered",
      terms: {
        pair: "DEGEN / WETH", depthTargetLabel: "$60k / side", bandBps: 200, minUptimePct: 80,
        epochsTotal: 14, loanLabel: "$300k", roundtripCapPct: 70,
      },
      currentEpoch: 0,
      epochs: mkEpochs(14, 0, {}),
      carry: { usedLabel: "$0", capLabel: "$300k", usedPct: 0, capHolds: true },
      bond: { postedLabel: "$30k USDM", status: "intact", releasedEpochs: 0, totalEpochs: 14 },
    },
  ],
};

export function fetchWorkspace(handle: string): MmWorkspace | undefined {
  return handle === WORKSPACE.handle ? WORKSPACE : undefined;
}

export function fetchEngagement(handle: string, id: string): { workspace: MmWorkspace; engagement: MmEngagement } | undefined {
  const workspace = fetchWorkspace(handle);
  const engagement = workspace?.engagements.find((e) => e.id === id);
  return workspace && engagement ? { workspace, engagement } : undefined;
}
