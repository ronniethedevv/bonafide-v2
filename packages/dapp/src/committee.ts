// @mmr/dapp — Attester committee generation.
//
// Reuses the same scheme as packages/contracts/test/harness.ts (attesterId):
//   attesterId(secret) = persistentHash<Vector<2, Bytes<32>>>([pad(32, "mmr:attester:v1"), secret])
//
// For the demo, we generate 3 deterministic secrets from a salt so the
// committee is reproducible across deploy + interact runs. The secrets are
// NEVER committed — they live only in the deploy process memory and in the
// gitignored contract-address output (which records only the ids, not secrets).

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
 * Generate `n` deterministic attester secrets from a base salt.
 * Salt byte 0 is set to 0xA1 + i so each secret is unique.
 */
export function generateAttesterSecrets(n: number, baseSalt = 0xa1): Uint8Array[] {
  return Array.from({ length: n }, (_, i) => {
    const s = new Uint8Array(32).fill(baseSalt + i);
    return s;
  });
}

/** The 2-of-3 demo committee: 3 secrets → 3 attester ids (Bytes<32>). */
export function buildCommittee(secrets: Uint8Array[]): Uint8Array[] {
  return secrets.map(attesterId);
}
