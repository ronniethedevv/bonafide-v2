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
  Sha256Hasher,
  digestToHex,
  formatAddr,
  type PoolEntry,
} from "@mmr/merkle";
import { type IndexerConfig, assertConfig } from "./config.js";
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
  hasher?: Hasher;
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
  const hasher = deps.hasher ?? new Sha256Hasher();

  const discovered = await deps.provider.poolsAboveFloor(
    config.liquidityFloor,
    range.endBlock,
  );
  const pools = discovered
    .filter((p) => p.liquidity >= config.liquidityFloor)
    .sort((a, b) => (a.poolAddr < b.poolAddr ? -1 : a.poolAddr > b.poolAddr ? 1 : 0));

  const trees = new Map<bigint, IndexedMerkleTree>();
  const poolEntries: PoolEntry[] = [];
  const poolManifest: PoolManifestEntry[] = [];

  for (const pool of pools) {
    const activity = await deps.provider.poolActivity(pool, range);
    const leaves = activity.map((a) => activityToLeaf(hasher, a, config, range));
    const tree = IndexedMerkleTree.build(hasher, leaves);
    trees.set(pool.poolAddr, tree);

    const cid = await deps.publisher.publish(serializePoolTree(tree));

    const samples = await deps.provider.poolPriceSamples(pool, range);
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
