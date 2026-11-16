// Client-side verification kit. A client runs this against an attestation they were
// given plus the published pool tree(s) (fetched from IPFS by CID) and gets a verdict
// with no trust in us: the uid must match the body, the root-of-roots must recompute
// from the published tree (via the independent watcher), and the attestation must not
// be revoked or expired. Freshness is reported separately — a stale-but-valid record
// is still valid, just old.

import type { Hasher } from "@mmr/merkle";
import { parseAddr } from "@mmr/merkle";
import { verifyEpoch } from "@mmr/watcher";
import { attestationUid, type EpochAttestation } from "./attestation.js";

export type Freshness = "fresh" | "ageing" | "stale";

export interface FreshnessPolicy {
  /** Younger than this many days → "fresh". */
  readonly freshDays: number;
  /** Younger than this many days → "ageing"; at or beyond → "stale". */
  readonly ageingDays: number;
}

export const DEFAULT_FRESHNESS: FreshnessPolicy = { freshDays: 30, ageingDays: 90 };

export function freshnessOf(
  attestedAt: string,
  now: number = Date.now(),
  policy: FreshnessPolicy = DEFAULT_FRESHNESS,
): Freshness {
  const ageDays = (now - Date.parse(attestedAt)) / 86_400_000;
  if (ageDays < policy.freshDays) return "fresh";
  if (ageDays < policy.ageingDays) return "ageing";
  return "stale";
}

export function isExpired(a: EpochAttestation, now: number = Date.now()): boolean {
  return a.expiresAt !== null && now > Date.parse(a.expiresAt);
}

export interface VerifyResult {
  /** True only if the attestation is structurally sound, root-verified, not revoked, not expired. */
  readonly ok: boolean;
  /** The uid recomputed from the body matches the stated uid (no tampering). */
  readonly uidValid: boolean;
  /** The root-of-roots recomputes from the published tree(s). */
  readonly rootVerified: boolean;
  readonly revoked: boolean;
  readonly expired: boolean;
  /** Reported regardless of ok — a valid record can still be stale. */
  readonly freshness: Freshness;
  readonly recomputedRootOfRootsHex: string;
  /** Pools whose published tree didn't recompute to its stored root. */
  readonly mismatchedPools: readonly string[];
  /** Why ok is false (empty when ok). */
  readonly reasons: readonly string[];
}

/**
 * Verify an attestation against the published tree(s). `publishedTrees` maps each
 * pool address (as the attestation lists it) to that pool's published tree bytes.
 */
export function verifyAttestation(
  hasher: Hasher,
  attestation: EpochAttestation,
  publishedTrees: ReadonlyMap<string, Uint8Array>,
  now: number = Date.now(),
  policy: FreshnessPolicy = DEFAULT_FRESHNESS,
): VerifyResult {
  const reasons: string[] = [];

  const { uid, ...body } = attestation;
  const uidValid = attestationUid(body) === uid;
  if (!uidValid) reasons.push("uid does not match the attestation body (tampered)");

  const revoked = attestation.revoked;
  if (revoked) reasons.push("attestation is revoked");

  const expired = isExpired(attestation, now);
  if (expired) reasons.push(`attestation expired at ${attestation.expiresAt}`);

  const trees = new Map<bigint, Uint8Array>();
  for (const [addr, bytes] of publishedTrees) trees.set(parseAddr(addr), bytes);
  const rec = verifyEpoch(hasher, attestation.epoch, trees, attestation.rootOfRootsHex);
  if (!rec.ok) {
    reasons.push(
      rec.mismatchedPools.length > 0
        ? `published tree(s) do not recompute to their root: ${rec.mismatchedPools.join(", ")}`
        : `recomputed root-of-roots ${rec.recomputedRootOfRootsHex} != attested ${attestation.rootOfRootsHex}`,
    );
  }

  const freshness = freshnessOf(attestation.attestedAt, now, policy);

  return {
    ok: uidValid && rec.ok && !revoked && !expired,
    uidValid,
    rootVerified: rec.ok,
    revoked,
    expired,
    freshness,
    recomputedRootOfRootsHex: rec.recomputedRootOfRootsHex,
    mismatchedPools: rec.mismatchedPools,
    reasons,
  };
}
