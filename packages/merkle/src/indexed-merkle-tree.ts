// Address-sorted indexed Merkle tree, depth 16 (65,536 leaves), one per pool.
//
// Leaves are sorted by address and linked by `nextAddr`, so a single Merkle
// path proves either membership (the leaf's own metrics) or non-membership
// (a "low leaf" L with L.addr < target < L.nextAddr proves the target address
// was inactive this epoch). A head sentinel at address 0 guarantees every
// target below the smallest real address still has a low leaf.
//
// The build is fully deterministic: given the same set of leaves it produces a
// byte-identical root (determinism is a hard invariant — anyone with an archive
// RPC must recompute it). `nextAddr` is DERIVED from sorted order here, not
// trusted from the caller.

import { type Digest, type Hasher, digestsEqual } from "./hash.js";
import { type Leaf, emptyLeaf, encodeLeaf, hashLeaf } from "./leaf.js";
import { assertUint, BITS, formatAddr } from "./uint.js";

export const TREE_DEPTH = 16;
export const TREE_CAPACITY = 1 << TREE_DEPTH; // 65,536

/** One step on a Merkle path: the sibling digest and whether *we* are the right child. */
export interface PathStep {
  sibling: Digest;
  weAreRight: boolean;
}

export interface MembershipProof {
  kind: "membership";
  leaf: Leaf;
  index: number;
  path: PathStep[];
}

export interface NonMembershipProof {
  kind: "non-membership";
  target: bigint;
  lowLeaf: Leaf;
  index: number;
  path: PathStep[];
}

export class IndexedMerkleTree {
  private readonly layers: Digest[][];
  private readonly zeros: Digest[];
  private readonly indexByAddr: Map<bigint, number>;

  private constructor(
    readonly hasher: Hasher,
    /** Leaves in tree order: index 0 is the head sentinel, then real leaves ascending. */
    readonly leaves: readonly Leaf[],
    layers: Digest[][],
    zeros: Digest[],
  ) {
    this.layers = layers;
    this.zeros = zeros;
    this.indexByAddr = new Map();
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i]!;
      if (i > 0) this.indexByAddr.set(leaf.addr, i);
    }
  }

  get root(): Digest {
    return this.layers[TREE_DEPTH]![0]!;
  }

  /** Number of populated leaves (head sentinel + real), excluding empty padding. */
  get size(): number {
    return this.leaves.length;
  }

  /**
   * Build a tree from a set of real leaves. Addresses must be unique and > 0
   * (address 0 is reserved for the head sentinel). `nextAddr` is recomputed from
   * sorted order; the caller's value is ignored.
   */
  static build(hasher: Hasher, realLeaves: readonly Leaf[]): IndexedMerkleTree {
    const sorted = [...realLeaves].sort((a, b) =>
      a.addr < b.addr ? -1 : a.addr > b.addr ? 1 : 0,
    );

    for (let i = 0; i < sorted.length; i++) {
      const addr = sorted[i]!.addr;
      assertUint(addr, BITS.ADDR);
      if (addr === 0n) {
        throw new Error("address 0 is reserved for the head sentinel");
      }
      if (i > 0 && sorted[i - 1]!.addr === addr) {
        throw new Error(`duplicate address ${formatAddr(addr)}`);
      }
    }

    const firstReal = sorted.length > 0 ? sorted[0]!.addr : 0n;
    const sentinel: Leaf = { ...emptyLeaf(), addr: 0n, nextAddr: firstReal };

    // Relink nextAddr deterministically from sorted order.
    const linked: Leaf[] = sorted.map((leaf, i) => ({
      ...leaf,
      nextAddr: i + 1 < sorted.length ? sorted[i + 1]!.addr : 0n,
    }));

    const ordered: Leaf[] = [sentinel, ...linked];
    if (ordered.length > TREE_CAPACITY) {
      throw new Error(
        `too many leaves: ${ordered.length} > capacity ${TREE_CAPACITY}`,
      );
    }

    // Zero-subtree digests for the empty suffix.
    const zeros: Digest[] = [hasher.hashLeaf(encodeLeaf(emptyLeaf()))];
    for (let l = 1; l <= TREE_DEPTH; l++) {
      zeros.push(hasher.hashNode(zeros[l - 1]!, zeros[l - 1]!));
    }

    // Dense prefix per level; everything beyond is a zero subtree.
    const layers: Digest[][] = [];
    layers[0] = ordered.map((leaf) => hashLeaf(hasher, leaf));
    for (let l = 0; l < TREE_DEPTH; l++) {
      const cur = layers[l]!;
      const next: Digest[] = [];
      for (let j = 0; j * 2 < cur.length; j++) {
        const left = cur[2 * j]!;
        const right = 2 * j + 1 < cur.length ? cur[2 * j + 1]! : zeros[l]!;
        next.push(hasher.hashNode(left, right));
      }
      layers[l + 1] = next.length > 0 ? next : [zeros[l + 1]!];
    }

    return new IndexedMerkleTree(hasher, ordered, layers, zeros);
  }

  private generatePath(index: number): PathStep[] {
    if (index < 0 || index >= this.leaves.length) {
      throw new RangeError(`leaf index ${index} out of range`);
    }
    const path: PathStep[] = [];
    let idx = index;
    for (let l = 0; l < TREE_DEPTH; l++) {
      const cur = this.layers[l]!;
      const weAreRight = (idx & 1) === 1;
      const sibIdx = weAreRight ? idx - 1 : idx + 1;
      const sibling = sibIdx < cur.length ? cur[sibIdx]! : this.zeros[l]!;
      path.push({ sibling, weAreRight });
      idx >>= 1;
    }
    return path;
  }

  has(addr: bigint): boolean {
    return this.indexByAddr.has(addr);
  }

  /** Prove that `addr` is present, returning its leaf and path. */
  membershipProof(addr: bigint): MembershipProof {
    const index = this.indexByAddr.get(addr);
    if (index === undefined) {
      throw new Error(`address ${formatAddr(addr)} is not in the tree`);
    }
    return {
      kind: "membership",
      leaf: this.leaves[index]!,
      index,
      path: this.generatePath(index),
    };
  }

  /**
   * Prove that `target` is NOT present by opening the low leaf L with
   * L.addr < target < L.nextAddr (or L.nextAddr === 0 for the list tail).
   */
  nonMembershipProof(target: bigint): NonMembershipProof {
    assertUint(target, BITS.ADDR);
    if (target === 0n) throw new Error("cannot prove non-membership of address 0");
    if (this.indexByAddr.has(target)) {
      throw new Error(
        `address ${formatAddr(target)} IS in the tree; non-membership impossible`,
      );
    }
    // Leaves are in ascending address order; linear-safe search for the low leaf.
    let lowIndex = 0;
    for (let i = 0; i < this.leaves.length; i++) {
      const leaf = this.leaves[i]!;
      if (leaf.addr < target) lowIndex = i;
      else break;
    }
    const lowLeaf = this.leaves[lowIndex]!;
    const ok =
      lowLeaf.addr < target &&
      (lowLeaf.nextAddr === 0n || target < lowLeaf.nextAddr);
    if (!ok) {
      throw new Error(
        `low leaf ${formatAddr(lowLeaf.addr)} does not bracket ${formatAddr(target)}`,
      );
    }
    return {
      kind: "non-membership",
      target,
      lowLeaf,
      index: lowIndex,
      path: this.generatePath(lowIndex),
    };
  }

  /** Verify a leaf digest against a root using a path. Pure; mirrors the circuit. */
  static verifyPath(
    hasher: Hasher,
    root: Digest,
    leafDigest: Digest,
    path: readonly PathStep[],
  ): boolean {
    let h = leafDigest;
    for (const step of path) {
      h = step.weAreRight
        ? hasher.hashNode(step.sibling, h)
        : hasher.hashNode(h, step.sibling);
    }
    return digestsEqual(h, root);
  }
}
