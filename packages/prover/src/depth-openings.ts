// H1: bind the epoch circuit's depth witness to each wallet leaf's depth_root.
//
// The oracle computes I6 (uptime) straight from clear per-wallet depth. The
// circuit instead takes depth as a private witness, so that witness must be
// PROVEN to be the depth committed in each wallet's depth_root — otherwise an MM
// could fabricate uptime. depth_root is a field of the slot leaf, which C1
// already binds to the epoch root-of-roots, so opening the contracted band
// against depth_root closes the last free-witness hole feeding the verdict.
//
// This module assembles, per active member slot, the contracted band's bucket
// series plus its Merkle opening against the wallet's depth_root, verifies those
// openings, and reproduces the uptime count from the bound values. The circuit
// mirrors it exactly: reconstruct the band leaf from the witness series
// (`bandSeriesLeaf`), verify the opening to depth_root, then fold the series into
// the per-bucket uptime sum. `uptimeFromOpenings` MUST equal the oracle's
// `uptimeBuckets`; the KAT on the laptop reuses these openings as its witness.

import {
  type AddressActivity,
  type BandOpening,
  type EpochRange,
  type IndexerConfig,
  bandSeriesLeaf,
  effectiveDepthBuckets,
  openBand,
  verifyBandOpening,
} from "@mmr/indexer";
import { type Digest, type Hasher, digestsEqual } from "@mmr/merkle";
import type { Engagement } from "./engagement.js";

/** One bucket's contracted-band minimum depth, both sides. */
export interface BandBucket {
  readonly bucket: number;
  readonly minBid: bigint;
  readonly minAsk: bigint;
}

export interface SlotDepthOpening {
  readonly slot: number;
  readonly addr: bigint;
  readonly bandBps: number;
  /** Contracted-band (minBid, minAsk) per bucket this wallet earned, bucket-ordered. */
  readonly series: readonly BandBucket[];
  /** Merkle opening of the band leaf against the wallet's depth_root. */
  readonly opening: BandOpening;
}

/**
 * Assemble, per active member slot, the contracted-band depth series and its
 * opening against the wallet's depth_root. Member selection mirrors the oracle:
 * active slots whose wallet actually appears in the pool this epoch. Inactive
 * (non-membership) slots contribute no depth and are skipped.
 */
export function assembleDepthOpenings(
  commitHasher: Hasher,
  engagement: Engagement,
  activities: ReadonlyMap<bigint, AddressActivity>,
  config: IndexerConfig,
  range: EpochRange,
): SlotDepthOpening[] {
  const bandBps = engagement.terms.bandBps;
  const out: SlotDepthOpening[] = [];
  for (let slot = 0; slot < engagement.wallets.activeCount; slot++) {
    const addr = engagement.wallets.slots[slot]!;
    const activity = activities.get(addr);
    if (activity === undefined) continue; // non-membership: nothing to open

    const buckets = effectiveDepthBuckets(activity, config, range);
    const series: BandBucket[] = [];
    for (const bk of buckets) {
      const pb = bk.perBand.find((p) => p.bandBps === bandBps);
      if (pb !== undefined) {
        series.push({ bucket: bk.bucket, minBid: pb.minBid, minAsk: pb.minAsk });
      }
    }
    const opening = openBand(commitHasher, buckets, config.bandsBps, bandBps);
    out.push({ slot, addr, bandBps, series, opening });
  }
  return out;
}

/**
 * Verify every depth opening against the committed depth_root of its wallet.
 * Two checks, both of which the circuit also makes:
 *   1. the band leaf is exactly the reconstruction of the witness series, so the
 *      opened (minBid, minAsk) values cannot be swapped for fabricated depth, and
 *   2. that leaf opens to the wallet's depth_root (bound to root-of-roots by C1).
 */
export function verifyDepthOpenings(
  commitHasher: Hasher,
  depthRootByAddr: ReadonlyMap<bigint, Digest>,
  openings: readonly SlotDepthOpening[],
  bandBps: number,
): boolean {
  for (const o of openings) {
    if (o.bandBps !== bandBps) return false;
    const depthRoot = depthRootByAddr.get(o.addr);
    if (depthRoot === undefined) return false;
    if (!digestsEqual(o.opening.bandLeaf, bandSeriesLeaf(commitHasher, bandBps, o.series))) {
      return false;
    }
    if (!verifyBandOpening(commitHasher, depthRoot, o.opening)) return false;
  }
  return true;
}

/**
 * Uptime bucket count from the BOUND depth openings — the circuit's I6, computed
 * over witness data that is proven to match depth_root. Sums each bucket across
 * slots and counts buckets meeting `depthTarget` on both sides. Equals the
 * oracle's `uptimeBuckets` for the same engagement and epoch.
 */
export function uptimeFromOpenings(
  openings: readonly SlotDepthOpening[],
  totalBuckets: number,
  depthTarget: bigint,
): number {
  const bid = new Array<bigint>(totalBuckets).fill(0n);
  const ask = new Array<bigint>(totalBuckets).fill(0n);
  for (const o of openings) {
    for (const s of o.series) {
      if (s.bucket < 0 || s.bucket >= totalBuckets) continue;
      bid[s.bucket] = bid[s.bucket]! + s.minBid;
      ask[s.bucket] = ask[s.bucket]! + s.minAsk;
    }
  }
  let count = 0;
  for (let b = 0; b < totalBuckets; b++) {
    if (bid[b]! >= depthTarget && ask[b]! >= depthTarget) count++;
  }
  return count;
}
