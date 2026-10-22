// Per-owner depth series from an event replay (Unit 3 / 2c, DD-23/DD-24).
//
// State = the pool price + each tracked position's liquidity. It starts from reads at
// startBlock and changes only at events: Swap (price, from the event's sqrtPriceX96),
// pool Mint/Burn of a direct position, position-manager Increase/DecreaseLiquidity.
// Depth is evaluated at the end of every block with an event, and a bucket's minimum
// is taken over the state in force at its start and after each of its blocks — so no
// per-block reads are needed and nothing between events is missed.

import type { DepthBucketSample } from "../provider.js";
import type { RpcLog } from "./rpc.js";
import { TOPIC0, decodeBurn, decodeLiquidityChange, decodeMint, decodeSwap, addressToBigInt } from "./abi.js";
import { bandEdges, getSqrtRatioAtTick, positionAmounts, positionBandDepth } from "./tickmath.js";

export interface TrackedPosition {
  /** "npm:<tokenId>" or "direct:<owner>:<tickLower>:<tickUpper>". */
  readonly key: string;
  /** Owner credited with this position's depth (DD-24 ownership rule). */
  readonly owner: bigint;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly liquidityStart: bigint;
}

export interface DepthInputs {
  readonly pool: bigint;
  readonly positionManager: bigint;
  readonly baseIsToken0: boolean;
  readonly bandsBps: readonly number[];
  readonly sqrtPriceStart: bigint;
  readonly positions: readonly TrackedPosition[];
  /** Pool Swap/Mint/Burn + position-manager Increase/DecreaseLiquidity over (startBlock, endBlock]. */
  readonly logs: readonly RpcLog[];
  readonly windowOf: (block: number) => number;
  readonly buckets: number;
}

export interface OwnerDepth {
  readonly depthBuckets: DepthBucketSample[];
  /** Base / quote held in the owner's positions at the end price (fees excluded). */
  readonly lpBase: bigint;
  readonly lpQuote: bigint;
  /** null if any position was live at startBlock; else the block it first went live. */
  readonly lpFirstActiveBlock: number | null;
}

export interface DepthResult {
  readonly owners: Map<bigint, OwnerDepth>;
  readonly sqrtPriceEnd: bigint;
  /** Replayed end liquidity per position key (checked against chain state by the caller). */
  readonly liquidityEnd: Map<string, bigint>;
}

export class DepthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepthError";
  }
}

export const directKey = (owner: bigint, tl: number, tu: number): string => `direct:${owner.toString(16)}:${tl}:${tu}`;
export const npmKey = (tokenId: bigint): string => `npm:${tokenId.toString()}`;

export function replayDepth(inp: DepthInputs): DepthResult {
  if (inp.buckets < 1 || inp.buckets > 48) throw new DepthError(`bucket count out of range: ${inp.buckets}`);
  const liq = new Map<string, bigint>();
  const sqrtBounds = new Map<string, [bigint, bigint]>();
  const ownersOf = new Map<bigint, TrackedPosition[]>();
  for (const p of inp.positions) {
    if (liq.has(p.key)) throw new DepthError(`duplicate position ${p.key}`);
    liq.set(p.key, p.liquidityStart);
    sqrtBounds.set(p.key, [getSqrtRatioAtTick(p.tickLower), getSqrtRatioAtTick(p.tickUpper)]);
    ownersOf.set(p.owner, [...(ownersOf.get(p.owner) ?? []), p]);
  }
  const owners = [...ownersOf.keys()].sort((a, b) => (a < b ? -1 : 1));
  const firstLive = new Map<bigint, number | null>();
  for (const o of owners) firstLive.set(o, ownersOf.get(o)!.some((p) => p.liquidityStart > 0n) ? null : -1);

  let sqrtP = inp.sqrtPriceStart;
  const depthNow = (o: bigint): { bid: bigint; ask: bigint }[] =>
    inp.bandsBps.map((bps) => {
      const e = bandEdges(sqrtP, bps, inp.baseIsToken0);
      let bid = 0n;
      let ask = 0n;
      for (const p of ownersOf.get(o)!) {
        const L = liq.get(p.key)!;
        if (L === 0n) continue;
        const [lo, hi] = sqrtBounds.get(p.key)!;
        const d = positionBandDepth(sqrtP, e, lo, hi, L, inp.baseIsToken0);
        bid += d.bid;
        ask += d.ask;
      }
      return { bid, ask };
    });

  // mins[owner][bucket][band]
  const mins = new Map<bigint, { bid: bigint; ask: bigint }[][]>();
  const current = new Map<bigint, { bid: bigint; ask: bigint }[]>();
  for (const o of owners) {
    current.set(o, depthNow(o));
    mins.set(o, []);
  }
  const openBucket = (k: number): void => {
    for (const o of owners) mins.get(o)![k] = current.get(o)!.map((x) => ({ ...x }));
  };
  const lowerMins = (k: number): void => {
    for (const o of owners) {
      const now = depthNow(o);
      current.set(o, now);
      const m = mins.get(o)![k]!;
      now.forEach((x, b) => {
        if (x.bid < m[b]!.bid) m[b]!.bid = x.bid;
        if (x.ask < m[b]!.ask) m[b]!.ask = x.ask;
      });
    }
  };

  const relevant = inp.logs.filter((l) => {
    const a = addressToBigInt(l.address);
    const t = l.topics[0];
    if (a === inp.pool) return t === TOPIC0.swap || t === TOPIC0.mint || t === TOPIC0.burn;
    return a === inp.positionManager && (t === TOPIC0.increaseLiquidity || t === TOPIC0.decreaseLiquidity);
  });
  for (let i = 1; i < relevant.length; i++) {
    const [p, q] = [relevant[i - 1]!, relevant[i]!];
    if (q.blockNumber < p.blockNumber || (q.blockNumber === p.blockNumber && q.logIndex <= p.logIndex)) {
      throw new DepthError("logs must be sorted by (block, logIndex)");
    }
  }

  const apply = (l: RpcLog): void => {
    const t = l.topics[0];
    if (addressToBigInt(l.address) === inp.pool) {
      if (t === TOPIC0.swap) {
        sqrtP = decodeSwap(l).sqrtPriceX96;
        return;
      }
      const ev = t === TOPIC0.mint ? decodeMint(l) : decodeBurn(l);
      const owner = addressToBigInt(ev.owner);
      if (owner === inp.positionManager) return; // NFT positions move via Increase/Decrease
      bump(directKey(owner, ev.tickLower, ev.tickUpper), t === TOPIC0.mint ? ev.amount : -ev.amount, l.blockNumber);
      return;
    }
    const ev = decodeLiquidityChange(l);
    bump(npmKey(ev.tokenId), ev.liquidityDelta, l.blockNumber);
  };
  const ownerOfKey = new Map(inp.positions.map((p) => [p.key, p.owner]));
  function bump(key: string, delta: bigint, block: number): void {
    const L = liq.get(key);
    if (L === undefined) return; // not a tracked position (another pool's NFT, or uncredited)
    const next = L + delta;
    if (next < 0n) throw new DepthError(`position ${key} liquidity went negative at block ${block}`);
    liq.set(key, next);
    const o = ownerOfKey.get(key)!;
    if (next > 0n && firstLive.get(o) === -1) firstLive.set(o, block);
  }

  let bucket = 0;
  openBucket(0);
  let i = 0;
  while (i < relevant.length) {
    const block = relevant[i]!.blockNumber;
    const k = inp.windowOf(block);
    if (k < bucket || k >= inp.buckets) throw new DepthError(`block ${block} maps to bucket ${k}`);
    while (bucket < k) openBucket(++bucket);
    while (i < relevant.length && relevant[i]!.blockNumber === block) apply(relevant[i++]!);
    lowerMins(bucket);
  }
  while (bucket < inp.buckets - 1) openBucket(++bucket);

  const result = new Map<bigint, OwnerDepth>();
  for (const o of owners) {
    const series = mins.get(o)!;
    const depthBuckets: DepthBucketSample[] = series.map((perBand, k) => ({
      bucket: k,
      perBand: perBand.map((x, b) => ({ bandBps: inp.bandsBps[b]!, minBid: x.bid, minAsk: x.ask })),
    }));
    let a0 = 0n;
    let a1 = 0n;
    for (const p of ownersOf.get(o)!) {
      const [lo, hi] = sqrtBounds.get(p.key)!;
      const amt = positionAmounts(sqrtP, lo, hi, liq.get(p.key)!);
      a0 += amt.amount0;
      a1 += amt.amount1;
    }
    const f = firstLive.get(o)!;
    result.set(o, {
      depthBuckets,
      lpBase: inp.baseIsToken0 ? a0 : a1,
      lpQuote: inp.baseIsToken0 ? a1 : a0,
      lpFirstActiveBlock: f === -1 ? null : f,
    });
  }
  return { owners: result, sqrtPriceEnd: sqrtP, liquidityEnd: liq };
}
