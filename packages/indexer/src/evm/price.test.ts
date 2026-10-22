import { describe, it, expect } from "vitest";
import {
  PriceError,
  lastBlockAtOrBefore,
  orientPool,
  priceQ96FromSqrt,
} from "./price.js";
import { resolveChain } from "../chains.js";
import type { BlockHeader } from "./rpc.js";

const BASE = resolveChain(8453).quoteAssets;
const WETH = 0x4200000000000000000000000000000000000006n;
const USDC = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n;
const USDBC = 0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6can;
const CBBTC = 0xcbb7c0000ab88b473b1f5afd9ef808440eed33bfn;

describe("orientPool (quote allowlist, DD-19)", () => {
  it("the non-quote token is base, on either side", () => {
    // cbBTC/USDC: USDC sorts first (token0), so base = token1
    expect(orientPool(BASE, USDC, CBBTC)).toEqual({ baseIsToken0: false });
    expect(orientPool(BASE, CBBTC, USDC)).toEqual({ baseIsToken0: true });
  });

  it("when both are quote assets, the higher-ranked one is the quote", () => {
    // WETH/USDC: USDC outranks WETH, so WETH (token0) is base
    expect(orientPool(BASE, WETH, USDC)).toEqual({ baseIsToken0: true });
    // USDC/USDbC: USDC outranks bridged USDbC, so USDbC (token1) is base
    expect(orientPool(BASE, USDC, USDBC)).toEqual({ baseIsToken0: false });
  });

  it("a pool without a quote asset cannot be oriented", () => {
    expect(() => orientPool(BASE, CBBTC, CBBTC + 1n)).toThrow(PriceError);
  });
});

describe("priceQ96FromSqrt (raw quote per raw base, × 2^96)", () => {
  // Live Base vectors, block 52 929 586. Converted to human units they matched
  // Chainlink's on-chain feeds at the same block: ETH/USD 2434.50 (−0.027%),
  // BTC/USD 82 623.76 (+0.061%).
  it("WETH/USDC 0.05% (base = token0) — KAT", () => {
    const p = priceQ96FromSqrt(3908648434181550970956375n, { baseIsToken0: true });
    expect(p).toBe(192829570915257615562n);
    expect(Number(p) / 2 ** 96 * 1e12).toBeCloseTo(2433.85, 2); // × 10^(18 − 6)
  });

  it("cbBTC/USDC 0.05% (base = token1) — KAT", () => {
    const p = priceQ96FromSqrt(2755468189000088492796822788n, { baseIsToken0: false });
    expect(p).toBe(65501002659970815564250698922216n);
    expect(Number(p) / 2 ** 96 * 1e2).toBeCloseTo(82673.89, 2); // × 10^(8 − 6)
  });

  it("never truncates a sub-unit raw ratio to 0 (the unscaled formula would)", () => {
    const sqrtP = 3908648434181550970956375n;
    expect((sqrtP * sqrtP) >> 192n).toBe(0n);
    expect(priceQ96FromSqrt(sqrtP, { baseIsToken0: true }) > 0n).toBe(true);
  });

  it("the two orientations are reciprocal up to floor rounding", () => {
    const sqrtP = 2755468189000088492796822788n;
    const a = priceQ96FromSqrt(sqrtP, { baseIsToken0: true });
    const b = priceQ96FromSqrt(sqrtP, { baseIsToken0: false });
    const one = 1n << 192n;
    expect(a * b <= one).toBe(true);
    expect(one - a * b < a + b).toBe(true);
  });

  it("rejects an uninitialized pool", () => {
    expect(() => priceQ96FromSqrt(0n, { baseIsToken0: true })).toThrow(/not initialized/);
  });
});

describe("lastBlockAtOrBefore", () => {
  // Irregular block times (missed slots, bursts), strictly increasing.
  const ts: number[] = [];
  for (let n = 0, t = 1000; n < 500; n++) ts.push((t += 1 + ((n * 7919) % 13 === 0 ? 24 : n % 3)));
  const headers = (calls: number[]) => async (n: number): Promise<BlockHeader> => {
    calls.push(n);
    return { number: n, timestamp: ts[n]!, hash: `0x${n.toString(16)}` };
  };
  const brute = (t: number, lo: number, hi: number): number | null => {
    let r: number | null = null;
    for (let n = lo; n <= hi; n++) if (ts[n]! <= t) r = n;
    return r;
  };

  it("matches a brute-force scan for every time across the range", async () => {
    for (let t = ts[0]! - 3; t <= ts[499]! + 3; t++) {
      expect(await lastBlockAtOrBefore(headers([]), t, 0, 499)).toBe(brute(t, 0, 499));
    }
  });

  it("respects the [lo, hi] bounds", async () => {
    expect(await lastBlockAtOrBefore(headers([]), ts[99]!, 100, 200)).toBeNull();
    expect(await lastBlockAtOrBefore(headers([]), ts[300]!, 100, 200)).toBe(200);
    expect(await lastBlockAtOrBefore(headers([]), ts[150]!, 100, 200)).toBe(150);
  });

  it("stays logarithmic", async () => {
    let worst = 0;
    for (let t = ts[0]!; t <= ts[499]!; t += 7) {
      const calls: number[] = [];
      await lastBlockAtOrBefore(headers(calls), t, 0, 499);
      worst = Math.max(worst, calls.length);
    }
    expect(worst).toBeLessThanOrEqual(2 + 2 * Math.ceil(Math.log2(500)));
  });
});
