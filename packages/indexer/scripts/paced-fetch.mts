// Keep RPC calls under a provider's rate limit with steady pacing instead of bursting into
// 429s and backing off (which, on a free plan, collapses throughput to ~1 request/second).
// Wrap the network fetch BEFORE the on-disk cache, so cache hits are never delayed.

import type { FetchLike } from "../src/http.js";

export function pacedFetch(base: FetchLike, perSecond: number): FetchLike {
  const gap = 1000 / perSecond;
  let next = 0;
  return async (input, init) => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
    return base(input, init);
  };
}
