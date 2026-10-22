import { describe, it, expect } from "vitest";
import {
  MULTICALL3,
  MulticallError,
  SELECTOR,
  decodeAggregate,
  encodeAggregate,
  multicall,
  type Call,
} from "./multicall.js";
import {
  MulticallFake,
  decodeAggregateCalldata,
  encodeAggregateReturn,
  word,
} from "./multicall.fake.js";

describe("selectors (keccak-derived)", () => {
  it("match the canonical 4-byte ids", () => {
    expect(SELECTOR).toEqual({
      aggregate: "0x252dba42",
      getPool: "0x1698ee82",
      liquidity: "0x1a686502",
      slot0: "0x3850c7bd",
      token0: "0x0dfe1681",
      token1: "0xd21220a7",
    });
  });
});

describe("aggregate encoding", () => {
  const calls: Call[] = [
    { target: "0x33128a8fc17869897dce68ed026d694621f6fdfd", data: `${SELECTOR.getPool}${word(1n)}${word(2n)}${word(500n)}` },
    { target: "0xd0b53d9277642d899df5c87a3966a349a798f224", data: SELECTOR.liquidity },
  ];

  it("round-trips calls, including non-word-aligned calldata", () => {
    expect(decodeAggregateCalldata(encodeAggregate(calls))).toEqual(calls);
  });

  it("decodes results, including empty and multi-word returns", () => {
    const results = ["0x", `0x${word(7n)}`, `0x${word(1n)}${word(2n)}${word(3n)}`];
    expect(decodeAggregate(encodeAggregateReturn(42n, results))).toEqual({ blockNumber: 42n, returnData: results });
  });

  it("rejects truncated return data", () => {
    const full = encodeAggregateReturn(1n, [`0x${word(7n)}`]);
    expect(() => decodeAggregate(full.slice(0, -64))).toThrow(MulticallError);
  });
});

describe("multicall", () => {
  const echo = (c: Call): string => `0x${word(BigInt(c.target))}`;

  it("batches large call lists and keeps call order", async () => {
    const rpc = new MulticallFake(echo);
    const calls = Array.from({ length: 450 }, (_, i) => ({ target: `0x${(i + 1).toString(16).padStart(40, "0")}`, data: "0x" }));
    const out = await multicall(rpc, calls, 9);
    expect(rpc.batches).toBe(3);
    expect(out.map((r) => BigInt(r))).toEqual(calls.map((c) => BigInt(c.target)));
  });

  it("fails loudly if the batch ran at another block", async () => {
    const rpc = new MulticallFake(echo, 8);
    await expect(multicall(rpc, [{ target: MULTICALL3, data: "0x" }], 9)).rejects.toThrow(/ran at block 8/);
  });
});
