// Winsorized, time-weighted TWAP reference price.
//
// Computed from replayed pool state (price samples), NOT from an on-chain
// `observe()` oracle, which small pools often can't serve. Winsorization trims
// extreme samples so a thin pool can't be shoved to a manipulated reference;
// time-weighting makes the result independent of sample density.

import type { PriceSample } from "./provider.js";

export class TwapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwapError";
  }
}

/**
 * @param windowStart inclusive unix-seconds lower bound (filter only)
 * @param windowEnd   inclusive unix-seconds upper bound; weighting covers
 *                    [first sample in window, windowEnd]
 * @param winsorFraction fraction trimmed from each tail before weighting
 */
export function winsorizedTwap(
  samples: readonly PriceSample[],
  windowStart: number,
  windowEnd: number,
  winsorFraction: number,
): bigint {
  if (windowEnd <= windowStart) throw new TwapError("empty TWAP window");
  const inWindow = samples
    .filter((s) => s.ts >= windowStart && s.ts <= windowEnd)
    .sort((a, b) => a.ts - b.ts);
  if (inWindow.length === 0) throw new TwapError("no price samples in window");

  // Winsorize the price values.
  const prices = inWindow.map((s) => s.price).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const k = Math.floor(inWindow.length * winsorFraction);
  const low = prices[k]!;
  const high = prices[prices.length - 1 - k]!;
  const clamp = (p: bigint): bigint => (p < low ? low : p > high ? high : p);

  // Time-weight as a right-continuous step function over [first.ts, windowEnd].
  let weighted = 0n;
  let totalDur = 0n;
  for (let i = 0; i < inWindow.length; i++) {
    const cur = inWindow[i]!;
    const nextTs = i + 1 < inWindow.length ? inWindow[i + 1]!.ts : windowEnd;
    const dur = BigInt(Math.max(0, nextTs - cur.ts));
    weighted += clamp(cur.price) * dur;
    totalDur += dur;
  }
  if (totalDur === 0n) {
    // All samples at a single instant: fall back to the (winsorized) median.
    return clamp(inWindow[Math.floor(inWindow.length / 2)]!.price);
  }
  return weighted / totalDur;
}
