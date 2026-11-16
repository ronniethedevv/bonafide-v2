// Attester committee (I8, DD-26: Option B).
//
// Each member holds a secret; the contract's committee is the three attesterIds fixed at
// deploy. To attest an epoch, every online member submits its own publishRoot(epoch,
// rootOfRoots, cid) transaction, authenticated in-circuit by proving knowledge of its
// secret (I9: ownPublicKey() is prover-chosen, so it cannot authenticate). The contract
// counts distinct members and publishes the root at the threshold — there is no
// off-chain signature aggregation or counting. Submitting the transaction is injected
// (`submit`): the compiled circuit in the contracts KAT, a wallet/dapp in a live deploy.

import { createHash } from "node:crypto";
import type { AttesterCommittee, AttesterVote } from "@mmr/indexer";

/** Domain tag of attesterId, as pad(32, "mmr:attester:v1") in the contract. */
export const ATTESTER_ID_TAG = "mmr:attester:v1";

/**
 * attesterId(secret) = persistentHash<Vector<2, Bytes<32>>>([pad(32, tag), secret]),
 * i.e. SHA-256 over the 64-byte concatenation (checked against the runtime in the
 * contracts KAT).
 */
export function attesterId(secret: Uint8Array): Uint8Array {
  if (secret.length !== 32) throw new Error("attester secret must be 32 bytes");
  const tag = new Uint8Array(32);
  tag.set(new TextEncoder().encode(ATTESTER_ID_TAG));
  return new Uint8Array(createHash("sha256").update(tag).update(secret).digest());
}

/** A cid as the contract's Bytes<64> (UTF-8, zero-padded). */
export function cidBytes(cid: string): Uint8Array {
  const raw = new TextEncoder().encode(cid);
  if (raw.length > 64) throw new Error(`cid longer than 64 bytes: ${cid}`);
  const out = new Uint8Array(64);
  out.set(raw);
  return out;
}

const toHex = (b: Uint8Array): string => `0x${Buffer.from(b).toString("hex")}`;
const fromHex = (h: string): Uint8Array => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (!/^[0-9a-fA-F]{64}$/.test(s)) throw new Error(`root must be 32-byte hex: ${h}`);
  return new Uint8Array(Buffer.from(s, "hex"));
};

/** One member's publishRoot transaction. */
export interface PublishRootTx {
  readonly secret: Uint8Array;
  readonly epoch: bigint;
  readonly rootOfRoots: Uint8Array;
  readonly cid: Uint8Array;
}

export interface CommitteeConfig {
  /** Member secrets, in committee order (3 in v1). */
  readonly secrets: readonly Uint8Array[];
  /** Votes the contract needs (2 of 3 in v1); informational — the contract enforces it. */
  readonly threshold: number;
  /** Submits one member's publishRoot transaction. */
  readonly submit: (tx: PublishRootTx) => Promise<void>;
  /** Indices of members currently online; default all. Lets tests simulate outages. */
  readonly online?: readonly number[];
}

export class AttesterCommitteeMembers implements AttesterCommittee {
  readonly threshold: number;
  readonly size: number;
  /** attesterId of each member: the constructor argument of the deployed contract. */
  readonly memberIds: readonly Uint8Array[];
  private readonly cfg: CommitteeConfig;

  constructor(cfg: CommitteeConfig) {
    if (cfg.threshold < 1 || cfg.threshold > cfg.secrets.length) {
      throw new Error("threshold must be between 1 and committee size");
    }
    this.memberIds = cfg.secrets.map(attesterId);
    if (new Set(this.memberIds.map(toHex)).size !== this.memberIds.length) {
      throw new Error("committee members must be distinct");
    }
    for (const i of cfg.online ?? []) {
      if (!Number.isInteger(i) || i < 0 || i >= cfg.secrets.length) throw new Error(`no member ${i}`);
    }
    this.cfg = cfg;
    this.threshold = cfg.threshold;
    this.size = cfg.secrets.length;
  }

  /** Every online member submits publishRoot, in committee order; returns the votes cast. */
  async publishRoot(epoch: number, rootOfRootsHex: string, cid: string): Promise<AttesterVote[]> {
    const online = this.cfg.online ?? this.cfg.secrets.map((_, i) => i);
    const rootOfRoots = fromHex(rootOfRootsHex);
    const cidB = cidBytes(cid);
    const votes: AttesterVote[] = [];
    for (const i of [...online].sort((a, b) => a - b)) {
      await this.cfg.submit({ secret: this.cfg.secrets[i]!, epoch: BigInt(epoch), rootOfRoots, cid: cidB });
      votes.push({ attester: toHex(this.memberIds[i]!) });
    }
    return votes;
  }
}
