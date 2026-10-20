// M1 (TS half): bind the epoch circuit's round-trip witness to each wallet's
// flow_root (I7).
//
// The oracle computes I7 (round-trip cap) straight from clear per-wallet flow.
// The circuit takes flow as a private witness, so that witness must be PROVEN to
// be the flow committed in each wallet's flow_root — otherwise an MM could
// fabricate buy/sell volumes to dodge the cap. flow_root is a field of the slot
// leaf, which C1 binds to the epoch root-of-roots, so opening each window against
// flow_root closes the hole.
//
// This assembles, per active member slot, a Merkle opening of every window the
// wallet participated in, verifies them, and reproduces the round-trip verdict
// from the bound values. The circuit mirrors it: reconstruct the window leaf from
// the witness (buy, sell) (verifyWindowOpening already does this), verify the
// path to flow_root, then aggregate per window across slots as
// rt_w = min(Σ buy, Σ sell). `roundTripFromOpenings` MUST match the oracle's
// round-trip / gross sums; the laptop KAT reuses these openings as its witness.

import {
  type AddressActivity,
  type WindowOpening,
  openWindow,
  verifyWindowOpening,
} from "@mmr/indexer";
import type { Digest, Hasher } from "@mmr/merkle";
import type { Engagement } from "./engagement.js";

export interface SlotFlowOpenings {
  readonly slot: number;
  readonly addr: bigint;
  /** One opening per window this wallet participated in, bound to its flow_root. */
  readonly windows: readonly WindowOpening[];
}

/**
 * Assemble, per active member slot, a window opening for every window the wallet
 * recorded flow in. Member selection mirrors the oracle: active slots whose
 * wallet appears in the pool this epoch. Inactive slots contribute no flow.
 */
export function assembleFlowOpenings(
  commitHasher: Hasher,
  engagement: Engagement,
  activities: ReadonlyMap<bigint, AddressActivity>,
): SlotFlowOpenings[] {
  const out: SlotFlowOpenings[] = [];
  for (let slot = 0; slot < engagement.wallets.activeCount; slot++) {
    const addr = engagement.wallets.slots[slot]!;
    const activity = activities.get(addr);
    if (activity === undefined) continue; // non-membership: no flow to open

    const windows = activity.flowWindows.map((w) =>
      openWindow(commitHasher, activity.flowWindows, w.window),
    );
    out.push({ slot, addr, windows });
  }
  return out;
}

/**
 * Verify every window opening against the committed flow_root of its wallet.
 * `verifyWindowOpening` reconstructs the window leaf from the opened (buy, sell)
 * before checking the path, so the opened values cannot be swapped for fabricated
 * flow — the same check the circuit makes.
 */
export function verifyFlowOpenings(
  commitHasher: Hasher,
  flowRootByAddr: ReadonlyMap<bigint, Digest>,
  openings: readonly SlotFlowOpenings[],
): boolean {
  for (const s of openings) {
    const flowRoot = flowRootByAddr.get(s.addr);
    if (flowRoot === undefined) return false;
    for (const w of s.windows) {
      if (!verifyWindowOpening(commitHasher, flowRoot, w)) return false;
    }
  }
  return true;
}

export interface RoundTripTotals {
  readonly roundTripVolume: bigint;
  readonly grossVolume: bigint;
}

/**
 * Round-trip and gross volume from the BOUND flow openings — the circuit's I7,
 * computed over witness data proven to match flow_root. Per window:
 * rt_w = min(Σ buy, Σ sell), gross_w = Σ (buy + sell). Equals the oracle's
 * `sums.roundTripVolume` / `sums.grossVolume`.
 */
export function roundTripFromOpenings(openings: readonly SlotFlowOpenings[]): RoundTripTotals {
  const buys = new Map<number, bigint>();
  const sells = new Map<number, bigint>();
  for (const s of openings) {
    for (const w of s.windows) {
      buys.set(w.window, (buys.get(w.window) ?? 0n) + w.buy);
      sells.set(w.window, (sells.get(w.window) ?? 0n) + w.sell);
    }
  }
  let roundTripVolume = 0n;
  let grossVolume = 0n;
  for (const [window, buy] of buys) {
    const sell = sells.get(window) ?? 0n;
    roundTripVolume += buy < sell ? buy : sell;
    grossVolume += buy + sell;
  }
  for (const [window, sell] of sells) {
    if (!buys.has(window)) grossVolume += sell;
  }
  return { roundTripVolume, grossVolume };
}

/** I7 cap: roundTrip * 1e6 <= ppm * gross (underflow-safe, matches the oracle). */
export function roundTripCapHolds(totals: RoundTripTotals, roundtripSharePpm: bigint): boolean {
  return totals.roundTripVolume * 1_000_000n <= roundtripSharePpm * totals.grossVolume;
}
