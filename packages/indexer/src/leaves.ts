// Map parsed per-address activity into a canonical tree leaf.
//
// Deterministic and total: given the same activity + config + epoch range it
// always produces the same leaf (hence the same root). The only policy applied
// here is anti-JIT — an LP position alive fewer than K_min blocks earns no depth
// credit, so its depth_root commits to an empty series.

import { type Hasher, type Leaf, zeroMetrics } from "@mmr/merkle";
import type { IndexerConfig } from "./config.js";
import type { AddressActivity, EpochRange } from "./provider.js";
import { commitDepth, commitFlow } from "./commit.js";

export function activityToLeaf(
  hasher: Hasher,
  activity: AddressActivity,
  config: IndexerConfig,
  range: EpochRange,
): Leaf {
  const jit =
    activity.lpFirstActiveBlock !== null &&
    range.endBlock - activity.lpFirstActiveBlock < config.kMinBlocks;

  const depthBuckets = jit ? [] : activity.depthBuckets;

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
