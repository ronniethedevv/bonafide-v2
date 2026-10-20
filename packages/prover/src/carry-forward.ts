// M2: I5 carry-forward — the cumulative outflow cap across epochs.
//
// Per-epoch I5 caps outflow within one epoch, but D is a LIFETIME budget: an MM
// must not be able to spend D every epoch. INVARIANTS.md I5 requires the running
// totals to carry forward as a salted commitment checked against the previous
// epoch. Each epoch opens the previous cumulative commitment, adds this epoch's
// transfer sums, checks the cumulative cap, and commits the new totals for the
// next epoch.
//
// Cumulative cap (same loan exclusion as the per-epoch check):
//   Σ_epochs xfer_out + Σ from_treasury  <=  Σ xfer_in + D
// Internal wallet-to-wallet moves already cancel inside each epoch's sums (they
// appear in both xfer_out and xfer_in), so they never consume D here.
//
// This module is the off-chain reference the epoch circuit mirrors: open the
// prior commitment, fold in this epoch, check the cap, re-commit. Laptop work
// wires the same three steps into epoch_proof.compact.

import { type Digest, type Hasher, encodeUintLE, digestsEqual } from "@mmr/merkle";

// Cumulative over many epochs; each epoch sum is Uint<128>, so 192 bits holds
// 2^64 epochs' worth of headroom. Encoded little-endian to match the Compact
// serialization the circuit would commit (see engagement.ts commit helpers).
const CARRY_BITS = 192;

export interface CarryTotals {
  readonly xferIn: bigint;
  readonly xferOut: bigint;
  readonly fromTreasury: bigint;
}

export const ZERO_CARRY: CarryTotals = { xferIn: 0n, xferOut: 0n, fromTreasury: 0n };

/** One epoch's transfer sums over the committed members (oracle `verdict.sums`). */
export interface EpochTransferSums {
  readonly xferIn: bigint;
  readonly xferOut: bigint;
  readonly fromTreasury: bigint;
}

export function addEpoch(prev: CarryTotals, epoch: EpochTransferSums): CarryTotals {
  return {
    xferIn: prev.xferIn + epoch.xferIn,
    xferOut: prev.xferOut + epoch.xferOut,
    fromTreasury: prev.fromTreasury + epoch.fromTreasury,
  };
}

/** Cumulative I5: xfer_out + from_treasury <= xfer_in + D (underflow-safe). */
export function cumulativeI5Holds(totals: CarryTotals, disposalD: bigint): boolean {
  return totals.xferOut + totals.fromTreasury <= totals.xferIn + disposalD;
}

function encodeTotals(t: CarryTotals): Uint8Array {
  const parts = [
    encodeUintLE(t.xferIn, CARRY_BITS),
    encodeUintLE(t.xferOut, CARRY_BITS),
    encodeUintLE(t.fromTreasury, CARRY_BITS),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Salted commitment to the running totals — the same scheme as the wallet / terms
 * commitments: hashLeaf(salt ‖ little-endian totals). Salted because the totals
 * are low-entropy and the commitment is public on the ledger.
 */
export function carryCommit(hasher: Hasher, totals: CarryTotals, salt: Uint8Array): Digest {
  if (salt.length !== 32) throw new Error("salt must be 32 bytes");
  const image = encodeTotals(totals);
  const buf = new Uint8Array(salt.length + image.length);
  buf.set(salt, 0);
  buf.set(image, salt.length);
  return hasher.hashLeaf(buf);
}

export function verifyCarryCommit(
  hasher: Hasher,
  commitment: Digest,
  totals: CarryTotals,
  salt: Uint8Array,
): boolean {
  return digestsEqual(commitment, carryCommit(hasher, totals, salt));
}

/** Genesis commitment for a fresh engagement: zero totals under a fresh salt. */
export function genesisCarry(hasher: Hasher, salt: Uint8Array): Digest {
  return carryCommit(hasher, ZERO_CARRY, salt);
}

export interface CarryStep {
  /** The previous epoch's committed totals (on the ledger). */
  readonly prevCommitment: Digest;
  /** The previous totals, opened privately with prevSalt. */
  readonly prevTotals: CarryTotals;
  readonly prevSalt: Uint8Array;
  /** This epoch's member transfer sums. */
  readonly epochSums: EpochTransferSums;
  /** Fresh salt for the new commitment. */
  readonly newSalt: Uint8Array;
  readonly disposalD: bigint;
}

export interface CarryStepResult {
  /** chained && capHolds — the epoch's carry-forward step is valid. */
  readonly ok: boolean;
  /** prevCommitment opens to (prevTotals, prevSalt): the chain links. */
  readonly chained: boolean;
  /** The cumulative cap still holds after adding this epoch. */
  readonly capHolds: boolean;
  readonly newTotals: CarryTotals;
  readonly newCommitment: Digest;
}

/**
 * One epoch's carry-forward transition — the TS mirror of the circuit step:
 * verify the prior commitment opens to prevTotals, add this epoch, check the
 * cumulative cap, and commit the new totals for the next epoch's ledger.
 */
export function carryStep(hasher: Hasher, step: CarryStep): CarryStepResult {
  const chained = verifyCarryCommit(hasher, step.prevCommitment, step.prevTotals, step.prevSalt);
  const newTotals = addEpoch(step.prevTotals, step.epochSums);
  const capHolds = cumulativeI5Holds(newTotals, step.disposalD);
  const newCommitment = carryCommit(hasher, newTotals, step.newSalt);
  return { ok: chained && capHolds, chained, capHolds, newTotals, newCommitment };
}
