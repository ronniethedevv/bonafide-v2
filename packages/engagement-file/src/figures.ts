// One epoch's figures, as the MM's agent seals them to the client. Derived from the
// captured witness: what the client is entitled to see about each day.

export interface EpochFigures {
  v: 1;
  epoch: number;
  /** The real block range and times this epoch covers. */
  range: { startBlock: number; endBlock: number; startTs: number; endTs: number };
  /** Half-hour buckets where the MM's depth met the target, of totalBuckets. */
  bucketsAtTarget: number;
  totalBuckets: number;
  /** Share of the MM's volume that round-tripped, in percent (rounded). */
  roundTripPct: number;
  checks: {
    uptime: boolean; // I6
    roundTrip: boolean; // I7
    custody: boolean; // I3
    netSelling: boolean; // I4
    outflow: boolean; // I5 (incl. cumulative)
  };
  /** All KPI checks met (settlement aside). */
  met: boolean;
}

export function isEpochFigures(x: unknown): x is EpochFigures {
  const f = x as EpochFigures;
  return (
    !!f && f.v === 1 && Number.isInteger(f.epoch) && f.epoch >= 1 && f.epoch <= 90 &&
    Number.isInteger(f.bucketsAtTarget) && Number.isInteger(f.totalBuckets) &&
    typeof f.roundTripPct === "number" && typeof f.met === "boolean" && !!f.checks && !!f.range
  );
}
