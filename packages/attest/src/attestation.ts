// Portable epoch attestation — a typed, revocable, time-stamped claim about one
// epoch's root-of-roots, modelled on EAS (schema id + stable uid + revocation).
//
// It is the artifact a client carries into their own tooling: it names exactly what
// was attested (chain, epoch, block range, end hash, root-of-roots), by whom (the
// attester set), over what SCOPE (coverage), and until when (expiry / revoked). The
// companion verifier (./verify.ts) re-derives the root from the published tree and
// rejects anything whose uid, root, revocation, or expiry doesn't check out — so a
// client never has to trust our UI or our word.

import { createHash } from "node:crypto";

/** Schema id — bump the version when the attestation body shape changes. */
export const ATTESTATION_SCHEMA = "mmr.epoch.v1";

/** The committee that signed the root (e.g. 2-of-3). */
export interface AttesterSet {
  /** Opaque id of the attester set / committee. */
  readonly id: string;
  /** Signatures required (e.g. 2). */
  readonly threshold: number;
  /** Committee size (e.g. 3). */
  readonly size: number;
}

/**
 * What the record does and does NOT cover — the honest scope statement. The reputation
 * is built from on-chain DEX activity on the named chains; it is NOT a complete trading
 * history, and the set of public engagements is chosen by the market maker, so absence
 * of an engagement is not evidence of good behaviour (the cherry-pick caveat).
 */
export interface Coverage {
  /** Chain ids indexed for this attestation (e.g. [8453] or [1]). */
  readonly chains: readonly number[];
  /** DEX venues covered (e.g. ["uniswap-v3"]). */
  readonly venues: readonly string[];
  /** Fixed scope marker for v1. */
  readonly scope: "self-selected-public-engagements";
  /** Human-readable caveat, surfaced to clients. */
  readonly note: string;
}

export const DEFAULT_COVERAGE_NOTE =
  "Built from on-chain DEX activity on the named chains. Not a complete trading history; " +
  "off-chain/CEX venues are out of scope. The set of public engagements is selected by the " +
  "market maker, so the absence of an engagement is not evidence of good conduct.";

export interface EpochAttestation {
  readonly schema: string;
  /** Deterministic id = keccak-free sha256 over the canonical body (see attestationUid). */
  readonly uid: string;
  readonly chainId: number;
  readonly epoch: number;
  readonly startBlock: number;
  readonly endBlock: number;
  readonly endBlockHash: string;
  readonly rootOfRootsHex: string;
  readonly pools: ReadonlyArray<{ readonly poolAddr: string; readonly rootHex: string; readonly leafCount: number }>;
  readonly attesterSet: AttesterSet;
  readonly coverage: Coverage;
  /** ISO 8601 instant the epoch was attested. */
  readonly attestedAt: string;
  /** ISO 8601 instant after which the attestation should be treated as invalid; null = no expiry. */
  readonly expiresAt: string | null;
  /** Explicit revocation flag (EAS-style); a revoked attestation never verifies. */
  readonly revoked: boolean;
}

/** The fields of an epoch manifest this module needs (structural; see @mmr/indexer EpochManifest). */
export interface AttestableEpoch {
  readonly chainId: number;
  readonly epoch: number;
  readonly startBlock: number;
  readonly endBlock: number;
  readonly endBlockHash: string;
  readonly rootOfRootsHex: string;
  readonly baseTokens: readonly string[];
  readonly pools: ReadonlyArray<{ readonly poolAddr: string; readonly rootHex: string; readonly leafCount: number }>;
}

export interface BuildAttestationOptions {
  readonly attesterSet: AttesterSet;
  /** ISO instant; defaults to now. */
  readonly attestedAt?: string;
  /** ISO instant, or a validity window in days (expiresAt = attestedAt + days). */
  readonly expiresAt?: string | null;
  readonly validityDays?: number;
  readonly venues?: readonly string[];
  readonly coverageNote?: string;
}

/** Canonical body for the uid: every field except `uid` itself, in a fixed key order. */
function canonicalBody(a: Omit<EpochAttestation, "uid">): string {
  // JSON.stringify preserves insertion order for string keys; build with a fixed order.
  return JSON.stringify({
    schema: a.schema,
    chainId: a.chainId,
    epoch: a.epoch,
    startBlock: a.startBlock,
    endBlock: a.endBlock,
    endBlockHash: a.endBlockHash,
    rootOfRootsHex: a.rootOfRootsHex,
    pools: a.pools.map((p) => ({ poolAddr: p.poolAddr, rootHex: p.rootHex, leafCount: p.leafCount })),
    attesterSet: { id: a.attesterSet.id, threshold: a.attesterSet.threshold, size: a.attesterSet.size },
    coverage: {
      chains: [...a.coverage.chains],
      venues: [...a.coverage.venues],
      scope: a.coverage.scope,
      note: a.coverage.note,
    },
    attestedAt: a.attestedAt,
    expiresAt: a.expiresAt,
    revoked: a.revoked,
  });
}

/** Deterministic uid over the canonical body (revocation/expiry included, so a change re-ids). */
export function attestationUid(a: Omit<EpochAttestation, "uid">): string {
  return "0x" + createHash("sha256").update(canonicalBody(a)).digest("hex");
}

export function buildAttestation(epoch: AttestableEpoch, opts: BuildAttestationOptions): EpochAttestation {
  const attestedAt = opts.attestedAt ?? new Date().toISOString();
  let expiresAt: string | null;
  if (opts.expiresAt !== undefined) {
    expiresAt = opts.expiresAt;
  } else if (opts.validityDays !== undefined) {
    expiresAt = new Date(Date.parse(attestedAt) + opts.validityDays * 86_400_000).toISOString();
  } else {
    expiresAt = null;
  }
  const body: Omit<EpochAttestation, "uid"> = {
    schema: ATTESTATION_SCHEMA,
    chainId: epoch.chainId,
    epoch: epoch.epoch,
    startBlock: epoch.startBlock,
    endBlock: epoch.endBlock,
    endBlockHash: epoch.endBlockHash,
    rootOfRootsHex: epoch.rootOfRootsHex,
    pools: epoch.pools.map((p) => ({ poolAddr: p.poolAddr, rootHex: p.rootHex, leafCount: p.leafCount })),
    attesterSet: opts.attesterSet,
    coverage: {
      chains: [epoch.chainId],
      venues: opts.venues ?? ["uniswap-v3"],
      scope: "self-selected-public-engagements",
      note: opts.coverageNote ?? DEFAULT_COVERAGE_NOTE,
    },
    attestedAt,
    expiresAt,
    revoked: false,
  };
  return { ...body, uid: attestationUid(body) };
}

/** Return a revoked copy (re-ids: a revoked attestation has a different uid than the live one). */
export function revokeAttestation(a: EpochAttestation): EpochAttestation {
  const { uid: _uid, ...body } = a;
  const revokedBody = { ...body, revoked: true };
  return { ...revokedBody, uid: attestationUid(revokedBody) };
}
