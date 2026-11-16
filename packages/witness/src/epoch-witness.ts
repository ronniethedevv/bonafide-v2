// Per-epoch witness capture.
//
// For one epoch, the MM captures their PRIVATE witness: the I1-I8 verdict over the
// committed engagement + their own wallets' activity, and the carry-forward step that
// chains the lifetime transfer budget (M2) from the previous epoch's committed totals.
// The on-chain index is public; what is private is WHICH wallets are the MM's and the
// deal terms — both live in the committed Engagement. This module combines the two into
// the record the MM stores locally and later proves against (epoch_proof / claim).

import type { AddressActivity, EpochRange, IndexerConfig } from "@mmr/indexer";
import type { Digest, Hasher } from "@mmr/merkle";
import {
  evaluateEpoch,
  carryStep,
  genesisCarry,
  ZERO_CARRY,
  type Engagement,
  type EpochVerdict,
  type InvariantResults,
  type CarryTotals,
} from "@mmr/prover";

/** The committed carry-forward state at an epoch boundary (previous epoch's ledger). */
export interface CarryState {
  /** The committed totals' digest (what the ledger holds). */
  readonly commitment: Digest;
  /** The totals it opens to (private). */
  readonly totals: CarryTotals;
  /** The salt the commitment was made under (private). */
  readonly salt: Uint8Array;
}

export interface EpochWitnessRange {
  readonly startBlock: number;
  readonly endBlock: number;
  readonly startTs: number;
  readonly endTs: number;
  readonly endBlockHash: string;
}

/** The MM's private per-epoch witness — the unit the local store persists. */
export interface EpochWitness {
  readonly engagementId: string;
  /** 1-based epoch within the engagement's contracted range. */
  readonly epoch: number;
  readonly range: EpochWitnessRange;
  /** I8: the epoch root was settled (>=2/3 attesters + challenge window passed). */
  readonly settled: boolean;
  /** The epoch verdict (all invariants hold and uptime met the threshold). */
  readonly pass: boolean;
  readonly uptimeBuckets: number;
  readonly totalBuckets: number;
  readonly invariants: InvariantResults;
  readonly sums: EpochVerdict["sums"];
  /** Committed member wallets that were active in the pool this epoch. */
  readonly members: bigint[];
  /** The carry-forward step for this epoch (lifetime budget chaining). */
  readonly carry: {
    readonly prevTotals: CarryTotals;
    readonly newTotals: CarryTotals;
    readonly newCommitment: Digest;
    readonly newSalt: Uint8Array;
    /** chained to the prior commitment AND the cumulative cap still holds. */
    readonly ok: boolean;
    readonly capHolds: boolean;
  };
  /** ISO instant the witness was captured. */
  readonly capturedAt: string;
}

/** The carry state for a brand-new engagement: zero totals under a fresh salt. */
export function genesisCarryState(hasher: Hasher, salt: Uint8Array): CarryState {
  return { commitment: genesisCarry(hasher, salt), totals: ZERO_CARRY, salt };
}

/** The carry state to feed the NEXT epoch's capture, taken from a captured witness. */
export function carryStateFromWitness(w: EpochWitness): CarryState {
  return { commitment: w.carry.newCommitment, totals: w.carry.newTotals, salt: w.carry.newSalt };
}

/** The committed member wallets active in `activities` (oracle's member selection). */
export function activeMembers(
  engagement: Engagement,
  activities: ReadonlyMap<bigint, AddressActivity>,
): bigint[] {
  const members: bigint[] = [];
  for (let slot = 0; slot < engagement.wallets.activeCount; slot++) {
    const addr = engagement.wallets.slots[slot]!;
    if (activities.has(addr)) members.push(addr);
  }
  return members;
}

export interface CaptureEpochArgs {
  readonly hasher: Hasher;
  readonly engagement: Engagement;
  /** This epoch's per-address activity from the indexer (keyed by address). */
  readonly activities: ReadonlyMap<bigint, AddressActivity>;
  readonly config: IndexerConfig;
  readonly range: EpochRange;
  readonly settled: boolean;
  /** The previous epoch's carry state, or genesisCarryState for epoch 1. */
  readonly prevCarry: CarryState;
  /** Fresh 32-byte salt for this epoch's new carry commitment. */
  readonly newSalt: Uint8Array;
  readonly capturedAt?: string;
}

/** Capture one epoch's private witness: run the oracle and chain the carry-forward. */
export function captureEpochWitness(args: CaptureEpochArgs): EpochWitness {
  const { hasher, engagement, activities, config, range, settled, prevCarry, newSalt } = args;
  const verdict = evaluateEpoch(engagement, activities, config, range, { settled });
  const step = carryStep(hasher, {
    prevCommitment: prevCarry.commitment,
    prevTotals: prevCarry.totals,
    prevSalt: prevCarry.salt,
    epochSums: {
      xferIn: verdict.sums.xferIn,
      xferOut: verdict.sums.xferOut,
      fromTreasury: verdict.sums.fromTreasury,
    },
    newSalt,
    disposalD: engagement.terms.disposalD,
  });
  return {
    engagementId: engagement.id,
    epoch: range.epoch,
    range: {
      startBlock: range.startBlock,
      endBlock: range.endBlock,
      startTs: range.startTs,
      endTs: range.endTs,
      endBlockHash: range.endBlockHash,
    },
    settled,
    pass: verdict.pass,
    uptimeBuckets: verdict.uptimeBuckets,
    totalBuckets: verdict.totalBuckets,
    invariants: verdict.invariants,
    sums: verdict.sums,
    members: activeMembers(engagement, activities),
    carry: {
      prevTotals: prevCarry.totals,
      newTotals: step.newTotals,
      newCommitment: step.newCommitment,
      newSalt,
      ok: step.ok,
      capHolds: step.capHolds,
    },
    capturedAt: args.capturedAt ?? new Date().toISOString(),
  };
}
