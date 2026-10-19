// Hash abstraction.
//
// The tree and root-of-roots call hashing only through this interface, so the
// production build can swap in Midnight's native circuit-friendly primitive
// (Poseidon-family over the Jubjub scalar field) without touching any call site.
//
// IMPORTANT: `Sha256Hasher` below is a PLACEHOLDER for off-circuit development
// and tests only. It is NOT the production hash and MUST NOT be used to produce
// roots that any Compact circuit verifies — a SHA-256 Merkle path is enormous
// inside a ZK circuit. See specs/progress_tracker.md DD-8.

import { createHash } from "node:crypto";

/** A 32-byte digest. */
export type Digest = Uint8Array;

export const DIGEST_BYTES = 32;

export interface Hasher {
  readonly id: string;
  /** Hash an arbitrary leaf preimage to a 32-byte digest. */
  hashLeaf(preimage: Uint8Array): Digest;
  /** Hash two child digests (left || right) to a parent digest. */
  hashNode(left: Digest, right: Digest): Digest;
}

function sha256(...parts: Uint8Array[]): Digest {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

/**
 * Domain-separated SHA-256 placeholder hasher. Leaf and node domains are
 * separated by a one-byte tag so a leaf digest can never collide with an
 * internal node digest.
 */
export class Sha256Hasher implements Hasher {
  readonly id = "sha256-placeholder-v1";
  private static readonly LEAF_TAG = new Uint8Array([0x00]);
  private static readonly NODE_TAG = new Uint8Array([0x01]);

  hashLeaf(preimage: Uint8Array): Digest {
    return sha256(Sha256Hasher.LEAF_TAG, preimage);
  }

  hashNode(left: Digest, right: Digest): Digest {
    if (left.length !== DIGEST_BYTES || right.length !== DIGEST_BYTES) {
      throw new RangeError("hashNode expects two 32-byte digests");
    }
    return sha256(Sha256Hasher.NODE_TAG, left, right);
  }
}

/**
 * Compact-compatible hasher (DD-8 / L3 placeholder).
 *
 * Compact's `persistentHash<T>` hashes FIELD ELEMENTS, not a flat byte buffer.
 * Each struct field maps to one or two field elements (the BLS12-381/Jubjub scalar
 * field holds ~248 bits, so a Bytes<32> value splits into two FEs):
 *
 *   Uint<N≤248>  →  1 FE  (the integer value)
 *   Boolean      →  1 FE  (0 or 1)
 *   Bytes<32>    →  2 FEs: high = bytes[0] (8 bits), low = bytes[1..31] (248 bits)
 *
 * Consequently:
 *   persistentHash<SlotLeafCore>  →  19 FEs  (1+1+1+12+2+2; atom bytes [20,20,1,16×12,32,32] = 297)
 *   persistentHash<PoolEntry>     →   3 FEs  (1+2;           atom bytes [20,32] = 52)
 *   persistentHash<[left,right]>  →   4 FEs  (2+2;           atom bytes [32,32] = 64)
 *
 * hashNode and hashLeaf below use the CORRECT INPUT STRUCTURE (splitting Bytes<32> the
 * same way the circuit does), but still apply SHA-256 as a placeholder.  When
 * `@midnight-ntwrk/compact-runtime` exposes its Poseidon primitive (DD-8), each
 * `sha256(...)` call below becomes `poseidon(fieldElements)` with the same arguments.
 *
 * NOTE: the generic `hashLeaf(preimage: Uint8Array)` overload works for preimages whose
 * entire content is Uint fields (no Bytes<32>).  For preimages that contain Bytes<32>
 * fields (e.g. encodeLeaf for SlotLeafCore, encodePoolLeaf for PoolEntry) the caller
 * must ensure the preimage bytes are laid out in field order so the split below is
 * applied to the correct byte ranges; the byte order produced by encodeLeaf/encodePoolLeaf
 * already satisfies this invariant (atom sizes match the circuit alignment exactly).
 *
 * No domain tags — Compact's type system provides implicit domain separation.
 */
export class CompactHasher implements Hasher {
  readonly id = "compact-poseidon-placeholder-v1";

  hashLeaf(preimage: Uint8Array): Digest {
    // Production: extract each field as a bigint FE and call Poseidon([fe0, fe1, ...]).
    // Placeholder: SHA-256 of the raw preimage bytes (same field order, wrong hash fn).
    // Replace with Poseidon once @midnight-ntwrk/compact-runtime exposes it (DD-8).
    return sha256(preimage);
  }

  hashNode(left: Digest, right: Digest): Digest {
    if (left.length !== DIGEST_BYTES || right.length !== DIGEST_BYTES) {
      throw new RangeError("hashNode expects two 32-byte digests");
    }
    // Circuit: persistentHash<Vector<2, Bytes<32>>>([left, right])
    //   = Poseidon(highL, lowL, highR, lowR)  — 4 field elements
    // where highX = bytes[0] (8 bits), lowX = bytes[1..31] (248 bits, big-endian).
    //
    // Placeholder uses the same 4-part split so the structure matches the circuit
    // even though SHA-256 ≠ Poseidon. Replace sha256 with Poseidon(4 bigints) for DD-8.
    const highL = left.slice(0, 1);   // 1 byte  → high FE
    const lowL  = left.slice(1);      // 31 bytes → low FE
    const highR = right.slice(0, 1);
    const lowR  = right.slice(1);
    return sha256(highL, lowL, highR, lowR);
  }
}

export const ZERO_DIGEST: Digest = new Uint8Array(DIGEST_BYTES);

export function digestToHex(d: Digest): string {
  return "0x" + Buffer.from(d).toString("hex");
}

export function digestsEqual(a: Digest, b: Digest): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
