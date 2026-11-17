// What the client sees about one epoch, derived from the captured witness.

import type { EpochFigures } from "@mmr/engagement-file";
import type { EpochWitness } from "@mmr/witness";

export function figuresFromWitness(w: EpochWitness): EpochFigures {
  const inv = w.invariants;
  const gross = w.sums.grossVolume;
  const rt = w.sums.roundTripVolume;
  const roundTripPct = gross === 0n ? 0 : Math.round((Number(rt) / Number(gross)) * 100);
  const checks = {
    uptime: inv.I6_uptime,
    roundTrip: inv.I7_roundTripCap,
    custody: inv.I3_custodyFloor,
    netSelling: inv.I4_netSellingCap,
    outflow: inv.I5_outflowCap && w.carry.capHolds,
  };
  return {
    v: 1,
    epoch: w.epoch,
    range: { startBlock: w.range.startBlock, endBlock: w.range.endBlock, startTs: w.range.startTs, endTs: w.range.endTs },
    bucketsAtTarget: w.uptimeBuckets,
    totalBuckets: w.totalBuckets,
    roundTripPct,
    checks,
    met: Object.entries(inv).every(([k, v]) => k === "I8_settled" || v === true),
  };
}
