// Engagement model: the MM's private commitment inputs for one engagement.
//
// The committed wallet vector is 16 slots: active wallets sorted ascending in the
// low slots, zero-padded above (matching epoch_proof.compact's I1 check, which
// permits trailing zero dummies). The vector is committed with a fresh salt; the
// chain only ever sees the commitment, never the wallets (privacy model).

import {
  type Digest,
  type Hasher,
  assertUint,
  BITS,
  encodeUintLE,
} from "@mmr/merkle";

export const SLOTS = 16;
/** Longest contract the claim circuit can verify (its epoch loop is unrolled to this). */
export const MAX_EPOCHS = 90;

export interface EngagementTerms {
  /** Floor price P (option strike for loans, agreed floor for retainers). Uint128. */
  floorPriceP: bigint;
  /** Loan amount L0. */
  loanL0: bigint;
  /** Quote already in the set at start, Q0. */
  quoteStartQ0: bigint;
  /** Allowed disposal / outflow cap D. */
  disposalD: bigint;
  /** Net-selling cap S. */
  netSellS: bigint;
  /** Depth target delta* (per side, summed across wallets). */
  depthTarget: bigint;
  /** Round-trip share cap, parts-per-million of gross volume. */
  roundtripSharePpm: bigint;
  /** Contracted depth band in bps (must be one of the indexer's configured bands). */
  bandBps: number;
  /**
   * I6 pass threshold: an epoch's uptime passes when at least this many buckets
   * met the depth target (a bucket count, DD-12 A1). Uint64.
   */
  minUptimeBuckets: number;
  /** Committed contract length in epochs, 1..MAX_EPOCHS: the claim's denominator (DD-12 B1). Uint64. */
  epochsTotal: number;
  /** DD-38: the engagement's pool (Uint<160>); proofs open only this pool's tree. */
  pool: bigint;
}

export interface WalletVector {
  /** Exactly 16 slots: active sorted ascending, then 0n padding. */
  readonly slots: readonly bigint[];
  readonly activeCount: number;
  /** slot i active? */
  readonly bitmap: readonly boolean[];
}

export interface Engagement {
  /** Random engagement id (hex); unlinkable to the MM until claimed. */
  readonly id: string;
  readonly poolAddr: bigint;
  readonly wallets: WalletVector;
  readonly salt: Uint8Array;
  readonly terms: EngagementTerms;
}

export function buildWalletVector(wallets: readonly bigint[]): WalletVector {
  if (wallets.length > SLOTS) {
    throw new Error(`too many wallets: ${wallets.length} > ${SLOTS}`);
  }
  const sorted = [...wallets].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i]!;
    assertUint(w, BITS.ADDR);
    if (w === 0n) throw new Error("wallet 0 is not allowed (reserved)");
    if (i > 0 && sorted[i - 1] === w) throw new Error("duplicate wallet");
  }
  const slots: bigint[] = new Array(SLOTS).fill(0n);
  const bitmap: boolean[] = new Array(SLOTS).fill(false);
  for (let i = 0; i < sorted.length; i++) {
    slots[i] = sorted[i]!;
    bitmap[i] = true;
  }
  return { slots, activeCount: sorted.length, bitmap };
}

export function createEngagement(args: {
  id: string;
  poolAddr: bigint;
  wallets: readonly bigint[];
  salt: Uint8Array;
  terms: EngagementTerms;
}): Engagement {
  assertUint(args.poolAddr, BITS.ADDR);
  if (args.salt.length !== 32) throw new Error("salt must be 32 bytes");
  assertTerms(args.terms);
  return {
    id: args.id,
    poolAddr: args.poolAddr,
    wallets: buildWalletVector(args.wallets),
    salt: args.salt,
    terms: args.terms,
  };
}

export function assertTerms(t: EngagementTerms): void {
  for (const [k, v] of Object.entries(t)) {
    if (k === "bandBps" || k === "minUptimeBuckets" || k === "epochsTotal" || k === "pool") continue;
    assertUint(v as bigint, BITS.U128);
  }
  assertUint(t.pool, BITS.ADDR);
  if (t.pool === 0n) throw new Error("pool must be set");
  if (!Number.isInteger(t.bandBps) || t.bandBps <= 0) {
    throw new Error("bandBps must be a positive integer");
  }
  if (!Number.isInteger(t.minUptimeBuckets) || t.minUptimeBuckets < 0) {
    throw new Error("minUptimeBuckets must be a non-negative integer");
  }
  if (!Number.isInteger(t.epochsTotal) || t.epochsTotal < 1 || t.epochsTotal > MAX_EPOCHS) {
    throw new Error(`epochsTotal must be an integer in [1, ${MAX_EPOCHS}]`);
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return buf;
}

// Compact's persistentCommit<T>(v, r) = SHA-256(r || serialize(v)), with the
// same serialization as persistentHash (Uints little-endian). With
// CompactHasher, hashLeaf(salt || image) reproduces it byte-for-byte (KAT in
// packages/contracts/test). Other hashers give a TS-only analog.
function commit(hasher: Hasher, image: Uint8Array, salt: Uint8Array): Digest {
  if (salt.length !== 32) throw new Error("salt must be 32 bytes");
  return hasher.hashLeaf(concat([salt, image]));
}

/**
 * Commitment over the 16-slot wallet vector with a fresh salt: registration's
 * walletCommit, persistentCommit<Vector<16, Uint<160>>>(slots, salt).
 */
export function commitWallets(
  hasher: Hasher,
  vector: WalletVector,
  salt: Uint8Array,
): Digest {
  return commit(hasher, concat(vector.slots.map((s) => encodeUintLE(s, BITS.ADDR))), salt);
}

/**
 * Commitment over the deal terms: registration's termsCommit,
 * persistentCommit<Terms>(terms, termsSalt). Field order and widths are the
 * circuit `Terms` struct: P, ppm, band, minUptimeBuckets and epochsTotal are
 * Uint<64>; pool is Uint<160> (DD-38); the rest Uint<128>.
 */
export function commitTerms(
  hasher: Hasher,
  t: EngagementTerms,
  termsSalt: Uint8Array,
): Digest {
  const image = concat([
    encodeUintLE(t.floorPriceP, 64),
    encodeUintLE(t.loanL0, BITS.U128),
    encodeUintLE(t.quoteStartQ0, BITS.U128),
    encodeUintLE(t.disposalD, BITS.U128),
    encodeUintLE(t.netSellS, BITS.U128),
    encodeUintLE(t.depthTarget, BITS.U128),
    encodeUintLE(t.roundtripSharePpm, 64),
    encodeUintLE(BigInt(t.bandBps), 64),
    encodeUintLE(BigInt(t.minUptimeBuckets), 64),
    encodeUintLE(BigInt(t.epochsTotal), 64),
    encodeUintLE(t.pool, BITS.ADDR),
  ]);
  return commit(hasher, image, termsSalt);
}
