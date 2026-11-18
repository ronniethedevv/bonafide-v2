// Turn an opened engagement file into what the capture code needs.

import { createHash } from "node:crypto";
import { hexToBytes, termsFromJson, type EngagementOpening } from "@mmr/engagement-file";
import { createEngagement, type Engagement } from "@mmr/prover";

/** The prover's Engagement for this opening (id = the registry id, e.g. rec_…). */
export function proverEngagement(o: EngagementOpening, registrationId: string): Engagement {
  return createEngagement({
    id: registrationId,
    poolAddr: BigInt(o.pool.address),
    wallets: o.wallets.map((w) => BigInt(w)),
    salt: hexToBytes(o.secrets.walletSalt, 32),
    terms: termsFromJson(o.terms),
  });
}

/**
 * Salt for the epoch-1 carry commitment, derived from the engagement secret so the whole
 * chain of witnesses can be rebuilt from the engagement file alone.
 */
export function genesisCarrySalt(o: EngagementOpening): Uint8Array {
  return new Uint8Array(
    createHash("sha256").update("mmr-carry-genesis-v1").update(hexToBytes(o.secrets.engagementSecret, 32)).digest(),
  );
}

/** The opening's commitments match what the server has on record for this engagement. */
export function matchesServer(o: EngagementOpening, server: { walletCommit: string | null; termsCommit: string | null }): boolean {
  return o.commitments.walletCommit === server.walletCommit && o.commitments.termsCommit === server.termsCommit;
}
