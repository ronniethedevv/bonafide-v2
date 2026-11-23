import { describe, expect, it } from "vitest";
import { addressList, catchUpDays, catchUpWindow, coverage, coveredChains, dayFromDate, dayLabel, dayWindow, logChunkBlocks, previousDay, rpcConcurrency } from "./day.js";

describe("day helpers", () => {
  it("numbers epochs by UTC day and indexes the last closed day", () => {
    const d = dayFromDate("2026-11-16");
    expect(dayLabel(d)).toBe("2026-11-16");
    expect(dayWindow(d)).toEqual({ startTs: Date.UTC(2026, 10, 16) / 1000, endTs: Date.UTC(2026, 10, 17) / 1000 });
    expect(previousDay(new Date("2026-11-17T01:10:00Z"))).toBe(d);
    expect(previousDay(new Date("2026-11-17T00:00:00Z"))).toBe(d);
    expect(() => dayFromDate("16/11/2026")).toThrow(/YYYY-MM-DD/);
  });

  it("parses coverage into the canonical ascending lowercase form", () => {
    const a = "0x0B3E328455C4059EEB9E3F84B5543F74E24E7E1B";
    const b = "0x4ed4e862860bed51a9570b96d89af5e1b0efefed";
    expect(addressList(` ${b}, ${a},${b},`, "x")).toEqual([a.toLowerCase(), b]);
    expect(() => addressList("0x123", "MMR_COVERAGE_8453")).toThrow(/MMR_COVERAGE_8453: not an address/);
    const env = { MMR_COVERAGE_8453: a };
    expect(coverage(env, 8453)).toEqual([a.toLowerCase()]);
    expect(coverage(env, 1)).toEqual([]);
    expect(coveredChains(env)).toEqual([8453]);
    expect(coveredChains({})).toEqual([]);
  });

  it("re-checks the last few closed days, oldest first", () => {
    const d = dayFromDate("2026-11-16");
    expect(catchUpDays(new Date("2026-11-17T01:10:00Z"), 3)).toEqual([d - 2, d - 1, d]);
    expect(catchUpDays(new Date("2026-11-17T01:10:00Z"), 1)).toEqual([d]);
    expect(catchUpWindow({})).toBe(3);
    expect(catchUpWindow({ MMR_CATCHUP_DAYS: "7" })).toBe(7);
    expect(() => catchUpDays(new Date(), 0)).toThrow(/1..14/);
    expect(() => catchUpDays(new Date(), 30)).toThrow(/1..14/);
  });

  it("defaults log chunks to the free-plan limit", () => {
    expect(logChunkBlocks({})).toBe(10);
    expect(logChunkBlocks({ MMR_LOG_CHUNK_BLOCKS: "2000" })).toBe(2000);
    expect(() => logChunkBlocks({ MMR_LOG_CHUNK_BLOCKS: "0" })).toThrow();
  });

  it("defaults RPC concurrency to 8 and bounds it", () => {
    expect(rpcConcurrency({})).toBe(8);
    expect(rpcConcurrency({ MMR_RPC_CONCURRENCY: "4" })).toBe(4);
    expect(() => rpcConcurrency({ MMR_RPC_CONCURRENCY: "0" })).toThrow();
    expect(() => rpcConcurrency({ MMR_RPC_CONCURRENCY: "64" })).toThrow();
  });
});
