import { describe, it, expect } from "vitest";
import { computePoolAddress, sortTokens, FEE_TIERS } from "./pool.js";
import { resolveChain } from "../chains.js";

// Canonical real-world anchor: the Uniswap v3 USDC/WETH 0.05% pool on Ethereum.
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC_WETH_500 = "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640";

const ethUniV3 = resolveChain(1).dexes[0]!;

describe("Uniswap v3 CREATE2 pool address", () => {
  it("derives the known USDC/WETH 0.05% pool on Ethereum", () => {
    const pool = computePoolAddress(ethUniV3.factory, { tokenA: USDC, tokenB: WETH, fee: 500 }, ethUniV3.initCodeHash);
    expect(pool).toBe(USDC_WETH_500);
  });

  it("is independent of token argument order (factory sorts them)", () => {
    const a = computePoolAddress(ethUniV3.factory, { tokenA: USDC, tokenB: WETH, fee: 500 }, ethUniV3.initCodeHash);
    const b = computePoolAddress(ethUniV3.factory, { tokenA: WETH, tokenB: USDC, fee: 500 }, ethUniV3.initCodeHash);
    expect(a).toBe(b);
  });

  it("gives a distinct address per fee tier", () => {
    const addrs = FEE_TIERS.map((fee) =>
      computePoolAddress(ethUniV3.factory, { tokenA: USDC, tokenB: WETH, fee }, ethUniV3.initCodeHash),
    );
    expect(new Set(addrs).size).toBe(FEE_TIERS.length);
  });

  it("sorts tokens ascending and rejects equal tokens", () => {
    expect(sortTokens(WETH, USDC)).toEqual([USDC, WETH]);
    expect(() => sortTokens(USDC, USDC)).toThrow(/must differ/);
  });
});
