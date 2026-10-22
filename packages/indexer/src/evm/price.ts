// Spot-price replay for Uniswap v3 pools (Unit 3, step 2a).
//
// Orientation and scale are fixed decisions (progress_tracker, DD-19):
// - Orientation: a pool's base token is the one that is NOT one of the chain's quote
//   assets (`ChainConfig.quoteAssets`, ranked strongest first); if both are, the
//   higher-ranked one is the quote. A pool with no quote asset cannot be priced.
// - Scale: price = raw quote units per raw base unit, as Q96 fixed point
//   (× 2^96, floor). Computed exactly in bigint from slot0's sqrtPriceX96 — no float,
//   no decimals() call. Raw-unit ratios routinely fall below 1 (e.g. USDC per wei of
//   WETH ≈ 2.4e-9), so an unscaled integer would truncate to 0.

import type { BlockHeader } from "./rpc.js";

export const PRICE_FRACTION_BITS = 96n;

export class PriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceError";
  }
}

export interface Orientation {
  /** True when token0 is the base (so the quote is token1). */
  readonly baseIsToken0: boolean;
}

/** Decide base/quote for a pool from the chain's ranked quote-asset list. */
export function orientPool(quoteAssets: readonly string[], token0: bigint, token1: bigint): Orientation {
  const rank = (t: bigint): number => quoteAssets.findIndex((q) => BigInt(q) === t);
  const r0 = rank(token0);
  const r1 = rank(token1);
  if (r0 < 0 && r1 < 0) {
    throw new PriceError(
      `pool has no quote asset (token0 0x${token0.toString(16)}, token1 0x${token1.toString(16)})`,
    );
  }
  // The quote is the ranked token (lower index = stronger quote); the base is the other.
  if (r1 < 0) return { baseIsToken0: false };
  if (r0 < 0) return { baseIsToken0: true };
  return { baseIsToken0: r1 < r0 };
}

/**
 * Q96 price (raw quote per raw base) from a pool's sqrtPriceX96.
 * sqrtPriceX96² / 2^192 is token1 per token0 in raw units, so:
 *   base = token0: (sqrtP² ) >> 96
 *   base = token1: 2^288 / sqrtP²
 */
export function priceQ96FromSqrt(sqrtPriceX96: bigint, o: Orientation): bigint {
  if (sqrtPriceX96 <= 0n) throw new PriceError("pool is not initialized (sqrtPriceX96 = 0)");
  const sq = sqrtPriceX96 * sqrtPriceX96;
  return o.baseIsToken0 ? sq >> PRICE_FRACTION_BITS : (1n << (3n * PRICE_FRACTION_BITS)) / sq;
}

/**
 * The last block in [lo, hi] whose timestamp is ≤ t (the state in force at time t),
 * or null when every block in the range is later than t. The answer is unique, so the
 * search strategy (interpolation, falling back to bisection on alternate steps so the
 * worst case stays logarithmic) never changes the result.
 */
export async function lastBlockAtOrBefore(
  header: (n: number) => Promise<BlockHeader>,
  t: number,
  lo: number,
  hi: number,
): Promise<number | null> {
  if (hi < lo) throw new PriceError(`empty block range [${lo}, ${hi}]`);
  let tsLo = (await header(lo)).timestamp;
  if (tsLo > t) return null;
  let tsHi = (await header(hi)).timestamp;
  if (tsHi <= t) return hi;
  // Invariant: ts(lo) ≤ t < ts(hi).
  for (let step = 0; hi - lo > 1; step++) {
    let mid =
      step % 2 === 0 && tsHi > tsLo
        ? lo + Math.floor(((t - tsLo) * (hi - lo)) / (tsHi - tsLo))
        : lo + Math.floor((hi - lo) / 2);
    mid = Math.min(Math.max(mid, lo + 1), hi - 1);
    const ts = (await header(mid)).timestamp;
    if (ts <= t) {
      lo = mid;
      tsLo = ts;
    } else {
      hi = mid;
      tsHi = ts;
    }
  }
  return lo;
}

/** Sample times: every `stepSeconds` from startTs, plus endTs itself. */
export function sampleTimes(startTs: number, endTs: number, stepSeconds: number): number[] {
  if (!Number.isInteger(stepSeconds) || stepSeconds <= 0) {
    throw new PriceError(`sample step must be a positive integer, got ${stepSeconds}`);
  }
  if (endTs <= startTs) throw new PriceError(`empty sample window [${startTs}, ${endTs}]`);
  const out: number[] = [];
  for (let t = startTs; t < endTs; t += stepSeconds) out.push(t);
  out.push(endTs);
  return out;
}
