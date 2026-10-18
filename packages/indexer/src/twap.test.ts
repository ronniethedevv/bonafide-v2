import { describe, it, expect } from "vitest";
import { winsorizedTwap, TwapError } from "./twap.js";
import type { PriceSample } from "./provider.js";

describe("winsorizedTwap", () => {
  it("time-weights a step function", () => {
    const s: PriceSample[] = [
      { ts: 0, price: 100n },
      { ts: 10, price: 200n },
    ];
    expect(winsorizedTwap(s, 0, 20, 0)).toBe(150n);
  });

  it("weights unequal durations", () => {
    const s: PriceSample[] = [
      { ts: 0, price: 100n },
      { ts: 5, price: 200n },
    ];
    // 100*5 + 200*15 = 3500 over 20 -> 175
    expect(winsorizedTwap(s, 0, 20, 0)).toBe(175n);
  });

  it("winsorizes extreme samples before weighting", () => {
    const s: PriceSample[] = [
      { ts: 0, price: 1n },
      { ts: 1, price: 100n },
      { ts: 2, price: 100n },
      { ts: 3, price: 100n },
      { ts: 4, price: 1000n },
    ];
    // k=floor(5*0.2)=1 -> low=100, high=100 -> everything clamps to 100
    expect(winsorizedTwap(s, 0, 5, 0.2)).toBe(100n);
  });

  it("throws when no samples fall in the window", () => {
    expect(() => winsorizedTwap([{ ts: 99, price: 1n }], 0, 10, 0)).toThrow(
      TwapError,
    );
  });
});
