// Mock attester committee.
//
// Implements the indexer's AttesterCommittee interface with DETERMINISTIC,
// placeholder signatures (a domain-separated hash), so the full settlement loop
// is exercisable end to end in tests. The production committee signs
// (epoch, root_of_roots, cid) with Jubjub Schnorr keys — that belongs behind this
// same interface and needs the Midnight crypto stack (not available here).

import { Sha256Hasher, digestToHex } from "@mmr/merkle";
import type { AttesterCommittee, AttesterSignature } from "@mmr/indexer";

const hasher = new Sha256Hasher();

function deterministicSignature(
  attester: string,
  epoch: number,
  rootOfRootsHex: string,
  cid: string,
): string {
  const preimage = new TextEncoder().encode(
    `attest|${attester}|${epoch}|${rootOfRootsHex}|${cid}`,
  );
  return digestToHex(hasher.hashLeaf(preimage));
}

export interface MockAttesterConfig {
  /** All attester ids in the committee. */
  attesters: readonly string[];
  /** Required signatures (2 of 3 in v1). */
  threshold: number;
  /** Subset currently online; defaults to all. Lets tests simulate outages. */
  online?: readonly string[];
}

export class MockAttesterCommittee implements AttesterCommittee {
  readonly threshold: number;
  readonly size: number;
  private readonly online: readonly string[];

  constructor(cfg: MockAttesterConfig) {
    if (cfg.threshold < 1 || cfg.threshold > cfg.attesters.length) {
      throw new Error("threshold must be between 1 and committee size");
    }
    this.online = cfg.online ?? cfg.attesters;
    this.threshold = cfg.threshold;
    this.size = cfg.attesters.length;
  }

  async sign(epoch: number, rootOfRootsHex: string, cid: string): Promise<AttesterSignature[]> {
    return this.online.map((attester) => ({
      attester,
      signature: deterministicSignature(attester, epoch, rootOfRootsHex, cid),
    }));
  }

  /** Count valid, distinct signatures from known committee members. */
  static countValid(
    signatures: readonly AttesterSignature[],
    knownAttesters: readonly string[],
    epoch: number,
    rootOfRootsHex: string,
    cid: string,
  ): number {
    const known = new Set(knownAttesters);
    const seen = new Set<string>();
    let valid = 0;
    for (const s of signatures) {
      if (!known.has(s.attester) || seen.has(s.attester)) continue;
      if (s.signature === deterministicSignature(s.attester, epoch, rootOfRootsHex, cid)) {
        seen.add(s.attester);
        valid++;
      }
    }
    return valid;
  }
}
