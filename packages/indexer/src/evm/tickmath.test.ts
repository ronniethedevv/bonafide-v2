import { describe, it, expect } from "vitest";
import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  Q96,
  amount0Delta,
  amount1Delta,
  bandEdges,
  getSqrtRatioAtTick,
  positionAmounts,
  positionBandDepth,
} from "./tickmath.js";

describe("getSqrtRatioAtTick (TickMath.sol port)", () => {
  it("hits the protocol constants exactly", () => {
    expect(getSqrtRatioAtTick(0)).toBe(Q96);
    expect(getSqrtRatioAtTick(MIN_TICK)).toBe(MIN_SQRT_RATIO);
    expect(getSqrtRatioAtTick(MAX_TICK)).toBe(MAX_SQRT_RATIO);
  });

  it("is strictly increasing and ≈ sqrt(1.0001^tick)", () => {
    let prev = 0n;
    for (const t of [-200_000, -198_325, -1, 0, 1, 60, 887_000]) {
      const r = getSqrtRatioAtTick(t);
      expect(r > prev).toBe(true);
      prev = r;
      expect(Number(r) / 2 ** 96 / Math.sqrt(1.0001 ** t)).toBeCloseTo(1, 9);
    }
  });

  it("rejects ticks out of range", () => {
    expect(() => getSqrtRatioAtTick(MAX_TICK + 1)).toThrow(RangeError);
  });
});

describe("amount deltas", () => {
  const a = getSqrtRatioAtTick(-60);
  const b = getSqrtRatioAtTick(60);
  const L = 10n ** 18n;
  it("are symmetric in their price arguments and round down", () => {
    expect(amount0Delta(a, b, L)).toBe(amount0Delta(b, a, L));
    expect(amount1Delta(a, b, L)).toBe((L * (b - a)) / Q96);
    // ≈ L·(1/√a − 1/√b) and L·(√b − √a)
    expect(Number(amount0Delta(a, b, L)) / (1e18 * (2 ** 96 / Number(a) - 2 ** 96 / Number(b)))).toBeCloseTo(1, 9);
  });
});

describe("band depth (quote-denominated, DD-23)", () => {
  const L = 10n ** 20n;
  const lower = getSqrtRatioAtTick(-1000);
  const upper = getSqrtRatioAtTick(1000);
  const sqrtP = Q96; // price 1

  it("base = token0: bid is token1 below the price, ask is token1 to cross the base above", () => {
    const e = bandEdges(sqrtP, 100, true);
    expect(e.bidEdge < sqrtP && e.askEdge > sqrtP).toBe(true);
    const d = positionBandDepth(sqrtP, e, lower, upper, L, true);
    expect(d.bid).toBe(amount1Delta(e.bidEdge, sqrtP, L));
    expect(d.ask).toBe(amount1Delta(sqrtP, e.askEdge, L));
    // ±1% around price 1: each side ≈ L·0.5%
    expect(Number(d.bid) / 1e20).toBeCloseTo(1 - Math.sqrt(0.99), 6);
    expect(Number(d.ask) / 1e20).toBeCloseTo(Math.sqrt(1.01) - 1, 6);
  });

  it("base = token1: the band is mirrored and both sides are token0", () => {
    const e = bandEdges(sqrtP, 100, false);
    expect(e.bidEdge > sqrtP && e.askEdge < sqrtP).toBe(true);
    const d = positionBandDepth(sqrtP, e, lower, upper, L, false);
    expect(d.bid).toBe(amount0Delta(sqrtP, e.bidEdge, L));
    expect(d.ask).toBe(amount0Delta(e.askEdge, sqrtP, L));
  });

  it("clips to the position's range and is zero when out of range", () => {
    const e = bandEdges(sqrtP, 500, true);
    const narrow = positionBandDepth(sqrtP, e, getSqrtRatioAtTick(-10), getSqrtRatioAtTick(10), L, true);
    expect(narrow.bid).toBe(amount1Delta(getSqrtRatioAtTick(-10), sqrtP, L));
    const above = positionBandDepth(sqrtP, e, getSqrtRatioAtTick(2000), getSqrtRatioAtTick(3000), L, true);
    expect(above).toEqual({ bid: 0n, ask: 0n });
  });

  it("position amounts follow the range position", () => {
    expect(positionAmounts(sqrtP, lower, upper, L).amount0).toBe(amount0Delta(sqrtP, upper, L));
    expect(positionAmounts(lower - 1n, lower, upper, L)).toEqual({ amount0: amount0Delta(lower, upper, L), amount1: 0n });
    expect(positionAmounts(upper, lower, upper, L)).toEqual({ amount0: 0n, amount1: amount1Delta(lower, upper, L) });
  });
});
