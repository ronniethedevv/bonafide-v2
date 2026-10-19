// I1-I8 reference oracle.
//
// Computes the epoch verdict in plain TypeScript from the committed engagement and
// the MM's local per-wallet activity (the witness). This is the KNOWN-ANSWER
// REFERENCE the Compact epoch_proof circuit must match (build-order item #2); it
// is also the core of the MM prover CLI (#6). It is NOT a zero-knowledge proof —
// it sees the private data in the clear, by design, so we can test the circuit
// against it.
//
// Invariant definitions follow packages/contracts/INVARIANTS.md exactly. All
// amounts are unsigned bigint; comparisons avoid subtraction that could underflow.
//
// Fixed-point note: quote is valued in base as `quote * P` (P = base units per
// quote unit), matching epoch_proof.compact. The exact scaling convention is a
// pilot decision; the oracle and circuit must agree on it.

import {
  type AddressActivity,
  type EpochRange,
  type IndexerConfig,
  bucketsPerEpoch,
  effectiveDepthBuckets,
} from "@mmr/indexer";
import type { Engagement } from "./engagement.js";

export interface InvariantResults {
  I1_sortedAppendOnly: boolean;
  I2_accountedOnce: boolean;
  I3_custodyFloor: boolean;
  I4_netSellingCap: boolean;
  I5_outflowCap: boolean;
  I6_uptime: boolean;
  I7_roundTripCap: boolean;
  I8_settled: boolean;
}

export interface EpochVerdict {
  pass: boolean;
  uptimeBuckets: number;
  totalBuckets: number;
  invariants: InvariantResults;
  sums: {
    heldBase: bigint;
    heldQuoteAtP: bigint;
    swapBaseIn: bigint;
    swapBaseOut: bigint;
    xferIn: bigint;
    xferOut: bigint;
    fromTreasury: bigint;
    roundTripVolume: bigint;
    grossVolume: bigint;
  };
}

export interface EvaluateOptions {
  /** I8: >= 2/3 attesters signed the root and the challenge window passed. */
  settled: boolean;
  /** Minimum buckets that must pass for uptime to count as met (default: all). */
  minUptimeBuckets?: number;
}

function sortedAppendOnly(eng: Engagement): boolean {
  const { slots, bitmap, activeCount } = eng.wallets;
  // active slots are the low `activeCount`, strictly ascending; rest are 0 pads
  for (let i = 0; i < slots.length; i++) {
    if (i < activeCount) {
      if (bitmap[i] !== true || slots[i] === 0n) return false;
      if (i > 0 && !(slots[i - 1]! < slots[i]!)) return false;
    } else if (bitmap[i] !== false || slots[i] !== 0n) {
      return false;
    }
  }
  return true;
}

export function evaluateEpoch(
  engagement: Engagement,
  activities: ReadonlyMap<bigint, AddressActivity>,
  config: IndexerConfig,
  range: EpochRange,
  opts: EvaluateOptions,
): EpochVerdict {
  const t = engagement.terms;
  const P = t.floorPriceP;

  // Member activities: committed, active wallets that actually appear in the pool.
  const members: AddressActivity[] = [];
  let i2 = true;
  for (let slot = 0; slot < engagement.wallets.activeCount; slot++) {
    const addr = engagement.wallets.slots[slot]!;
    const a = activities.get(addr);
    if (a === undefined) continue; // inactive this epoch (non-membership)
    if (a.isProtocol) i2 = false; // I2: a wallet is never a protocol contract
    members.push(a);
  }

  let heldBase = 0n;
  let heldQuoteAtP = 0n;
  let swapBaseIn = 0n;
  let swapBaseOut = 0n;
  let xferIn = 0n;
  let xferOut = 0n;
  let fromTreasury = 0n;
  for (const a of members) {
    heldBase += a.baseEnd + a.lpBase;
    heldQuoteAtP += (a.quoteEnd + a.lpQuote) * P;
    swapBaseIn += a.swapBaseIn;
    swapBaseOut += a.swapBaseOut;
    xferIn += a.xferIn;
    xferOut += a.xferOut;
    fromTreasury += a.fromTreasury;
  }

  // I3: custody floor (no subtraction).
  const i3 = heldBase + heldQuoteAtP + t.disposalD >= t.loanL0 + t.quoteStartQ0 * P;
  // I4: net selling cap.
  const i4 = swapBaseOut <= swapBaseIn + t.netSellS;
  // I5: outflow cap (loan inflow excluded via from_treasury).
  const i5 = xferOut <= xferIn + t.disposalD + fromTreasury;

  // I6: uptime — summed per-wallet minimum depth per bucket at the contracted band.
  const totalBuckets = bucketsPerEpoch(config);
  const bid = new Array<bigint>(totalBuckets).fill(0n);
  const ask = new Array<bigint>(totalBuckets).fill(0n);
  for (const a of members) {
    for (const bucket of effectiveDepthBuckets(a, config, range)) {
      if (bucket.bucket < 0 || bucket.bucket >= totalBuckets) continue;
      const band = bucket.perBand.find((pb) => pb.bandBps === t.bandBps);
      if (band === undefined) continue;
      bid[bucket.bucket] = bid[bucket.bucket]! + band.minBid;
      ask[bucket.bucket] = ask[bucket.bucket]! + band.minAsk;
    }
  }
  let uptimeBuckets = 0;
  for (let b = 0; b < totalBuckets; b++) {
    if (bid[b]! >= t.depthTarget && ask[b]! >= t.depthTarget) uptimeBuckets++;
  }
  const minUptime = opts.minUptimeBuckets ?? totalBuckets;
  const i6 = uptimeBuckets >= minUptime;

  // I7: round-trip cap. Per window, min(buys, sells) is round-trip volume.
  const buysByWindow = new Map<number, bigint>();
  const sellsByWindow = new Map<number, bigint>();
  for (const a of members) {
    for (const w of a.flowWindows) {
      buysByWindow.set(w.window, (buysByWindow.get(w.window) ?? 0n) + w.buy);
      sellsByWindow.set(w.window, (sellsByWindow.get(w.window) ?? 0n) + w.sell);
    }
  }
  let roundTripVolume = 0n;
  let grossVolume = 0n;
  for (const [w, buys] of buysByWindow) {
    const sells = sellsByWindow.get(w) ?? 0n;
    roundTripVolume += buys < sells ? buys : sells;
    grossVolume += buys + sells;
  }
  for (const [w, sells] of sellsByWindow) {
    if (!buysByWindow.has(w)) grossVolume += sells;
  }
  // roundTrip / gross <= ppm / 1e6  <=>  roundTrip * 1e6 <= ppm * gross
  const i7 = roundTripVolume * 1_000_000n <= t.roundtripSharePpm * grossVolume;

  const invariants: InvariantResults = {
    I1_sortedAppendOnly: sortedAppendOnly(engagement),
    I2_accountedOnce: i2,
    I3_custodyFloor: i3,
    I4_netSellingCap: i4,
    I5_outflowCap: i5,
    I6_uptime: i6,
    I7_roundTripCap: i7,
    I8_settled: opts.settled,
  };
  const pass = Object.values(invariants).every(Boolean);

  return {
    pass,
    uptimeBuckets,
    totalBuckets,
    invariants,
    sums: {
      heldBase,
      heldQuoteAtP,
      swapBaseIn,
      swapBaseOut,
      xferIn,
      xferOut,
      fromTreasury,
      roundTripVolume,
      grossVolume,
    },
  };
}
