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

export const ZERO_DIGEST: Digest = new Uint8Array(DIGEST_BYTES);

export function digestToHex(d: Digest): string {
  return "0x" + Buffer.from(d).toString("hex");
}

export function digestsEqual(a: Digest, b: Digest): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
