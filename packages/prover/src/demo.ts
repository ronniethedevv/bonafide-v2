// End-to-end demo: indexer buildEpoch -> witness assembly -> I1-I8 verdict.
//
// Wires the real pipeline over fixture data so the whole loop is exercised in one
// place (and unit-tested). This is the backbone of the MM prover CLI (build-order
// item #6): in production the DemoProvider is replaced by a Base archive-RPC
// reader and the activities come from the MM's local witness store.

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
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import { createEngagement, type Engagement, type EngagementTerms } from "./engagement.js";
import { assembleWitness, verifyWitness } from "./openings.js";
import {
  assembleDepthOpenings,
  uptimeFromOpenings,
  verifyDepthOpenings,
} from "./depth-openings.js";
import { evaluateEpoch, type EpochVerdict } from "./oracle.js";

const DEMO_POOL = 0xabcdn;

const RANGE: EpochRange = {
  epoch: 1,
  startBlock: 900_000,
  endBlock: 1_000_000,
  endBlockHash: "0xdemo",
  startTs: 1_000_000,
  endTs: 1_086_400,
};

const TERMS: EngagementTerms = {
  floorPriceP: 1n,
  loanL0: 1000n,
  quoteStartQ0: 0n,
  disposalD: 0n,
  netSellS: 0n,
  depthTarget: 100n,
  roundtripSharePpm: 600_000n,
  bandBps: 100,
};

function fullDepth(minBid: bigint, minAsk: bigint): DepthBucketSample[] {
  const out: DepthBucketSample[] = [];
  for (let b = 0; b < bucketsPerEpoch(DEFAULT_CONFIG); b++) {
    out.push({
      bucket: b,
      perBand: DEFAULT_CONFIG.bandsBps.map((bandBps) => ({ bandBps, minBid, minAsk })),
    });
  }
  return out;
}

function compliantActivity(addr: bigint): AddressActivity {
  return {
    addr,
    isProtocol: false,
    baseStart: 1000n,
    baseEnd: 800n,
    quoteEnd: 0n,
    lpBase: 300n,
    lpQuote: 0n,
    // from_treasury (the loan) is part of xfer_in and excluded from spendable
    // budget by I5; the only inflow here is the 1000 loan, so xfer_in == 1000.
    xferIn: 1000n,
    xferOut: 0n,
    fromTreasury: 1000n,
    swapBaseIn: 50n,
    swapBaseOut: 50n,
    swapQuoteIn: 0n,
    swapQuoteOut: 0n,
    depthBuckets: fullDepth(60n, 60n), // two wallets sum to 120 >= target 100
    flowWindows: [{ window: 0, buy: 50n, sell: 50n }],
    lpFirstActiveBlock: RANGE.endBlock - 1000,
  };
}

const DEMO_WALLETS = [0x10n, 0x20n];

class DemoProvider implements ChainProvider {
  chainId(): number {
    return DEFAULT_CONFIG.chainId;
  }
  async finalizedBlock(): Promise<number> {
    return RANGE.endBlock;
  }
  async poolsAboveFloor(): Promise<PoolDescriptor[]> {
    return [
      { poolAddr: DEMO_POOL, token0: 1n, token1: 2n, liquidity: 1n, dex: "uniswap-v3" },
    ];
  }
  async poolActivity(): Promise<AddressActivity[]> {
    return DEMO_WALLETS.map(compliantActivity);
  }
  async poolPriceSamples(_pool: PoolDescriptor, range: EpochRange): Promise<PriceSample[]> {
    return [
      { ts: range.endTs - 1200, price: 100n },
      { ts: range.endTs - 600, price: 101n },
    ];
  }
}

export interface DemoResult {
  rootOfRootsHex: string;
  witnessValid: boolean;
  /** H1: every contracted-band depth opening verifies and reproduces the uptime. */
  depthBound: boolean;
  verdict: EpochVerdict;
  engagement: Engagement;
  poolCount: number;
}

export async function runDemoEpoch(): Promise<DemoResult> {
  // The circuit's transientHash for the pool trees and the depth/flow commitments.
  const hasher = new PoseidonHasher();
  const publisher = new InMemoryPublisher();

  const epoch = await buildEpoch(
    { provider: new DemoProvider(), publisher, hasher, commitHasher: hasher },
    DEFAULT_CONFIG,
    RANGE,
  );

  const engagement = createEngagement({
    id: "demo-engagement",
    poolAddr: DEMO_POOL,
    wallets: DEMO_WALLETS,
    salt: new Uint8Array(32).fill(7),
    terms: TERMS,
  });

  const tree = epoch.trees.get(DEMO_POOL);
  if (tree === undefined) throw new Error("demo pool missing from epoch");

  const bundle = assembleWitness(tree, epoch.rootOfRoots, engagement);
  const witnessValid = verifyWitness(hasher, epoch.rootOfRoots, bundle);

  const activities = new Map(DEMO_WALLETS.map((w) => [w, compliantActivity(w)]));
  const verdict = evaluateEpoch(engagement, activities, DEFAULT_CONFIG, RANGE, {
    settled: true,
  });

  // H1: open each wallet's contracted-band depth against its committed depth_root
  // (hashed with `hasher`, as the circuit does), and
  // confirm the bound depth reproduces the oracle's uptime.
  const depthOpenings = assembleDepthOpenings(hasher, engagement, activities, DEFAULT_CONFIG, RANGE);
  const depthRootByAddr = new Map(
    tree.leaves.filter((l) => l.addr !== 0n).map((l) => [l.addr, l.depthRoot]),
  );
  const depthBound =
    verifyDepthOpenings(hasher, depthRootByAddr, depthOpenings, TERMS.bandBps) &&
    uptimeFromOpenings(depthOpenings, bucketsPerEpoch(DEFAULT_CONFIG), TERMS.depthTarget) ===
      verdict.uptimeBuckets;

  return {
    rootOfRootsHex: epoch.rootOfRoots.rootHex(),
    witnessValid,
    depthBound,
    verdict,
    engagement,
    poolCount: epoch.manifest.poolCount,
  };
}
