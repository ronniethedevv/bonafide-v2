// The committed depth and flow series of one pool, published next to its tree.
//
// A pool tree's leaves carry only depth_root and flow_root. The series behind them are
// public chain data, but rebuilding them needs an archive RPC and the whole day's logs.
// Publishing the exact series each leaf commits to (after the anti-JIT rule) means a
// market maker can open its own wallets' leaves from public data alone, and anyone can
// check every leaf's depth_root and flow_root against the series. The root does not
// change: it commits to the leaves, not to this document.

import { formatAddr, parseAddr, type Hasher, type Digest } from "@mmr/merkle";
import { commitDepth, commitFlow } from "./commit.js";
import type { IndexerConfig } from "./config.js";
import { effectiveDepthBuckets } from "./leaves.js";
import type { AddressActivity, DepthBucketSample, EpochRange, FlowWindowSample } from "./provider.js";

export const SERIES_VERSION = 1;

/** One address's committed series: exactly what its depth_root and flow_root hash. */
export interface AddressSeries {
  readonly depth: readonly DepthBucketSample[];
  readonly flow: readonly FlowWindowSample[];
}

interface SeriesDoc {
  version: number;
  bandsBps: number[];
  /** [addr, depth: [bucket, [[bandBps, minBid, minAsk], ...]][], flow: [window, buy, sell][]] */
  addresses: [string, [number, [number, string, string][]][], [number, string, string][]][];
}

/**
 * Canonical JSON of a pool's committed series. Addresses are sorted; an address whose
 * effective depth and flow are both empty is left out (it commits to empty series).
 */
export function serializePoolSeries(
  activity: readonly AddressActivity[],
  config: IndexerConfig,
  range: EpochRange,
): Uint8Array {
  const rows = [...activity]
    .sort((a, b) => (a.addr < b.addr ? -1 : a.addr > b.addr ? 1 : 0))
    .map((a) => ({ addr: a.addr, depth: effectiveDepthBuckets(a, config, range), flow: a.flowWindows }))
    .filter((r) => r.depth.length > 0 || r.flow.length > 0);
  const doc: SeriesDoc = {
    version: SERIES_VERSION,
    bandsBps: [...config.bandsBps],
    addresses: rows.map((r) => [
      formatAddr(r.addr),
      [...r.depth]
        .sort((x, y) => x.bucket - y.bucket)
        .map((b) => [b.bucket, b.perBand.map((p) => [p.bandBps, p.minBid.toString(), p.minAsk.toString()] as [number, string, string])]),
      [...r.flow]
        .sort((x, y) => x.window - y.window)
        .map((f) => [f.window, f.buy.toString(), f.sell.toString()] as [number, string, string]),
    ]),
  };
  return new TextEncoder().encode(JSON.stringify(doc));
}

/** Parse a published series document; untrusted input, so every field is checked. */
export function parsePoolSeries(bytes: Uint8Array): { bandsBps: number[]; series: Map<bigint, AddressSeries> } {
  const doc = JSON.parse(new TextDecoder().decode(bytes)) as SeriesDoc;
  if (doc.version !== SERIES_VERSION) throw new Error(`unsupported series version ${String(doc.version)}`);
  if (!Array.isArray(doc.bandsBps) || !doc.bandsBps.every((b) => Number.isInteger(b) && b > 0)) {
    throw new Error("series: bad bandsBps");
  }
  const uint = (s: string): bigint => {
    if (typeof s !== "string" || !/^\d+$/.test(s)) throw new Error(`series: bad amount ${String(s)}`);
    return BigInt(s);
  };
  const series = new Map<bigint, AddressSeries>();
  for (const [addr, depth, flow] of doc.addresses) {
    const a = parseAddr(addr);
    if (series.has(a)) throw new Error(`series: duplicate address ${addr}`);
    series.set(a, {
      depth: depth.map(([bucket, perBand]) => ({
        bucket,
        perBand: perBand.map(([bandBps, minBid, minAsk]) => ({ bandBps, minBid: uint(minBid), minAsk: uint(minAsk) })),
      })),
      flow: flow.map(([window, buy, sell]) => ({ window, buy: uint(buy), sell: uint(sell) })),
    });
  }
  return { bandsBps: doc.bandsBps, series };
}

/** An address's series from a parsed document (empty when it is not listed). */
export function seriesOf(series: ReadonlyMap<bigint, AddressSeries>, addr: bigint): AddressSeries {
  return series.get(addr) ?? { depth: [], flow: [] };
}

/** The (depth_root, flow_root) an address's published series commit to. */
export function seriesRoots(
  hasher: Hasher,
  s: AddressSeries,
  bandsBps: readonly number[],
): { depthRoot: Digest; flowRoot: Digest } {
  return { depthRoot: commitDepth(hasher, s.depth, bandsBps), flowRoot: commitFlow(hasher, s.flow) };
}
