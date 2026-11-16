// Challenge watchdog: independently recompute the epoch root from published trees.
//
// Determinism is the protocol's safety net — anyone can rebuild every root from
// the published data and challenge a false one. This module parses the tree
// documents the indexer published (serializePoolTree), rebuilds each pool tree
// and the root-of-roots, and compares to the attesters' claimed root. A mismatch
// is grounds to challenge within the challenge window.

import {
  IndexedMerkleTree,
  RootOfRoots,
  zeroMetrics,
  type Hasher,
  type Leaf,
  type LeafMetrics,
  type PoolEntry,
  parseAddr,
} from "@mmr/merkle";

interface SerializedLeaf {
  addr: string;
  nextAddr: string;
  isProtocol: boolean;
  metrics: Record<string, string>;
  depthRoot: string;
  flowRoot: string;
}

interface SerializedTree {
  hasher: string;
  root: string;
  leaves: SerializedLeaf[];
}

const METRIC_KEYS: readonly (keyof LeafMetrics)[] = [
  "baseStart",
  "baseEnd",
  "quoteEnd",
  "lpBase",
  "lpQuote",
  "xferIn",
  "xferOut",
  "fromTreasury",
  "swapBaseIn",
  "swapBaseOut",
  "swapQuoteIn",
  "swapQuoteOut",
];

function hexToDigest(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length !== 64 || !/^[0-9a-fA-F]+$/.test(h)) {
    throw new Error(`invalid 32-byte hex: ${hex}`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toMetrics(raw: Record<string, string>): LeafMetrics {
  const m = zeroMetrics();
  for (const k of METRIC_KEYS) {
    const v = raw[k];
    if (v === undefined) throw new Error(`published leaf missing metric ${k}`);
    m[k] = BigInt(v);
  }
  return m;
}

function parseTreeDoc(bytes: Uint8Array): SerializedTree {
  return JSON.parse(new TextDecoder().decode(bytes)) as SerializedTree;
}

/**
 * Rebuild a pool tree from its published document and return the recomputed root
 * alongside the root stored in the document. The sentinel leaf (addr 0) is
 * dropped — build() re-adds it — so only real leaves are fed back in.
 */
export function recomputePoolTree(
  hasher: Hasher,
  bytes: Uint8Array,
): { tree: IndexedMerkleTree; claimedRootHex: string } {
  const doc = parseTreeDoc(bytes);
  const realLeaves: Leaf[] = doc.leaves
    .filter((l) => l.addr !== "0")
    .map((l) => ({
      addr: parseAddr(l.addr.startsWith("0x") ? l.addr : "0x" + BigInt(l.addr).toString(16)),
      nextAddr: 0n, // relinked on build
      isProtocol: l.isProtocol,
      metrics: toMetrics(l.metrics),
      depthRoot: hexToDigest(l.depthRoot),
      flowRoot: hexToDigest(l.flowRoot),
    }));
  return { tree: IndexedMerkleTree.build(hasher, realLeaves), claimedRootHex: doc.root };
}

export interface RecomputeResult {
  ok: boolean;
  recomputedRootOfRootsHex: string;
  claimedRootOfRootsHex: string;
  /** Pools whose recomputed root disagreed with the published document. */
  mismatchedPools: string[];
}

/**
 * Verify an epoch end to end: each published pool tree recomputes to its stored
 * root, and the root-of-roots over those pools matches the attesters' claim.
 */
export function verifyEpoch(
  hasher: Hasher,
  epoch: number,
  publishedTrees: ReadonlyMap<bigint, Uint8Array>,
  claimedRootOfRootsHex: string,
): RecomputeResult {
  const entries: PoolEntry[] = [];
  const mismatchedPools: string[] = [];

  for (const [poolAddr, bytes] of publishedTrees) {
    const { tree, claimedRootHex } = recomputePoolTree(hasher, bytes);
    const recomputedHex = "0x" + Buffer.from(tree.root).toString("hex");
    if (recomputedHex !== claimedRootHex) {
      mismatchedPools.push("0x" + poolAddr.toString(16));
    }
    entries.push({ poolAddr, poolRoot: tree.root });
  }

  const ror = RootOfRoots.build(hasher, epoch, entries);
  const recomputedRootOfRootsHex = ror.rootHex();

  return {
    ok: mismatchedPools.length === 0 && recomputedRootOfRootsHex === claimedRootOfRootsHex,
    recomputedRootOfRootsHex,
    claimedRootOfRootsHex,
    mismatchedPools,
  };
}
