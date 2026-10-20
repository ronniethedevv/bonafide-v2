import { describe, it, expect } from "vitest";
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
import type { Digest } from "@mmr/merkle";
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import { createEngagement, type EngagementTerms } from "./engagement.js";
import { evaluateEpoch } from "./oracle.js";
import {
  assembleDepthOpenings,
  uptimeFromOpenings,
  verifyDepthOpenings,
} from "./depth-openings.js";

// Two wallets with UNEVEN depth so the uptime count is non-trivial (not all
// buckets pass), which makes the oracle/opening equivalence a real check.
//   bucket 0: A=60, B=60 -> 120 >= 100  pass
//   bucket 1: A=60, B=60 -> 120 >= 100  pass
//   bucket 2: A=60, B= 0 ->  60 <  100  fail
//   buckets 3.. : no depth               fail
const POOL = 0xabcdn;
const WALLET_A = 0x10n;
const WALLET_B = 0x20n;
const BAND = 100;

const RANGE: EpochRange = {
  epoch: 1,
  startBlock: 900_000,
  endBlock: 1_000_000,
  endBlockHash: "0xtest",
  startTs: 1_000_000,
  endTs: 1_086_400,
};

const TERMS: EngagementTerms = {
  floorPriceP: 1n,
  loanL0: 0n,
  quoteStartQ0: 0n,
  disposalD: 0n,
  netSellS: 1_000n,
  depthTarget: 100n,
  roundtripSharePpm: 1_000_000n,
  bandBps: BAND,
  minUptimeBuckets: 48, // every bucket (DEFAULT_CONFIG: 48 per epoch)
  epochsTotal: 30,
};

function depthAt(
  perBucket: ReadonlyArray<{ bucket: number; minBid: bigint; minAsk: bigint }>,
): DepthBucketSample[] {
  // Only the contracted band carries values here; other configured bands are 0.
  return perBucket.map((b) => ({
    bucket: b.bucket,
    perBand: DEFAULT_CONFIG.bandsBps.map((bandBps) => ({
      bandBps,
      minBid: bandBps === BAND ? b.minBid : 0n,
      minAsk: bandBps === BAND ? b.minAsk : 0n,
    })),
  }));
}

function activity(addr: bigint, depth: DepthBucketSample[]): AddressActivity {
  return {
    addr,
    isProtocol: false,
    baseStart: 0n,
    baseEnd: 0n,
    quoteEnd: 0n,
    lpBase: 0n,
    lpQuote: 0n,
    xferIn: 0n,
    xferOut: 0n,
    fromTreasury: 0n,
    swapBaseIn: 0n,
    swapBaseOut: 0n,
    swapQuoteIn: 0n,
    swapQuoteOut: 0n,
    depthBuckets: depth,
    flowWindows: [],
    lpFirstActiveBlock: RANGE.endBlock - 1_000_000, // old enough: not JIT
  };
}

const ACTIVITIES = new Map<bigint, AddressActivity>([
  [WALLET_A, activity(WALLET_A, depthAt([
    { bucket: 0, minBid: 60n, minAsk: 60n },
    { bucket: 1, minBid: 60n, minAsk: 60n },
    { bucket: 2, minBid: 60n, minAsk: 60n },
  ]))],
  [WALLET_B, activity(WALLET_B, depthAt([
    { bucket: 0, minBid: 60n, minAsk: 60n },
    { bucket: 1, minBid: 60n, minAsk: 60n },
  ]))],
]);

class TestProvider implements ChainProvider {
  chainId(): number {
    return DEFAULT_CONFIG.chainId;
  }
  async finalizedBlock(): Promise<number> {
    return RANGE.endBlock;
  }
  async poolsAboveFloor(): Promise<PoolDescriptor[]> {
    return [{ poolAddr: POOL, token0: 1n, token1: 2n, liquidity: 1n, dex: "uniswap-v3" }];
  }
  async poolActivity(): Promise<AddressActivity[]> {
    return [...ACTIVITIES.values()];
  }
  async poolPriceSamples(): Promise<PriceSample[]> {
    return [{ ts: RANGE.endTs - 10, price: 100n }];
  }
}

/** A wrong but canonical (< field modulus) sibling: flip the LE low bit. */
function flipLowBit(d: Digest): Digest {
  const out = d.slice();
  out[0] = out[0]! ^ 1;
  return out;
}

async function buildFixture() {
  // PoseidonHasher (the circuit's transientHash) for the tree and the depth/flow
  // commitments: the circuit opens depth_root with transientHash (H1).
  const hasher = new PoseidonHasher();
  const epoch = await buildEpoch(
    { provider: new TestProvider(), publisher: new InMemoryPublisher(), hasher, commitHasher: hasher },
    DEFAULT_CONFIG,
    RANGE,
  );
  const engagement = createEngagement({
    id: "depth-test",
    poolAddr: POOL,
    wallets: [WALLET_A, WALLET_B],
    salt: new Uint8Array(32).fill(3),
    terms: TERMS,
  });
  const tree = epoch.trees.get(POOL)!;
  const depthRootByAddr = new Map<bigint, Digest>(
    tree.leaves.filter((l) => l.addr !== 0n).map((l) => [l.addr, l.depthRoot]),
  );
  return { hasher, engagement, depthRootByAddr };
}

describe("H1 depth openings", () => {
  it("every contracted-band opening verifies against the wallet's depth_root", async () => {
    const { hasher, engagement, depthRootByAddr } = await buildFixture();
    const openings = assembleDepthOpenings(hasher, engagement, ACTIVITIES, DEFAULT_CONFIG, RANGE);

    expect(openings.length).toBe(2); // both wallets are active members
    expect(openings.every((o) => o.bandBps === BAND)).toBe(true);
    expect(verifyDepthOpenings(hasher, depthRootByAddr, openings, BAND)).toBe(true);
  });

  it("uptime from the bound openings equals the oracle's clear-data uptime", async () => {
    const { hasher, engagement } = await buildFixture();
    const openings = assembleDepthOpenings(hasher, engagement, ACTIVITIES, DEFAULT_CONFIG, RANGE);

    const verdict = evaluateEpoch(engagement, ACTIVITIES, DEFAULT_CONFIG, RANGE, { settled: true });
    const fromOpenings = uptimeFromOpenings(
      openings,
      bucketsPerEpoch(DEFAULT_CONFIG),
      TERMS.depthTarget,
    );

    expect(fromOpenings).toBe(verdict.uptimeBuckets);
    expect(fromOpenings).toBe(2); // buckets 0 and 1 only
  });

  it("tampering an opened depth value breaks the binding (depth is not free)", async () => {
    const { hasher, engagement, depthRootByAddr } = await buildFixture();
    const openings = assembleDepthOpenings(hasher, engagement, ACTIVITIES, DEFAULT_CONFIG, RANGE);

    // Inflate wallet B's bucket-2 depth to forge a passing bucket.
    const forged = openings.map((o) =>
      o.addr !== WALLET_B
        ? o
        : { ...o, series: [...o.series, { bucket: 2, minBid: 60n, minAsk: 60n }] },
    );
    // The reconstructed band leaf no longer matches the committed one.
    expect(verifyDepthOpenings(hasher, depthRootByAddr, forged, BAND)).toBe(false);
  });

  it("an opening against the wrong band is rejected", async () => {
    const { hasher, engagement, depthRootByAddr } = await buildFixture();
    const openings = assembleDepthOpenings(hasher, engagement, ACTIVITIES, DEFAULT_CONFIG, RANGE);
    const otherBand = DEFAULT_CONFIG.bandsBps.find((b) => b !== BAND)!;
    expect(verifyDepthOpenings(hasher, depthRootByAddr, openings, otherBand)).toBe(false);
  });

  it("a corrupted Merkle path is rejected", async () => {
    const { hasher, engagement, depthRootByAddr } = await buildFixture();
    const openings = assembleDepthOpenings(hasher, engagement, ACTIVITIES, DEFAULT_CONFIG, RANGE);

    const corrupted = openings.map((o, i) => {
      if (i !== 0 || o.opening.path.length === 0) return o;
      const path = o.opening.path.map((step, j) =>
        j === 0 ? { ...step, sibling: flipLowBit(step.sibling) } : step,
      );
      return { ...o, opening: { ...o.opening, path } };
    });
    expect(verifyDepthOpenings(hasher, depthRootByAddr, corrupted, BAND)).toBe(false);
  });
});
