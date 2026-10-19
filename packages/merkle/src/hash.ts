// Hash abstraction.
//
// The tree and root-of-roots call hashing only through this interface, so the
// production build can swap in Midnight's native circuit-friendly primitive
// (Poseidon-family over the Jubjub scalar field) without touching any call site.
//
// IMPORTANT: `Sha256Hasher` below is for off-circuit development and tests only.
// Its domain tags make its roots differ from the circuit's, so it MUST NOT be
// used to produce roots that any Compact circuit verifies; use `CompactHasher`.
// See specs/progress_tracker.md DD-8.

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
 * Compact-compatible hasher: byte-exact with the epoch circuit's hashing.
 *
 * Compact's `persistentHash<T>(v)` (compact-runtime 0.16.0, compiler 0.31.1) is
 * SHA-256 over the byte serialization of `v`, with no domain tag:
 *
 *   Uint<N>    →  ceil(N/8) bytes, LITTLE-endian
 *   Boolean    →  1 byte (0 or 1)
 *   Bytes<K>   →  K raw bytes
 *   struct / Vector  →  fields / elements concatenated in declaration order
 *
 * (Verified empirically against `@midnight-ntwrk/compact-runtime`; the KAT in
 * packages/contracts/test runs the compiled proveEpoch over roots built here.)
 *
 * So, with the little-endian images from `encodeLeaf` / `encodePoolLeaf`:
 *   persistentHash<SlotLeafCore>(L)          = sha256(encodeLeaf(L))      (297 bytes)
 *   persistentHash<PoolEntry>(e)             = sha256(encodePoolLeaf(e))  (52 bytes)
 *   persistentHash<Vector<2,Bytes<32>>>(l,r) = sha256(l || r)             (64 bytes)
 *
 * DD-8 note: persistentHash is SHA-256 by definition, so this class is not a
 * placeholder for it. Moving the circuit to the cheaper Poseidon-based
 * `transientHash` (returns a Field, not Bytes<32>) would be a circuit change,
 * and this class would change with it.
 *
 * Domain separation: leaf and node preimages differ in length (297 / 52 vs 64
 * bytes), so a leaf digest cannot be confused with an internal node digest.
 */
export class CompactHasher implements Hasher {
  readonly id = "compact-persistent-hash-v1";

  hashLeaf(preimage: Uint8Array): Digest {
    return sha256(preimage);
  }

  hashNode(left: Digest, right: Digest): Digest {
    if (left.length !== DIGEST_BYTES || right.length !== DIGEST_BYTES) {
      throw new RangeError("hashNode expects two 32-byte digests");
    }
    return sha256(left, right);
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
