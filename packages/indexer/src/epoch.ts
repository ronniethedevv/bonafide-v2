// Epoch build orchestration.
//
// Pipeline (deterministic end to end):
//   pools above floor -> per-address leaves -> per-pool indexed tree
//   -> publish each tree to the content store -> epoch root-of-roots
//   -> (optional) attester signatures over (epoch, root, cid).
//
// Everything that touches the network is injected (ChainProvider, TreePublisher,
// AttesterCommittee), so this function is unit testable with in-memory fakes.

import { createHash } from "node:crypto";
import {
  type Hasher,
  IndexedMerkleTree,
  RootOfRoots,
  digestToHex,
  formatAddr,
  type PoolEntry,
} from "@mmr/merkle";
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import { type IndexerConfig, assertConfig, twapSampleTimes } from "./config.js";
import {
  type AttesterCommittee,
  type AttesterSignature,
  type ChainProvider,
  type EpochRange,
  type TreePublisher,
} from "./provider.js";
import { activityToLeaf } from "./leaves.js";
import { winsorizedTwap } from "./twap.js";

export interface EpochDeps {
  provider: ChainProvider;
  publisher: TreePublisher;
  attesters?: AttesterCommittee;
  /** Pool trees + root-of-roots. Default PoseidonHasher: the circuit's transientHash. */
  hasher?: Hasher;
  /**
   * Depth / flow commitments inside each leaf. Default PoseidonHasher: the circuit
   * opens depth_root (H1) and flow_root (M1) with transientHash.
   */
  commitHasher?: Hasher;
}

export interface PoolManifestEntry {
  poolAddr: string;
  rootHex: string;
  cid: string;
  leafCount: number;
  referencePrice: string;
}

export interface EpochManifest {
  chainId: number;
  epoch: number;
  startBlock: number;
  endBlock: number;
  endBlockHash: string;
  hasherId: string;
  bandsBps: readonly number[];
  bucketSeconds: number;
  /** Pool set (DD-21): with the end block, they make the discovered pools recomputable. */
  baseTokens: readonly string[];
  treasuryAddresses: readonly string[];
  poolDepthFloor: { bandBps: number; minQuote: Record<string, string> };
  /** Reference-price parameters (DD-20): with the range, they make referencePrice recomputable. */
  twapWindowSeconds: number;
  priceSampleSeconds: number;
  winsorFraction: number;
  poolCount: number;
  rootOfRootsHex: string;
  pools: PoolManifestEntry[];
  signatures: AttesterSignature[];
}

export interface EpochResult {
  rootOfRoots: RootOfRoots;
  manifest: EpochManifest;
  trees: Map<bigint, IndexedMerkleTree>;
}

/** Canonical, bigint-safe JSON serialization of a pool tree for publishing. */
export function serializePoolTree(tree: IndexedMerkleTree): Uint8Array {
  const leaves = tree.leaves.map((l) => ({
    addr: l.addr.toString(),
    nextAddr: l.nextAddr.toString(),
    isProtocol: l.isProtocol,
    metrics: Object.fromEntries(
      Object.entries(l.metrics).map(([k, v]) => [k, (v as bigint).toString()]),
    ),
    depthRoot: digestToHex(l.depthRoot),
    flowRoot: digestToHex(l.flowRoot),
  }));
  const doc = { hasher: tree.hasher.id, root: digestToHex(tree.root), leaves };
  return new TextEncoder().encode(JSON.stringify(doc));
}

export async function buildEpoch(
  deps: EpochDeps,
  config: IndexerConfig,
  range: EpochRange,
): Promise<EpochResult> {
  assertConfig(config);
  const hasher = deps.hasher ?? new PoseidonHasher();
  const commitHasher = deps.commitHasher ?? new PoseidonHasher();

  const discovered = await deps.provider.poolsAboveFloor(
    config.poolDepthFloor,
    range.endBlock,
    config.baseTokens,
  );
  const pools = [...discovered]
    .sort((a, b) => (a.poolAddr < b.poolAddr ? -1 : a.poolAddr > b.poolAddr ? 1 : 0));

  const trees = new Map<bigint, IndexedMerkleTree>();
  const poolEntries: PoolEntry[] = [];
  const poolManifest: PoolManifestEntry[] = [];

  for (const pool of pools) {
    const activity = await deps.provider.poolActivity(pool, range, {
      bucketSeconds: config.bucketSeconds,
      bandsBps: config.bandsBps,
      treasuryAddresses: config.treasuryAddresses,
    });
    const leaves = activity.map((a) => activityToLeaf(commitHasher, a, config, range));
    const tree = IndexedMerkleTree.build(hasher, leaves);
    trees.set(pool.poolAddr, tree);

    const cid = await deps.publisher.publish(serializePoolTree(tree));

    const samples = await deps.provider.poolPriceSamples(
      pool,
      range,
      twapSampleTimes(config, range.endTs),
    );
    const referencePrice = winsorizedTwap(
      samples,
      range.endTs - config.twapWindowSeconds,
      range.endTs,
      config.winsorFraction,
    );

    poolEntries.push({ poolAddr: pool.poolAddr, poolRoot: tree.root });
    poolManifest.push({
      poolAddr: formatAddr(pool.poolAddr),
      rootHex: digestToHex(tree.root),
      cid,
      leafCount: tree.size,
      referencePrice: referencePrice.toString(),
    });
  }

  const rootOfRoots = RootOfRoots.build(hasher, range.epoch, poolEntries);
  const rootOfRootsHex = rootOfRoots.rootHex();

  // Publish the manifest itself, then sign (epoch, root, manifest CID).
  const preManifest: Omit<EpochManifest, "signatures"> = {
    chainId: deps.provider.chainId(),
    epoch: range.epoch,
    startBlock: range.startBlock,
    endBlock: range.endBlock,
    endBlockHash: range.endBlockHash,
    hasherId: hasher.id,
    bandsBps: config.bandsBps,
    bucketSeconds: config.bucketSeconds,
    baseTokens: config.baseTokens,
    treasuryAddresses: config.treasuryAddresses,
    poolDepthFloor: {
      bandBps: config.poolDepthFloor.bandBps,
      minQuote: Object.fromEntries(
        Object.entries(config.poolDepthFloor.minQuote)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([q, v]) => [q, v.toString()]),
      ),
    },
    twapWindowSeconds: config.twapWindowSeconds,
    priceSampleSeconds: config.priceSampleSeconds,
    winsorFraction: config.winsorFraction,
    poolCount: pools.length,
    rootOfRootsHex,
    pools: poolManifest,
  };
  const manifestCid = await deps.publisher.publish(
    new TextEncoder().encode(JSON.stringify(preManifest)),
  );

  const signatures = deps.attesters
    ? await deps.attesters.sign(range.epoch, rootOfRootsHex, manifestCid)
    : [];

  return {
    rootOfRoots,
    manifest: { ...preManifest, signatures },
    trees,
  };
}

/** Deterministic content-addressed store for development and tests. */
export class InMemoryPublisher implements TreePublisher {
  private readonly store = new Map<string, Uint8Array>();

  async publish(bytes: Uint8Array): Promise<string> {
    const cid =
      "mem://" + createHash("sha256").update(bytes).digest("hex").slice(0, 46);
    this.store.set(cid, bytes);
    return cid;
  }

  get(cid: string): Uint8Array | undefined {
    return this.store.get(cid);
  }

  get count(): number {
    return this.store.size;
  }
}
