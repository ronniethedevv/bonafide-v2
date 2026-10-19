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
  encodeUint,
} from "@mmr/merkle";

export const SLOTS = 16;

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
    if (k === "bandBps") continue;
    assertUint(v as bigint, BITS.U128);
  }
  if (!Number.isInteger(t.bandBps) || t.bandBps <= 0) {
    throw new Error("bandBps must be a positive integer");
  }
}

/**
 * Commitment over the 16-slot wallet vector with a fresh salt — the TS analog of
 * registration.compact's persistentCommit. (Uses the injected placeholder
 * hasher; production uses the Compact commitment primitive.)
 */
export function commitWallets(
  hasher: Hasher,
  vector: WalletVector,
  salt: Uint8Array,
): Digest {
  if (salt.length !== 32) throw new Error("salt must be 32 bytes");
  const parts: Uint8Array[] = vector.slots.map((s) => encodeUint(s, BITS.ADDR));
  parts.push(salt);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return hasher.hashLeaf(buf);
}
