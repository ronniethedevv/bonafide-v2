import { describe, it, expect } from "vitest";
import { winsorizedTwap, TwapError } from "./twap.js";
import { DEFAULT_CONFIG, assertConfig, twapSampleTimes } from "./config.js";
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

describe("TWAP sampling schedule (DD-20)", () => {
  const END = 1_792_627_200;

  it("samples the whole window at priceSampleSeconds, endTs included", () => {
    const t = twapSampleTimes(DEFAULT_CONFIG, END);
    expect(t.length).toBe(31); // 30 min / 60 s, both ends
    expect(t[0]).toBe(END - 1800);
    expect(t.at(-1)).toBe(END);
    expect(t.every((x, i) => i === 0 || x - t[i - 1]! === 60)).toBe(true);
  });

  it("winsorization now bites: one manipulated block cannot set the reference", () => {
    const times = twapSampleTimes(DEFAULT_CONFIG, END);
    const s: PriceSample[] = times.map((ts) => ({ ts, price: 1000n }));
    s[0] = { ts: times[0]!, price: 1_000_000n }; // a spike at the window start
    // k = floor(31 · 0.05) = 1 per tail: the spike clamps to 1000
    expect(winsorizedTwap(s, END - 1800, END, DEFAULT_CONFIG.winsorFraction)).toBe(1000n);
  });

  it("assertConfig rejects a step that does not divide the window", () => {
    expect(() => assertConfig({ ...DEFAULT_CONFIG, priceSampleSeconds: 0 })).toThrow(/positive integer/);
    expect(() => assertConfig({ ...DEFAULT_CONFIG, priceSampleSeconds: 7 })).toThrow(/whole number of price samples/);
    expect(() => assertConfig({ ...DEFAULT_CONFIG, twapWindowSeconds: 2 * 86400 })).toThrow(/no longer than the epoch/);
  });
});
