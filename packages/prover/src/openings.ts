// Witness opening assembly.
//
// For an engagement, assemble the Merkle openings the epoch circuit needs:
//   - per active slot: a membership proof (wallet is in the pool) OR a
//     non-membership proof (low leaf proving the wallet was inactive this epoch),
//   - the pool inclusion proof binding the pool tree root into the root-of-roots.
// Every opening chains slot leaf -> pool root -> root-of-roots, so the circuit
// never learns which pool the engagement used.

import {
  type Digest,
  type Hasher,
  type IndexedMerkleTree,
  type MembershipProof,
  type NonMembershipProof,
  type PoolInclusionProof,
  type RootOfRoots,
  hashLeaf,
  digestToHex,
} from "@mmr/merkle";
import { IndexedMerkleTree as IMT, RootOfRoots as ROR } from "@mmr/merkle";
import type { Engagement } from "./engagement.js";

export interface SlotOpening {
  slot: number;
  addr: bigint;
  active: boolean;
  /** true = membership (wallet present), false = non-membership (inactive). */
  membership: boolean;
  proof: MembershipProof | NonMembershipProof | null;
}

export interface WitnessBundle {
  engagementId: string;
  poolAddr: bigint;
  rootOfRootsHex: string;
  poolInclusion: PoolInclusionProof;
  slots: SlotOpening[];
}

export function assembleWitness(
  tree: IndexedMerkleTree,
  rootOfRoots: RootOfRoots,
  engagement: Engagement,
): WitnessBundle {
  const poolInclusion = rootOfRoots.poolProof(engagement.poolAddr);

  const slots: SlotOpening[] = engagement.wallets.slots.map((addr, slot) => {
    const active = engagement.wallets.bitmap[slot] === true;
    if (!active) {
      return { slot, addr, active: false, membership: false, proof: null };
    }
    if (tree.has(addr)) {
      return { slot, addr, active, membership: true, proof: tree.membershipProof(addr) };
    }
    return { slot, addr, active, membership: false, proof: tree.nonMembershipProof(addr) };
  });

  return {
    engagementId: engagement.id,
    poolAddr: engagement.poolAddr,
    rootOfRootsHex: rootOfRoots.rootHex(),
    poolInclusion,
    slots,
  };
}

/** Verify every opening in a bundle against the root-of-roots. */
export function verifyWitness(
  hasher: Hasher,
  rootOfRoots: RootOfRoots,
  bundle: WitnessBundle,
): boolean {
  if (!ROR.verifyPoolProof(hasher, rootOfRoots.root, bundle.poolInclusion)) {
    return false;
  }
  const poolRoot: Digest = bundle.poolInclusion.poolRoot;

  for (const s of bundle.slots) {
    if (!s.active) continue;
    if (s.proof === null) return false;

    if (s.membership) {
      const p = s.proof as MembershipProof;
      if (p.leaf.addr !== s.addr) return false;
      if (p.leaf.isProtocol) return false; // I2: a wallet is never a protocol contract
      const leafDigest = hashLeaf(hasher, p.leaf);
      if (!IMT.verifyPath(hasher, poolRoot, leafDigest, p.path)) return false;
    } else {
      const p = s.proof as NonMembershipProof;
      const low = p.lowLeaf;
      const brackets =
        low.addr < s.addr && (low.nextAddr === 0n || s.addr < low.nextAddr);
      if (!brackets) return false;
      const leafDigest = hashLeaf(hasher, low);
      if (!IMT.verifyPath(hasher, poolRoot, leafDigest, p.path)) return false;
    }
  }
  return true;
}

/** Stable debug summary (no private metrics) for logs/tests. */
export function witnessSummary(bundle: WitnessBundle): string {
  const active = bundle.slots.filter((s) => s.active);
  const members = active.filter((s) => s.membership).length;
  return `engagement ${bundle.engagementId}: ${active.length} active (${members} member, ${active.length - members} non-member), pool ${digestToHex(bundle.poolInclusion.poolRoot).slice(0, 10)}…`;
}
