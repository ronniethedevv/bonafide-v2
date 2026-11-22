// @mmr/dapp — Attester committee generation.
//
// Reuses the same scheme as packages/contracts/test/harness.ts (attesterId):
//   attesterId(secret) = persistentHash<Vector<2, Bytes<32>>>([pad(32, "mmr:attester:v1"), secret])
//
// The secrets are derived from the deploy seed, so they are never stored: only the
// ids reach the chain and the gitignored deploy record.

import { createHash } from "node:crypto";
import * as rt from "@midnight-ntwrk/compact-runtime";

/** Domain-separation tag for attester id derivation (same as harness.ts). */
const ATTESTER_TAG = new Uint8Array(32);
ATTESTER_TAG.set(new TextEncoder().encode("mmr:attester:v1"));

/** attesterId(secret) — identical to harness.ts. */
export function attesterId(secret: Uint8Array): Uint8Array {
  return rt.persistentHash(
    new rt.CompactTypeVector(2, new rt.CompactTypeBytes(32)),
    [ATTESTER_TAG, secret],
  );
}

/**
 * The three attester secrets of the demo committee, derived from the deploy seed:
 * sha256("mmr:attester:secret:v1" || masterSeed || i). Reproducible across the
 * deploy and the call scripts, and as secret as the seed itself. In production each
 * attester holds its own key; here one operator runs all three.
 */
export function deriveAttesterSecrets(masterSeed: Uint8Array, n = 3): Uint8Array[] {
  return Array.from({ length: n }, (_, i) =>
    Uint8Array.from(
      createHash("sha256").update("mmr:attester:secret:v1").update(masterSeed).update(Uint8Array.of(i)).digest(),
    ),
  );
}

/** The 2-of-3 demo committee: 3 secrets → 3 attester ids (Bytes<32>). */
export function buildCommittee(secrets: Uint8Array[]): Uint8Array[] {
  return secrets.map(attesterId);
}

/** A 32-byte secret for `label`, derived from the deploy seed (never stored). */
export function deriveSecret(masterSeed: Uint8Array, label: string): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(`mmr:${label}:v1`).update(masterSeed).digest());
}
