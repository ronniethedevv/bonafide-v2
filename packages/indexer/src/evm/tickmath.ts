// Uniswap v3 price / amount math, exact in bigint (Unit 3 / 2c depth, DD-23).
//
// getSqrtRatioAtTick is a bit-for-bit port of TickMath.sol; amount0/amount1 follow
// SqrtPriceMath.getAmount{0,1}Delta rounding DOWN (depth is never overstated).

export const Q96 = 1n << 96n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
export const MIN_SQRT_RATIO = 4295128739n;
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

const MAX_U256 = (1n << 256n) - 1n;

/** sqrt(1.0001^tick) · 2^96, exactly as TickMath.getSqrtRatioAtTick. */
export function getSqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) throw new RangeError(`tick out of range: ${tick}`);
  const absTick = BigInt(Math.abs(tick));
  let ratio = (absTick & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  const steps: [bigint, bigint][] = [
    [0x2n, 0xfff97272373d413259a46990580e213an],
    [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
    [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
    [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
    [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
    [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
    [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n],
  ];
  for (const [bit, mul] of steps) if ((absTick & bit) !== 0n) ratio = (ratio * mul) >> 128n;
  if (tick > 0) ratio = MAX_U256 / ratio;
  // Q128.128 -> Q64.96, rounding up
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

/** Token0 between two sqrt prices for liquidity L, rounded down. */
export function amount0Delta(sa: bigint, sb: bigint, liquidity: bigint): bigint {
  const [lo, hi] = sa < sb ? [sa, sb] : [sb, sa];
  if (lo <= 0n) throw new RangeError("sqrt price must be positive");
  return ((liquidity << 96n) * (hi - lo)) / hi / lo;
}

/** Token1 between two sqrt prices for liquidity L, rounded down. */
export function amount1Delta(sa: bigint, sb: bigint, liquidity: bigint): bigint {
  const [lo, hi] = sa < sb ? [sa, sb] : [sb, sa];
  return (liquidity * (hi - lo)) / Q96;
}

function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("isqrt of negative");
  if (n < 2n) return n;
  // Newton's method from an overestimate: strictly decreasing until floor(√n).
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** sqrt((10000 ± bps) / 10000) as Q96, floor. */
function bandFactorQ96(bps: number, up: boolean): bigint {
  if (!Number.isInteger(bps) || bps <= 0 || bps >= 10_000) throw new RangeError(`band bps out of range: ${bps}`);
  const num = BigInt(up ? 10_000 + bps : 10_000 - bps);
  return isqrt((num << 192n) / 10_000n);
}

/** Price window of one band around the current sqrt price, in sqrt-price space. */
export interface BandEdges {
  /** sqrt price at which the base price has fallen by the band (bid edge). */
  readonly bidEdge: bigint;
  /** sqrt price at which the base price has risen by the band (ask edge). */
  readonly askEdge: bigint;
}

/**
 * The base price is token1/token0 when base = token0 (rises with sqrtP), and its
 * inverse when base = token1 (falls as sqrtP rises).
 */
export function bandEdges(sqrtP: bigint, bps: number, baseIsToken0: boolean): BandEdges {
  const down = bandFactorQ96(bps, false);
  const up = bandFactorQ96(bps, true);
  return baseIsToken0
    ? { bidEdge: (sqrtP * down) / Q96, askEdge: (sqrtP * up) / Q96 }
    : { bidEdge: (sqrtP * Q96) / down, askEdge: (sqrtP * Q96) / up };
}

/** The quote amount of liquidity L over [x, y] ∩ [pa, pb] (sqrt prices), quote-denominated. */
function quoteOver(x: bigint, y: bigint, pa: bigint, pb: bigint, liquidity: bigint, baseIsToken0: boolean): bigint {
  const lo = (x < y ? x : y) > pa ? (x < y ? x : y) : pa;
  const hi = (x > y ? x : y) < pb ? (x > y ? x : y) : pb;
  if (hi <= lo || liquidity === 0n) return 0n;
  // quote is token1 when base is token0, else token0
  return baseIsToken0 ? amount1Delta(lo, hi, liquidity) : amount0Delta(lo, hi, liquidity);
}

/**
 * Quote-denominated depth of one position (liquidity over [sqrtLower, sqrtUpper]) within
 * ±bps of the current price (DD-23):
 *   bid = quote the position holds between the price and the bid edge (what it pays
 *         to buy base as the base price falls by the band);
 *   ask = quote it takes to buy the position's base between the price and the ask
 *         edge (L·Δ√P in quote terms, before fees).
 * Both are raw quote units, so I6's single target δ* applies to both sides.
 */
export function positionBandDepth(
  sqrtP: bigint,
  edges: BandEdges,
  sqrtLower: bigint,
  sqrtUpper: bigint,
  liquidity: bigint,
  baseIsToken0: boolean,
): { bid: bigint; ask: bigint } {
  return {
    bid: quoteOver(sqrtP, edges.bidEdge, sqrtLower, sqrtUpper, liquidity, baseIsToken0),
    ask: quoteOver(sqrtP, edges.askEdge, sqrtLower, sqrtUpper, liquidity, baseIsToken0),
  };
}

/** Token amounts of a position at the current price (amount0, amount1), rounded down. */
export function positionAmounts(
  sqrtP: bigint,
  sqrtLower: bigint,
  sqrtUpper: bigint,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  if (liquidity === 0n) return { amount0: 0n, amount1: 0n };
  if (sqrtP <= sqrtLower) return { amount0: amount0Delta(sqrtLower, sqrtUpper, liquidity), amount1: 0n };
  if (sqrtP >= sqrtUpper) return { amount0: 0n, amount1: amount1Delta(sqrtLower, sqrtUpper, liquidity) };
  return { amount0: amount0Delta(sqrtP, sqrtUpper, liquidity), amount1: amount1Delta(sqrtLower, sqrtP, liquidity) };
}
