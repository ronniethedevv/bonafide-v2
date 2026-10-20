// depth_root and flow_root commitments.
//
// depth_root is a small Merkle tree with ONE LEAF PER BAND, so the epoch circuit
// can open only the contracted band (keeping leaves small, per the spec). Each
// band leaf commits to that band's per-bucket (minBid, minAsk) series.
//
// flow_root commits to per-window (buy, sell) totals for the round-trip check.
//
// Leaf preimages are the byte images of Compact structs (little-endian Uints),
// so PoseidonHasher can decode them and hash exactly as the circuit's
// transientHash does (H1):
//   band leaf   BandSeries { band_bps: Uint<64>, bid: Vector<48, Uint<128>>,
//                            ask: Vector<48, Uint<128>> }          (1544 B)
//   flow leaf   FlowWindow { window: Uint<32>, buy: Uint<128>, sell: Uint<128> } (36 B)
// The band series is DENSE: a fixed 48-bucket vector (missing buckets are 0),
// matching the circuit's depth witness. The band tree has a fixed depth of
// BAND_TREE_DEPTH (padded with an empty band-0 leaf), so the circuit's path is a
// fixed-length vector.

import {
  type Digest,
  type Hasher,
  type PathStep,
  encodeUintLE,
  digestsEqual,
} from "@mmr/merkle";
import type { DepthBucketSample, FlowWindowSample } from "./provider.js";

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

/** Buckets in the circuit's dense depth witness (`Vector<48, Uint<128>>`). */
export const BAND_SERIES_BUCKETS = 48;
/** Fixed depth of the depth_root band tree (≤ 4 bands); the circuit's `Vector<2, PathStep>`. */
export const BAND_TREE_DEPTH = 2;

type BandSample = { bucket: number; minBid: bigint; minAsk: bigint };

/**
 * Dense form of a band's bucket series: (minBid, minAsk) per bucket 0..47, 0 where
 * the wallet has no sample. This is exactly the circuit's per-slot depth witness
 * (bidMin[j], askMin[j]). Sparse and dense forms with the same non-zero values
 * yield the same leaf, and the same uptime.
 */
export function denseBandSeries(series: ReadonlyArray<BandSample>): { bid: bigint[]; ask: bigint[] } {
  const bid = new Array<bigint>(BAND_SERIES_BUCKETS).fill(0n);
  const ask = new Array<bigint>(BAND_SERIES_BUCKETS).fill(0n);
  const seen = new Set<number>();
  for (const s of series) {
    if (!Number.isInteger(s.bucket) || s.bucket < 0 || s.bucket >= BAND_SERIES_BUCKETS) {
      throw new RangeError(`bucket out of range [0, ${BAND_SERIES_BUCKETS}): ${s.bucket}`);
    }
    if (seen.has(s.bucket)) throw new Error(`duplicate bucket ${s.bucket} in band series`);
    seen.add(s.bucket);
    bid[s.bucket] = s.minBid;
    ask[s.bucket] = s.minAsk;
  }
  return { bid, ask };
}

/** Byte image of the circuit's BandSeries struct for one band. */
function encodeBandSeries(bandBps: number, series: ReadonlyArray<BandSample>): Uint8Array {
  if (!Number.isInteger(bandBps) || bandBps < 0) throw new RangeError(`bad bandBps: ${bandBps}`);
  const { bid, ask } = denseBandSeries(series);
  return concat([
    encodeUintLE(BigInt(bandBps), 64),
    ...bid.map((v) => encodeUintLE(v, 128)),
    ...ask.map((v) => encodeUintLE(v, 128)),
  ]);
}

/** Padding for unused band-tree positions: an empty band-0 series. */
function emptyBandLeaf(hasher: Hasher): Digest {
  return hasher.hashLeaf(encodeBandSeries(0, []));
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

/**
 * Build a balanced Merkle root + layers over leaf digests, padded with `pad` to
 * 2^depth leaves. `depth` defaults to the smallest that fits.
 */
function balancedTree(
  hasher: Hasher,
  leaves: Digest[],
  pad: Digest,
  depth = Math.max(0, Math.ceil(Math.log2(Math.max(1, leaves.length)))),
): { root: Digest; layers: Digest[][] } {
  const width = 1 << depth;
  if (leaves.length > width) throw new RangeError(`${leaves.length} leaves exceed depth ${depth}`);
  const base: Digest[] = [];
  for (let i = 0; i < width; i++) base.push(i < leaves.length ? leaves[i]! : pad);
  const layers: Digest[][] = [base];
  for (let l = 0; l < depth; l++) {
    const cur = layers[l]!;
    const next: Digest[] = [];
    for (let j = 0; j < cur.length; j += 2) next.push(hasher.hashNode(cur[j]!, cur[j + 1]!));
    layers.push(next);
  }
  return { root: layers[depth]![0]!, layers };
}

function bandTree(hasher: Hasher, leaves: Digest[]): { root: Digest; layers: Digest[][] } {
  return balancedTree(hasher, leaves, emptyBandLeaf(hasher), BAND_TREE_DEPTH);
}

export function commitDepth(
  hasher: Hasher,
  buckets: readonly DepthBucketSample[],
  bandsBps: readonly number[],
): Digest {
  return bandTree(hasher, bandLeafDigests(hasher, buckets, bandsBps)).root;
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
  const { layers } = bandTree(hasher, leaves);
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
  if (!Number.isInteger(w.window) || w.window < 0 || w.window > 0xffffffff) {
    throw new RangeError(`window out of range: ${w.window}`);
  }
  return hasher.hashLeaf(
    concat([encodeUintLE(BigInt(w.window), 32), encodeUintLE(w.buy, 128), encodeUintLE(w.sell, 128)]),
  );
}

/** Padding for unused flow-tree positions: a zero-flow leaf (adds nothing to rt or gross). */
const emptyFlowLeaf = (hasher: Hasher): Digest =>
  flowWindowLeaf(hasher, { window: 0, buy: 0n, sell: 0n });

function flowTree(hasher: Hasher, sorted: readonly FlowWindowSample[]) {
  return balancedTree(hasher, sorted.map((w) => flowWindowLeaf(hasher, w)), emptyFlowLeaf(hasher));
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
  return flowTree(hasher, sorted).root;
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
  const { layers } = flowTree(hasher, sorted);
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
