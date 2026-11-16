// Protocol timing parameters (seconds). Defaults from the product spec's timing
// table; all are "propose, tune in pilot".

export interface Timing {
  /** Epoch length. */
  epochSeconds: number;
  /** After epoch end, how long attesters have to publish the signed root. */
  attesterTimeoutSeconds: number;
  /** Challenge window after a root is published. */
  challengeSeconds: number;
  /** Proving window after the challenge window closes. */
  provingSeconds: number;
  /** Grace after the proving deadline: a late proof is flagged, not defaulted. */
  graceSeconds: number;
  /** After registration, how long an engagement has to be funded. */
  fundingWindowSeconds: number;
}

export const DEFAULT_TIMING: Timing = {
  epochSeconds: 24 * 60 * 60,
  attesterTimeoutSeconds: 6 * 60 * 60,
  challengeSeconds: 12 * 60 * 60,
  provingSeconds: 24 * 60 * 60,
  graceSeconds: 24 * 60 * 60,
  fundingWindowSeconds: 72 * 60 * 60,
};

export function assertTiming(t: Timing): void {
  for (const [k, v] of Object.entries(t)) {
    if (!Number.isFinite(v) || v <= 0) throw new Error(`timing.${k} must be > 0`);
  }
}
