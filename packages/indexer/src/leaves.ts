// Map parsed per-address activity into a canonical tree leaf.
//
// Deterministic and total: given the same activity + config + epoch range it
// always produces the same leaf (hence the same root). The only policy applied
// here is anti-JIT — an LP position alive fewer than kMinSeconds before the epoch end
// earns no depth credit, so its depth_root commits to an empty series.

import { type Hasher, type Leaf, zeroMetrics } from "@mmr/merkle";
import type { IndexerConfig } from "./config.js";
import type { AddressActivity, DepthBucketSample, EpochRange } from "./provider.js";
import { commitDepth, commitFlow } from "./commit.js";

/**
 * True if the address's LP position first went live fewer than kMinSeconds before the
 * epoch end (by block timestamp), so it earns no depth credit (DD-31).
 */
export function isJit(
  activity: AddressActivity,
  config: IndexerConfig,
  range: EpochRange,
): boolean {
  return activity.lpFirstActiveTs !== null && range.endTs - activity.lpFirstActiveTs < config.kMinSeconds;
}

/**
 * The depth buckets that actually earn credit after the anti-JIT rule. This is
 * the exact series committed in depth_root, so the prover opens from the same
 * data the indexer committed.
 */
export function effectiveDepthBuckets(
  activity: AddressActivity,
  config: IndexerConfig,
  range: EpochRange,
): readonly DepthBucketSample[] {
  return isJit(activity, config, range) ? [] : activity.depthBuckets;
}

export function activityToLeaf(
  hasher: Hasher,
  activity: AddressActivity,
  config: IndexerConfig,
  range: EpochRange,
): Leaf {
  const depthBuckets = effectiveDepthBuckets(activity, config, range);

  return {
    addr: activity.addr,
    nextAddr: 0n, // the tree relinks this from sorted order
    isProtocol: activity.isProtocol,
    metrics: {
      ...zeroMetrics(),
      baseStart: activity.baseStart,
      baseEnd: activity.baseEnd,
      quoteEnd: activity.quoteEnd,
      lpBase: activity.lpBase,
      lpQuote: activity.lpQuote,
      xferIn: activity.xferIn,
      xferOut: activity.xferOut,
      fromTreasury: activity.fromTreasury,
      swapBaseIn: activity.swapBaseIn,
      swapBaseOut: activity.swapBaseOut,
      swapQuoteIn: activity.swapQuoteIn,
      swapQuoteOut: activity.swapQuoteOut,
    },
    depthRoot: commitDepth(hasher, depthBuckets, config.bandsBps),
    flowRoot: commitFlow(hasher, activity.flowWindows),
  };
}
