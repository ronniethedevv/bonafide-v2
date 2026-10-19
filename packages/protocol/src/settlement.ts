// Epoch settlement: when does an epoch count, and what happens if it doesn't.
//
// Encodes the spec's timing rules deterministically (I8 + the engagement state
// machine's epoch-level transitions). Pure: given the same inputs and clock it
// always returns the same outcome, so a watcher and the contract agree.

import { type Timing } from "./timing.js";

export type EpochOutcome =
  | "awaiting-root" // attesters have not yet published a valid root; window open
  | "voided-no-root" // no valid root by the attester timeout → void, no penalty
  | "in-challenge" // root published and valid; challenge window still open
  | "challenged" // someone challenged the root; must be resolved off this path
  | "proving" // settled root; MM's proving window open, no proof yet
  | "grace" // proving deadline passed; late proof allowed (will be flagged)
  | "settled" // valid proof accepted within the proving window → scored
  | "settled-flagged" // valid proof accepted in grace → scored but flagged
  | "defaulted"; // no valid proof by the grace deadline → default (slash)

export interface RootState {
  /** Unix seconds the signed root was published. */
  publishedTs: number;
  /** Number of attester signatures on (epoch, root, cid). */
  signatureCount: number;
}

export interface SettlementInput {
  epochEndTs: number;
  now: number;
  /** null until attesters publish. */
  root: RootState | null;
  /** Required attester signatures (2 of 3 in v1). */
  threshold: number;
  /** A challenge was raised within the challenge window. */
  challenged: boolean;
  /** Unix seconds a valid MM proof was accepted, or null. */
  proofAcceptedTs: number | null;
  timing: Timing;
}

export interface SettlementResult {
  outcome: EpochOutcome;
  deadlines: {
    attesterDeadline: number;
    challengeEnd: number | null;
    provingDeadline: number | null;
    graceDeadline: number | null;
  };
}

/** I8 helper: the root is settled (counts for scoring) at `now`. */
export function rootIsSettled(input: Omit<SettlementInput, "proofAcceptedTs">): boolean {
  const { root, threshold, challenged, now, timing } = input;
  if (root === null || root.signatureCount < threshold || challenged) return false;
  return now >= root.publishedTs + timing.challengeSeconds;
}

export function evaluateEpochSettlement(input: SettlementInput): SettlementResult {
  const { epochEndTs, now, root, threshold, challenged, proofAcceptedTs, timing } = input;
  const attesterDeadline = epochEndTs + timing.attesterTimeoutSeconds;

  const noValidRoot = root === null || root.signatureCount < threshold;
  if (noValidRoot) {
    return {
      outcome: now >= attesterDeadline ? "voided-no-root" : "awaiting-root",
      deadlines: { attesterDeadline, challengeEnd: null, provingDeadline: null, graceDeadline: null },
    };
  }

  const challengeEnd = root.publishedTs + timing.challengeSeconds;
  const provingDeadline = challengeEnd + timing.provingSeconds;
  const graceDeadline = provingDeadline + timing.graceSeconds;
  const deadlines = { attesterDeadline, challengeEnd, provingDeadline, graceDeadline };

  if (challenged) return { outcome: "challenged", deadlines };
  if (now < challengeEnd) return { outcome: "in-challenge", deadlines };

  // Challenge window passed unchallenged → root is settled; proving window governs.
  if (proofAcceptedTs !== null) {
    if (proofAcceptedTs <= provingDeadline) return { outcome: "settled", deadlines };
    if (proofAcceptedTs <= graceDeadline) return { outcome: "settled-flagged", deadlines };
    return { outcome: "defaulted", deadlines };
  }
  if (now <= provingDeadline) return { outcome: "proving", deadlines };
  if (now <= graceDeadline) return { outcome: "grace", deadlines };
  return { outcome: "defaulted", deadlines };
}

/** Outcomes that count toward the scored record. */
export function isScored(outcome: EpochOutcome): boolean {
  return outcome === "settled" || outcome === "settled-flagged";
}

/** Outcomes that slash the bond. */
export function isDefault(outcome: EpochOutcome): boolean {
  return outcome === "defaulted";
}
