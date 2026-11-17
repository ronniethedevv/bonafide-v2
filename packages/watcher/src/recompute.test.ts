import { describe, it, expect } from "vitest";
import { Sha256Hasher, parseAddr } from "@mmr/merkle";
import {
  buildEpoch,
  bucketsPerEpoch,
  DEFAULT_CONFIG,
  InMemoryPublisher,
  type AddressActivity,
  type ChainProvider,
  type DepthBucketSample,
  type EpochRange,
  type PoolDescriptor,
  type PriceSample,
} from "@mmr/indexer";
import { verifyEpoch } from "./recompute.js";

const hasher = new Sha256Hasher();
const POOL_A = parseAddr("0x00000000000000000000000000000000000000a1");
const POOL_B = parseAddr("0x00000000000000000000000000000000000000b2");

const RANGE: EpochRange = {
  epoch: 5,
  startBlock: 900_000,
  endBlock: 1_000_000,
  endBlockHash: "0xabc",
  startTs: 1_000_000,
  endTs: 1_086_400,
};

function fullDepth(v: bigint): DepthBucketSample[] {
  const out: DepthBucketSample[] = [];
  for (let b = 0; b < bucketsPerEpoch(DEFAULT_CONFIG); b++) {
    out.push({ bucket: b, perBand: DEFAULT_CONFIG.bandsBps.map((bandBps) => ({ bandBps, minBid: v, minAsk: v })) });
  }
  return out;
}

function activity(addr: bigint, baseEnd: bigint): AddressActivity {
  return {
    addr,
    isProtocol: false,
    baseStart: 1000n,
    baseEnd,
    quoteEnd: 10n,
    lpBase: 100n,
    lpQuote: 5n,
    xferIn: 0n,
    xferOut: 0n,
    fromTreasury: 1000n,
    swapBaseIn: 10n,
    swapBaseOut: 10n,
    swapQuoteIn: 0n,
    swapQuoteOut: 0n,
    depthBuckets: fullDepth(50n),
    flowWindows: [{ window: 0, buy: 5n, sell: 5n }],
    lpFirstActiveTs: RANGE.endTs - 500,
  };
}

class Provider implements ChainProvider {
  chainId(): number {
    return DEFAULT_CONFIG.chainId;
  }
  async finalizedBlock(): Promise<number> {
    return RANGE.endBlock;
  }
  async poolsAboveFloor(): Promise<PoolDescriptor[]> {
    return [
      { poolAddr: POOL_A, token0: 1n, token1: 2n, liquidity: 5n, dex: "uniswap-v3" },
      { poolAddr: POOL_B, token0: 1n, token1: 2n, liquidity: 9n, dex: "aerodrome-slipstream" },
    ];
  }
  async poolActivity(pool: PoolDescriptor): Promise<AddressActivity[]> {
    return pool.poolAddr === POOL_A
      ? [activity(0x11n, 900n), activity(0x22n, 800n)]
      : [activity(0x33n, 950n)];
  }
  async poolPriceSamples(_p: PoolDescriptor, range: EpochRange): Promise<PriceSample[]> {
    return [{ ts: range.endTs - 600, price: 100n }];
  }
}

async function buildAndCollect(): Promise<{
  publisher: InMemoryPublisher;
  trees: Map<bigint, Uint8Array>;
  rorHex: string;
}> {
  const publisher = new InMemoryPublisher();
  const res = await buildEpoch({ provider: new Provider(), publisher, hasher }, DEFAULT_CONFIG, RANGE);
  const trees = new Map<bigint, Uint8Array>();
  for (const p of res.manifest.pools) {
    const bytes = publisher.get(p.cid);
    if (!bytes) throw new Error(`missing published tree ${p.cid}`);
    trees.set(parseAddr(p.poolAddr), bytes);
  }
  return { publisher, trees, rorHex: res.manifest.rootOfRootsHex };
}

describe("verifyEpoch (challenge watchdog)", () => {
  it("recomputes the root-of-roots from published trees and matches the claim", async () => {
    const { trees, rorHex } = await buildAndCollect();
    const r = verifyEpoch(hasher, RANGE.epoch, trees, rorHex);
    expect(r.ok).toBe(true);
    expect(r.mismatchedPools).toEqual([]);
    expect(r.recomputedRootOfRootsHex).toBe(rorHex);
  });

  it("detects a tampered published pool tree", async () => {
    const { trees, rorHex } = await buildAndCollect();
    // flip a metric in pool A's published doc without updating its stored root
    const bytes = trees.get(POOL_A)!;
    const doc = JSON.parse(new TextDecoder().decode(bytes));
    const realLeaf = doc.leaves.find((l: { addr: string }) => l.addr !== "0");
    realLeaf.metrics.baseEnd = (BigInt(realLeaf.metrics.baseEnd) + 1n).toString();
    trees.set(POOL_A, new TextEncoder().encode(JSON.stringify(doc)));

    const r = verifyEpoch(hasher, RANGE.epoch, trees, rorHex);
    expect(r.ok).toBe(false);
    expect(r.mismatchedPools.length).toBe(1);
  });

  it("detects a false claimed root-of-roots", async () => {
    const { trees } = await buildAndCollect();
    const r = verifyEpoch(hasher, RANGE.epoch, trees, "0x" + "00".repeat(32));
    expect(r.ok).toBe(false);
    expect(r.mismatchedPools).toEqual([]); // pools fine, but the claim is wrong
  });
});
