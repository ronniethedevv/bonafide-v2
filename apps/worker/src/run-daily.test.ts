import { describe, expect, it } from "vitest";
import { dayFromDate } from "./day.js";
import { plan } from "./run-daily.js";

const TOKEN = "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b";
const NOW = new Date("2026-11-17T01:10:00Z");
const D = dayFromDate("2026-11-16");

describe("daily run plan", () => {
  it("does nothing without covered tokens", () => {
    expect(plan({}, NOW)).toEqual({ chains: [], days: [D - 2, D - 1, D] });
  });

  it("covers every configured chain over the catch-up window", () => {
    expect(plan({ MMR_COVERAGE_8453: TOKEN, MMR_COVERAGE_1: TOKEN, MMR_CATCHUP_DAYS: "2" }, NOW)).toEqual({ chains: [8453, 1], days: [D - 1, D] });
  });

  it("never catches up before MMR_INDEX_FROM; a named day is indexed as asked", () => {
    const env = { MMR_COVERAGE_8453: TOKEN, MMR_INDEX_FROM: "2026-11-16" };
    expect(plan(env, NOW).days).toEqual([D]);
    expect(plan({ ...env, MMR_INDEX_DATE: "2026-10-21" }, NOW).days).toEqual([dayFromDate("2026-10-21")]);
  });

  it("runs one day on one chain for a backfill", () => {
    const env = { MMR_COVERAGE_8453: TOKEN, MMR_COVERAGE_1: TOKEN, MMR_INDEX_DATE: "2026-10-21", MMR_INDEX_CHAIN: "8453" };
    expect(plan(env, NOW)).toEqual({ chains: [8453], days: [dayFromDate("2026-10-21")] });
    expect(() => plan({ ...env, MMR_INDEX_CHAIN: "10" }, NOW)).toThrow(/unsupported chain/);
    // A chain with no covered tokens is not indexed even when asked for.
    expect(plan({ MMR_COVERAGE_8453: TOKEN, MMR_INDEX_CHAIN: "1" }, NOW).chains).toEqual([]);
  });
});
