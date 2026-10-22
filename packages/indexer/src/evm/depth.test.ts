import { describe, it, expect } from "vitest";
import { replayDepth, directKey, npmKey, DepthError, type DepthInputs } from "./depth.js";
import { TOPIC0 } from "./abi.js";
import { bandEdges, getSqrtRatioAtTick, positionBandDepth } from "./tickmath.js";
import type { RpcLog } from "./rpc.js";

const POOL = 0x900n;
const NPM = 0xaaan;
const MM = 0x51c7n;
const LP = 0x1111n;
const hex = (v: bigint, n = 64): string => (v < 0n ? (1n << 256n) + v : v).toString(16).padStart(n, "0");
const addr = (a: bigint): string => `0x${hex(a, 40)}`;
let idx = 0;
const at = (block: number, l: Omit<RpcLog, "blockNumber" | "logIndex" | "transactionHash">): RpcLog => ({ ...l, blockNumber: block, logIndex: idx++, transactionHash: `0x${block}` });
const swapTo = (block: number, tick: number): RpcLog =>
  at(block, { address: addr(POOL), topics: [TOPIC0.swap, `0x${hex(1n)}`, `0x${hex(1n)}`], data: `0x${hex(0n)}${hex(0n)}${hex(getSqrtRatioAtTick(tick))}${hex(0n)}${hex(BigInt(tick))}` });
const mint = (block: number, owner: bigint, tl: number, tu: number, amount: bigint): RpcLog =>
  at(block, { address: addr(POOL), topics: [TOPIC0.mint, `0x${hex(owner)}`, `0x${hex(BigInt(tl))}`, `0x${hex(BigInt(tu))}`], data: `0x${hex(owner)}${hex(amount)}${hex(0n)}${hex(0n)}` });
const inc = (block: number, tokenId: bigint, amount: bigint, decrease = false): RpcLog =>
  at(block, { address: addr(NPM), topics: [decrease ? TOPIC0.decreaseLiquidity : TOPIC0.increaseLiquidity, `0x${hex(tokenId)}`], data: `0x${hex(amount)}${hex(0n)}${hex(0n)}` });

const L = 10n ** 18n;
const depthAt = (tick: number, bps: number) => {
  const s = getSqrtRatioAtTick(tick);
  return positionBandDepth(s, bandEdges(s, bps, true), getSqrtRatioAtTick(-1000), getSqrtRatioAtTick(1000), L, true);
};

function base(over: Partial<DepthInputs> = {}): DepthInputs {
  idx = 0;
  return {
    pool: POOL,
    positionManager: NPM,
    baseIsToken0: true,
    bandsBps: [100],
    sqrtPriceStart: getSqrtRatioAtTick(0),
    positions: [{ key: npmKey(7n), owner: MM, tickLower: -1000, tickUpper: 1000, liquidityStart: L }],
    logs: [],
    windowOf: (b) => (b <= 10 ? 0 : b <= 20 ? 1 : 2),
    buckets: 3,
    ...over,
  };
}

describe("replayDepth", () => {
  it("a bucket's minimum covers its start state and every block in it", () => {
    // bucket 0: price moves to tick 900 (near the range top: thin ask) then back to 0
    const logs = [swapTo(3, 900), swapTo(5, 0), swapTo(15, 500)];
    const r = replayDepth(base({ logs }));
    const s = r.owners.get(MM)!.depthBuckets;
    const [d0, d900, d500] = [depthAt(0, 100), depthAt(900, 100), depthAt(500, 100)];
    const min = (a: bigint, b: bigint) => (a < b ? a : b);
    expect(s[0]!.perBand[0]).toEqual({ bandBps: 100, minBid: min(d0.bid, d900.bid), minAsk: min(d0.ask, d900.ask) });
    // bucket 1 opens at tick 0 and moves to 500
    expect(s[1]!.perBand[0]).toEqual({ bandBps: 100, minBid: min(d0.bid, d500.bid), minAsk: min(d0.ask, d500.ask) });
    // bucket 2 has no events: the state carried in (tick 500)
    expect(s[2]!.perBand[0]).toEqual({ bandBps: 100, minBid: d500.bid, minAsk: d500.ask });
    expect(r.sqrtPriceEnd).toBe(getSqrtRatioAtTick(500));
  });

  it("a withdrawal and re-deposit inside one bucket still records the dip", () => {
    const logs = [inc(12, 7n, L, true), inc(14, 7n, L)];
    const s = replayDepth(base({ logs })).owners.get(MM)!.depthBuckets;
    expect(s[1]!.perBand[0]!.minBid).toBe(0n);
    expect(s[2]!.perBand[0]!.minBid).toBe(depthAt(0, 100).bid);
  });

  it("tracks direct positions via pool Mint and ignores the position manager's own Mint", () => {
    const k = directKey(LP, -1000, 1000);
    const positions = [
      { key: npmKey(7n), owner: MM, tickLower: -1000, tickUpper: 1000, liquidityStart: L },
      { key: k, owner: LP, tickLower: -1000, tickUpper: 1000, liquidityStart: 0n },
    ];
    const logs = [mint(12, LP, -1000, 1000, L), mint(13, NPM, -1000, 1000, 5n * L)];
    const r = replayDepth(base({ positions, logs }));
    expect(r.liquidityEnd.get(k)).toBe(L);
    expect(r.liquidityEnd.get(npmKey(7n))).toBe(L);
    const lp = r.owners.get(LP)!;
    expect(lp.depthBuckets[0]!.perBand[0]!.minBid).toBe(0n);
    expect(lp.depthBuckets[2]!.perBand[0]!.minBid).toBe(depthAt(0, 100).bid);
    expect(lp.lpFirstActiveBlock).toBe(12);
    expect(r.owners.get(MM)!.lpFirstActiveBlock).toBeNull();
  });

  it("reports end holdings in base/quote orientation", () => {
    const r = replayDepth(base());
    const mm = r.owners.get(MM)!;
    expect(mm.lpBase > 0n && mm.lpQuote > 0n).toBe(true);
    const flipped = replayDepth(base({ baseIsToken0: false })).owners.get(MM)!;
    expect([flipped.lpBase, flipped.lpQuote]).toEqual([mm.lpQuote, mm.lpBase]);
  });

  it("fails loudly on negative liquidity or unsorted logs", () => {
    expect(() => replayDepth(base({ logs: [inc(3, 7n, 2n * L, true)] }))).toThrow(/went negative/);
    const logs = [swapTo(5, 1), swapTo(3, 2)];
    expect(() => replayDepth(base({ logs }))).toThrow(DepthError);
  });
});
