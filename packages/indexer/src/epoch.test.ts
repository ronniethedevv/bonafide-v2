import { describe, it, expect } from "vitest";
import { RootOfRoots, Sha256Hasher, digestToHex, parseAddr } from "@mmr/merkle";
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import { DEFAULT_CONFIG, assertConfig, type IndexerConfig } from "./config.js";
import { buildEpoch, InMemoryPublisher } from "./epoch.js";
import { parsePoolSeries, seriesOf, seriesRoots } from "./series.js";
import { activityToLeaf, isJit } from "./leaves.js";
import { commitDepth } from "./commit.js";
import type {
  AddressActivity,
  ChainProvider,
  EpochRange,
  PoolDescriptor,
  PriceSample,
} from "./provider.js";

const hasher = new Sha256Hasher();

function activity(addr: bigint, over: Partial<AddressActivity> = {}): AddressActivity {
  return {
    addr,
    isProtocol: false,
    baseStart: 1000n,
    baseEnd: 900n,
    quoteEnd: 50n,
    lpBase: 800n,
    lpQuote: 40n,
    xferIn: 0n,
    xferOut: 0n,
    fromTreasury: 1000n,
    swapBaseIn: 0n,
    swapBaseOut: 100n,
    swapQuoteIn: 50n,
    swapQuoteOut: 0n,
    depthBuckets: [
      {
        bucket: 0,
        perBand: [
          { bandBps: 50, minBid: 10n, minAsk: 10n },
          { bandBps: 100, minBid: 20n, minAsk: 20n },
          { bandBps: 200, minBid: 30n, minAsk: 30n },
          { bandBps: 500, minBid: 40n, minAsk: 40n },
        ],
      },
    ],
    flowWindows: [{ window: 0, buy: 50n, sell: 100n }],
    lpFirstActiveTs: 0,
    ...over,
  };
}

const POOL_A = parseAddr("0x00000000000000000000000000000000000000a1");
const POOL_B = parseAddr("0x00000000000000000000000000000000000000b2");

class FakeProvider implements ChainProvider {
  chainId(): number {
    return 8453;
  }
  async finalizedBlock(): Promise<number> {
    return 1_000_000;
  }
  async poolsAboveFloor(): Promise<PoolDescriptor[]> {
    return [
      { poolAddr: POOL_B, token0: 1n, token1: 2n, liquidity: 10n, dex: "uniswap-v3" },
      { poolAddr: POOL_A, token0: 1n, token1: 2n, liquidity: 20n, dex: "aerodrome-slipstream" },
    ];
  }
  async poolActivity(pool: PoolDescriptor): Promise<AddressActivity[]> {
    if (pool.poolAddr === POOL_A) {
      return [activity(0x11n), activity(0x22n)];
    }
    return [activity(0x33n)];
  }
  async poolPriceSamples(_pool: PoolDescriptor, range: EpochRange): Promise<PriceSample[]> {
    return [
      { ts: range.endTs - 1000, price: 100n },
      { ts: range.endTs - 500, price: 100n },
    ];
  }
}

const range: EpochRange = {
  epoch: 7,
  startBlock: 900_000,
  endBlock: 1_000_000,
  endBlockHash: "0xdeadbeef",
  startTs: 1_000_000,
  endTs: 1_086_400,
};

describe("buildEpoch", () => {
  it("builds a signed-ready manifest with verifiable pool proofs", async () => {
    const publisher = new InMemoryPublisher();
    const res = await buildEpoch(
      { provider: new FakeProvider(), publisher, hasher },
      DEFAULT_CONFIG,
      range,
    );

    expect(res.manifest.poolCount).toBe(2);
    expect(res.manifest.pools.map((p) => p.poolAddr)).toEqual([
      "0x00000000000000000000000000000000000000a1",
      "0x00000000000000000000000000000000000000b2",
    ]);
    // every pool root is provable against the root-of-roots
    for (const pool of [POOL_A, POOL_B]) {
      const proof = res.rootOfRoots.poolProof(pool);
      expect(RootOfRoots.verifyPoolProof(hasher, res.rootOfRoots.root, proof)).toBe(true);
    }
    // 2 trees, 2 series documents and 1 manifest published
    expect(publisher.count).toBe(5);
    expect(res.manifest.pools[0]!.referencePrice).toBe("100");
  });

  it("publishes each pool's committed series: every leaf's depth and flow roots rebuild from it", async () => {
    const publisher = new InMemoryPublisher();
    // 0x22 is a JIT position (live 10 s before the end): its depth commits to an empty series
    class JitProvider extends FakeProvider {
      override async poolActivity(pool: PoolDescriptor): Promise<AddressActivity[]> {
        return pool.poolAddr === POOL_A
          ? [activity(0x11n), activity(0x22n, { lpFirstActiveTs: range.endTs - 10 }), activity(0x44n, { depthBuckets: [], flowWindows: [] })]
          : [activity(0x33n)];
      }
    }
    const res = await buildEpoch({ provider: new JitProvider(), publisher, hasher }, DEFAULT_CONFIG, range);
    for (const entry of res.manifest.pools) {
      const { bandsBps, series } = parsePoolSeries(publisher.get(entry.seriesCid!)!);
      expect(bandsBps).toEqual(DEFAULT_CONFIG.bandsBps);
      const tree = res.trees.get(parseAddr(entry.poolAddr))!;
      for (const leaf of tree.leaves.filter((l) => l.addr !== 0n)) {
        const roots = seriesRoots(new PoseidonHasher(), seriesOf(series, leaf.addr), bandsBps); // the default commit hasher
        expect(digestToHex(roots.depthRoot)).toBe(digestToHex(leaf.depthRoot));
        expect(digestToHex(roots.flowRoot)).toBe(digestToHex(leaf.flowRoot));
      }
      if (entry.poolAddr.endsWith("a1")) {
        expect(series.get(0x22n)!.depth).toEqual([]); // anti-JIT applied before publishing
        expect(series.has(0x44n)).toBe(false); // empty series are left out
      }
    }
  });

  it("indexes only the allowlisted pools and records the allowlist", async () => {
    const res = await buildEpoch(
      { provider: new FakeProvider(), publisher: new InMemoryPublisher(), hasher },
      { ...DEFAULT_CONFIG, poolAllowlist: ["0x00000000000000000000000000000000000000B2"] },
      range,
    );
    expect(res.manifest.pools.map((p) => p.poolAddr)).toEqual(["0x00000000000000000000000000000000000000b2"]);
    expect(res.manifest.poolAllowlist).toEqual(["0x00000000000000000000000000000000000000b2"]);
    expect(res.manifest.poolCount).toBe(1);
  });

  it("is deterministic across independent runs", async () => {
    const run = async (): Promise<string> => {
      const r = await buildEpoch(
        { provider: new FakeProvider(), publisher: new InMemoryPublisher(), hasher },
        DEFAULT_CONFIG,
        range,
      );
      return r.manifest.rootOfRootsHex;
    };
    expect(await run()).toBe(await run());
  });

  it("defaults to the circuit's PoseidonHasher for trees + root-of-roots", async () => {
    const res = await buildEpoch(
      { provider: new FakeProvider(), publisher: new InMemoryPublisher() },
      DEFAULT_CONFIG,
      range,
    );
    expect(res.manifest.hasherId).toBe(new PoseidonHasher().id);
    const proof = res.rootOfRoots.poolProof(POOL_A);
    expect(RootOfRoots.verifyPoolProof(new PoseidonHasher(), res.rootOfRoots.root, proof)).toBe(true);
    expect(RootOfRoots.verifyPoolProof(hasher, res.rootOfRoots.root, proof)).toBe(false);
  });
});

describe("anti-JIT depth credit", () => {
  const cfg: IndexerConfig = { ...DEFAULT_CONFIG, kMinSeconds: 60 };

  it("zeroes depth credit for a position younger than kMin", () => {
    const fresh = activity(0x11n, { lpFirstActiveTs: range.endTs - 5 });
    const leaf = activityToLeaf(hasher, fresh, cfg, range);
    const emptyDepthRoot = commitDepth(hasher, [], cfg.bandsBps);
    expect(digestToHex(leaf.depthRoot)).toBe(digestToHex(emptyDepthRoot));
  });

  it("keeps depth credit for an aged position", () => {
    const aged = activity(0x11n, { lpFirstActiveTs: range.endTs - 100 });
    const leaf = activityToLeaf(hasher, aged, cfg, range);
    const emptyDepthRoot = commitDepth(hasher, [], cfg.bandsBps);
    expect(digestToHex(leaf.depthRoot)).not.toBe(digestToHex(emptyDepthRoot));
  });

  it("measures the window in seconds, whatever the block time (DD-31)", () => {
    // 60 s exactly before the end is old enough; 59 s is not. Block numbers play no part,
    // so 300 fast (0.2 s) blocks inside the last minute are still JIT.
    expect(isJit(activity(0x11n, { lpFirstActiveTs: range.endTs - 60 }), cfg, range)).toBe(false);
    expect(isJit(activity(0x11n, { lpFirstActiveTs: range.endTs - 59 }), cfg, range)).toBe(true);
    expect(isJit(activity(0x11n, { lpFirstActiveTs: null }), cfg, range)).toBe(false);
    expect(() => assertConfig({ ...cfg, kMinSeconds: 1.5 })).toThrow(/kMinSeconds/);
  });

  it("matches the former 30-block rule on 2 s blocks", () => {
    // Pre-switch Base: block b has timestamp t0 + 2(b − b0). Old rule: endBlock − b < 30.
    const t0 = range.endTs - 2 * 1000;
    const tsOf = (b: number) => t0 + 2 * b;
    const endBlock = 1000; // timestamp == range.endTs
    for (let b = 900; b <= endBlock; b++) {
      const oldRule = endBlock - b < 30;
      expect(isJit(activity(0x11n, { lpFirstActiveTs: tsOf(b) }), cfg, range)).toBe(oldRule);
    }
  });
});
