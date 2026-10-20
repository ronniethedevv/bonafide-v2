// depth_root and flow_root commitments.
//
// depth_root is a small Merkle tree with ONE LEAF PER BAND, so the epoch circuit
// can open only the contracted band (keeping leaves small, per the spec). Each
// band leaf commits to that band's per-bucket (minBid, minAsk) series.
//
// flow_root commits to per-window (buy, sell) totals for the round-trip check.

import {
  type Digest,
  type Hasher,
  type PathStep,
  encodeUint,
  digestsEqual,
} from "@mmr/merkle";
import type { DepthBucketSample, FlowWindowSample } from "./provider.js";

function u32(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new RangeError(`u32 out of range: ${n}`);
  }
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Canonical per-band series: bandBps, then each bucket sorted ascending. */
function encodeBandSeries(
  bandBps: number,
  series: ReadonlyArray<{ bucket: number; minBid: bigint; minAsk: bigint }>,
): Uint8Array {
  const sorted = [...series].sort((a, b) => a.bucket - b.bucket);
  const parts: Uint8Array[] = [u32(bandBps), u32(sorted.length)];
  for (const s of sorted) {
    parts.push(u32(s.bucket), encodeUint(s.minBid, 128), encodeUint(s.minAsk, 128));
  }
  return concat(parts);
}

function bandLeafDigests(
  hasher: Hasher,
  buckets: readonly DepthBucketSample[],
  bandsBps: readonly number[],
): Digest[] {
  // Collect, per band, the (bucket, minBid, minAsk) series from all buckets.
  const byBand = new Map<number, { bucket: number; minBid: bigint; minAsk: bigint }[]>();
  for (const b of bandsBps) byBand.set(b, []);
  for (const bk of buckets) {
    for (const pb of bk.perBand) {
      const arr = byBand.get(pb.bandBps);
      if (arr) arr.push({ bucket: bk.bucket, minBid: pb.minBid, minAsk: pb.minAsk });
    }
  }
  return bandsBps.map((band) =>
    hasher.hashLeaf(encodeBandSeries(band, byBand.get(band)!)),
  );
}

/** Build a balanced Merkle root + layers over leaf digests (power-of-two padded). */
function balancedTree(hasher: Hasher, leaves: Digest[]): { root: Digest; layers: Digest[][] } {
  const depth = Math.max(0, Math.ceil(Math.log2(Math.max(1, leaves.length))));
  const width = 1 << depth;
  const zero = hasher.hashLeaf(new Uint8Array(0));
  const base: Digest[] = [];
  for (let i = 0; i < width; i++) base.push(i < leaves.length ? leaves[i]! : zero);
  const layers: Digest[][] = [base];
  for (let l = 0; l < depth; l++) {
    const cur = layers[l]!;
    const next: Digest[] = [];
    for (let j = 0; j < cur.length; j += 2) next.push(hasher.hashNode(cur[j]!, cur[j + 1]!));
    layers.push(next);
  }
  return { root: layers[depth]![0]!, layers };
}

export function commitDepth(
  hasher: Hasher,
  buckets: readonly DepthBucketSample[],
  bandsBps: readonly number[],
): Digest {
  return balancedTree(hasher, bandLeafDigests(hasher, buckets, bandsBps)).root;
}

export interface BandOpening {
  bandBps: number;
  index: number;
  bandLeaf: Digest;
  path: PathStep[];
}

/** Open a single band from depth_root, for the epoch circuit's contracted band. */
export function openBand(
  hasher: Hasher,
  buckets: readonly DepthBucketSample[],
  bandsBps: readonly number[],
  bandBps: number,
): BandOpening {
  const index = bandsBps.indexOf(bandBps);
  if (index < 0) throw new Error(`band ${bandBps} not configured`);
  const leaves = bandLeafDigests(hasher, buckets, bandsBps);
  const { layers } = balancedTree(hasher, leaves);
  const path: PathStep[] = [];
  let idx = index;
  for (let l = 0; l < layers.length - 1; l++) {
    const cur = layers[l]!;
    const weAreRight = (idx & 1) === 1;
    const sibIdx = weAreRight ? idx - 1 : idx + 1;
    path.push({ sibling: cur[sibIdx]!, weAreRight });
    idx >>= 1;
  }
  return { bandBps, index, bandLeaf: leaves[index]!, path };
}

export function verifyBandOpening(
  hasher: Hasher,
  depthRoot: Digest,
  opening: BandOpening,
): boolean {
  let h = opening.bandLeaf;
  for (const step of opening.path) {
    h = step.weAreRight ? hasher.hashNode(step.sibling, h) : hasher.hashNode(h, step.sibling);
  }
  return digestsEqual(h, depthRoot);
}

/**
 * The committed leaf digest for one band's bucket series — exactly the leaf the
 * depth tree stores for `bandBps`. The epoch circuit reconstructs this from its
 * per-slot depth witness and checks the band opening against the leaf's
 * `depth_root` (H1); this is the off-chain mirror of that reconstruction, so the
 * witness depth cannot be fabricated. Byte image is identical to the leaf
 * `openBand` returns for the same series.
 */
export function bandSeriesLeaf(
  hasher: Hasher,
  bandBps: number,
  series: ReadonlyArray<{ bucket: number; minBid: bigint; minAsk: bigint }>,
): Digest {
  return hasher.hashLeaf(encodeBandSeries(bandBps, series));
}

// One leaf per window, so the epoch circuit can open a single window from
// flow_root to enforce the round-trip cap (I7) without revealing the whole series.
function flowWindowLeaf(hasher: Hasher, w: FlowWindowSample): Digest {
  return hasher.hashLeaf(
    concat([u32(w.window), encodeUint(w.buy, 128), encodeUint(w.sell, 128)]),
  );
}

function sortedFlowWindows(
  windows: readonly FlowWindowSample[],
): FlowWindowSample[] {
  return [...windows].sort((a, b) => a.window - b.window);
}

export function commitFlow(
  hasher: Hasher,
  windows: readonly FlowWindowSample[],
): Digest {
  const sorted = sortedFlowWindows(windows);
  return balancedTree(hasher, sorted.map((w) => flowWindowLeaf(hasher, w))).root;
}

export interface WindowOpening {
  window: number;
  buy: bigint;
  sell: bigint;
  index: number;
  leaf: Digest;
  path: PathStep[];
}

/** Open a single window from flow_root, for the epoch circuit's round-trip check. */
export function openWindow(
  hasher: Hasher,
  windows: readonly FlowWindowSample[],
  window: number,
): WindowOpening {
  const sorted = sortedFlowWindows(windows);
  const index = sorted.findIndex((w) => w.window === window);
  if (index < 0) throw new Error(`window ${window} not present`);
  const w = sorted[index]!;
  const { layers } = balancedTree(hasher, sorted.map((s) => flowWindowLeaf(hasher, s)));
  const path: PathStep[] = [];
  let idx = index;
  for (let l = 0; l < layers.length - 1; l++) {
    const cur = layers[l]!;
    const weAreRight = (idx & 1) === 1;
    const sibIdx = weAreRight ? idx - 1 : idx + 1;
    path.push({ sibling: cur[sibIdx]!, weAreRight });
    idx >>= 1;
  }
  return { window: w.window, buy: w.buy, sell: w.sell, index, leaf: flowWindowLeaf(hasher, w), path };
}

export function verifyWindowOpening(
  hasher: Hasher,
  flowRoot: Digest,
  opening: WindowOpening,
): boolean {
  let h = flowWindowLeaf(hasher, {
    window: opening.window,
    buy: opening.buy,
    sell: opening.sell,
  });
  if (!digestsEqual(h, opening.leaf)) return false;
  for (const step of opening.path) {
    h = step.weAreRight ? hasher.hashNode(step.sibling, h) : hasher.hashNode(h, step.sibling);
  }
  return digestsEqual(h, flowRoot);
}
