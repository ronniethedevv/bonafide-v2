// M1: bind the epoch circuit's round-trip witness to each wallet's flow_root (I7).
//
// The oracle computes I7 (round-trip cap) straight from clear per-wallet flow.
// The circuit takes flow as a private witness, so that witness must be PROVEN to
// be the flow committed in each wallet's flow_root — otherwise an MM could
// fabricate buy/sell volumes to dodge the cap. flow_root is a field of the slot
// leaf, which C1 binds to the epoch root-of-roots, so opening flow_root closes
// the hole.
//
// flow_root is the hash of the wallet's WHOLE dense series (48 windows, DD-14),
// not a tree of per-window leaves: opening only chosen windows would let a
// prover omit round-trip-heavy windows and pass the cap. The circuit witness for
// slot j is `opening.buy` / `opening.sell` (flowBuy[j], flowSell[j]); the
// circuit reconstructs the leaf from them (`verifyFlowOpening`), checks it equals
// leaves[j].flow_root, then aggregates per window across member slots as
// rt_w = min(Σ buy, Σ sell), gross_w = Σ buy + Σ sell. `roundTripFromOpenings`
// MUST match the oracle's round-trip / gross sums; the epoch_proof KAT feeds
// these openings through the compiled circuit. Hash with PoseidonHasher.

import {
  type AddressActivity,
  type FlowOpening,
  FLOW_WINDOWS,
  openFlow,
  verifyFlowOpening,
} from "@mmr/indexer";
import type { Digest, Hasher } from "@mmr/merkle";
import type { Engagement } from "./engagement.js";

export interface SlotFlowOpenings {
  readonly slot: number;
  readonly addr: bigint;
  /** The wallet's full dense (buy, sell) series, bound to its flow_root. */
  readonly opening: FlowOpening;
}

/**
 * Assemble, per active member slot, the wallet's full flow series. Member
 * selection mirrors the oracle: active slots whose wallet appears in the pool
 * this epoch. Inactive slots contribute no flow.
 */
export function assembleFlowOpenings(
  engagement: Engagement,
  activities: ReadonlyMap<bigint, AddressActivity>,
): SlotFlowOpenings[] {
  const out: SlotFlowOpenings[] = [];
  for (let slot = 0; slot < engagement.wallets.activeCount; slot++) {
    const addr = engagement.wallets.slots[slot]!;
    const activity = activities.get(addr);
    if (activity === undefined) continue; // non-membership: no flow to open
    out.push({ slot, addr, opening: openFlow(activity.flowWindows) });
  }
  return out;
}

/**
 * Verify every flow opening against the committed flow_root of its wallet.
 * `verifyFlowOpening` reconstructs the leaf from the opened (buy, sell) series,
 * so the values cannot be swapped for fabricated flow — the circuit's check.
 */
export function verifyFlowOpenings(
  commitHasher: Hasher,
  flowRootByAddr: ReadonlyMap<bigint, Digest>,
  openings: readonly SlotFlowOpenings[],
): boolean {
  for (const s of openings) {
    const flowRoot = flowRootByAddr.get(s.addr);
    if (flowRoot === undefined) return false;
    if (!verifyFlowOpening(commitHasher, flowRoot, s.opening)) return false;
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
 * rt_w = min(Σ buy, Σ sell), gross_w = Σ buy + Σ sell. Equals the oracle's
 * `sums.roundTripVolume` / `sums.grossVolume`.
 */
export function roundTripFromOpenings(openings: readonly SlotFlowOpenings[]): RoundTripTotals {
  let roundTripVolume = 0n;
  let grossVolume = 0n;
  for (let w = 0; w < FLOW_WINDOWS; w++) {
    let buy = 0n;
    let sell = 0n;
    for (const s of openings) {
      buy += s.opening.buy[w]!;
      sell += s.opening.sell[w]!;
    }
    roundTripVolume += buy < sell ? buy : sell;
    grossVolume += buy + sell;
  }
  return { roundTripVolume, grossVolume };
}

/** I7 cap: roundTrip * 1e6 <= ppm * gross (underflow-safe, matches the oracle). */
export function roundTripCapHolds(totals: RoundTripTotals, roundtripSharePpm: bigint): boolean {
  return totals.roundTripVolume * 1_000_000n <= roundtripSharePpm * totals.grossVolume;
}
