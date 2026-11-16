// Bond release schedule (M3b, DD-18): the reference the releaseEpoch circuit matches.
//
// A bond of B over an engagement of E epochs releases one tranche per settled epoch,
// to the bond's owner. After k released epochs the cumulative release is exactly
// floor(B · k / E), so tranches differ by at most 1, the last one carries the
// remainder, and the total is B: never more than was escrowed, nothing left behind.

/** Cumulative amount released once `releasedEpochs` of `epochsTotal` tranches are out. */
export function cumulativeRelease(bond: bigint, epochsTotal: number, releasedEpochs: number): bigint {
  if (bond < 0n) throw new Error("bond must be >= 0");
  if (!Number.isInteger(epochsTotal) || epochsTotal < 1) throw new Error("epochsTotal must be an integer >= 1");
  if (!Number.isInteger(releasedEpochs) || releasedEpochs < 0 || releasedEpochs > epochsTotal) {
    throw new Error("releasedEpochs must be an integer in [0, epochsTotal]");
  }
  return (bond * BigInt(releasedEpochs)) / BigInt(epochsTotal);
}

/** The exact tranche releaseEpoch accepts when `releasedEpochs` tranches are already out. */
export function nextTranche(bond: bigint, epochsTotal: number, releasedEpochs: number): bigint {
  return cumulativeRelease(bond, epochsTotal, releasedEpochs + 1) - cumulativeRelease(bond, epochsTotal, releasedEpochs);
}
