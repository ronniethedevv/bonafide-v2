// Epoch root-of-roots.
//
// One Merkle commitment per epoch over every indexed Base pool's tree root
// (pools above the liquidity floor). An engagement proves facts against the
// root-of-roots and opens only its own pool's subtree, so the epoch root never
// reveals which pool belongs to the engagement.
//
// Pools are sorted by address and the tree is balanced (padded to a power of
// two with zero leaves), so the build is deterministic.

import {
  type Digest,
  type Hasher,
  digestToHex,
  digestsEqual,
} from "./hash.js";
import { assertUint, BITS, encodeUint, formatAddr } from "./uint.js";
import type { PathStep } from "./indexed-merkle-tree.js";

export interface PoolEntry {
  /** Pool contract address. Uint<160>. */
  poolAddr: bigint;
  /** Root of that pool's indexed Merkle tree for this epoch. */
  poolRoot: Digest;
}

export interface PoolInclusionProof {
  poolAddr: bigint;
  poolRoot: Digest;
  index: number;
  path: PathStep[];
}

function encodePoolLeaf(entry: PoolEntry): Uint8Array {
  assertUint(entry.poolAddr, BITS.ADDR);
  if (entry.poolRoot.length !== 32) {
    throw new RangeError("poolRoot must be 32 bytes");
  }
  const addr = encodeUint(entry.poolAddr, BITS.ADDR);
  const out = new Uint8Array(addr.length + 32);
  out.set(addr, 0);
  out.set(entry.poolRoot, addr.length);
  return out;
}

/**
 * Fixed pool-tree depth for circuit compatibility (DD-8 / C1).
 *
 * The epoch circuit's `poolPath` witness is `Vector<POOL_TREE_DEPTH, PathStep>`,
 * so this tree must always produce paths of exactly this length.  Supports up to
 * 2^POOL_TREE_DEPTH = 1024 pools.
 */
export const POOL_TREE_DEPTH = 10;

export class RootOfRoots {
  private readonly layers: Digest[][];
  private readonly indexByPool: Map<bigint, number>;

  private constructor(
    readonly hasher: Hasher,
    readonly epoch: number,
    readonly entries: readonly PoolEntry[],
    readonly depth: number,
    layers: Digest[][],
  ) {
    this.layers = layers;
    this.indexByPool = new Map();
    entries.forEach((e, i) => this.indexByPool.set(e.poolAddr, i));
  }

  get root(): Digest {
    return this.layers[this.depth]![0]!;
  }

  static build(
    hasher: Hasher,
    epoch: number,
    pools: readonly PoolEntry[],
  ): RootOfRoots {
    const sorted = [...pools].sort((a, b) =>
      a.poolAddr < b.poolAddr ? -1 : a.poolAddr > b.poolAddr ? 1 : 0,
    );
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.poolAddr === sorted[i - 1]!.poolAddr) {
        throw new Error(`duplicate pool ${formatAddr(sorted[i]!.poolAddr)}`);
      }
    }

    if (sorted.length > 1 << POOL_TREE_DEPTH) {
      throw new Error(
        `too many pools: ${sorted.length} > capacity ${1 << POOL_TREE_DEPTH}`,
      );
    }
    const depth = POOL_TREE_DEPTH;
    const width = 1 << depth; // always 1024

    const zeroLeaf = hasher.hashLeaf(new Uint8Array(BITS.ADDR / 8 + 32));
    const leaves: Digest[] = new Array(width);
    for (let i = 0; i < width; i++) {
      leaves[i] = i < sorted.length ? hasher.hashLeaf(encodePoolLeaf(sorted[i]!)) : zeroLeaf;
    }

    const layers: Digest[][] = [leaves];
    for (let l = 0; l < depth; l++) {
      const cur = layers[l]!;
      const next: Digest[] = [];
      for (let j = 0; j < cur.length; j += 2) {
        next.push(hasher.hashNode(cur[j]!, cur[j + 1]!));
      }
      layers.push(next);
    }

    return new RootOfRoots(hasher, epoch, sorted, depth, layers);
  }

  /** Prove a pool's root is included in this epoch's root-of-roots. */
  poolProof(poolAddr: bigint): PoolInclusionProof {
    const index = this.indexByPool.get(poolAddr);
    if (index === undefined) {
      throw new Error(`pool ${formatAddr(poolAddr)} not in epoch ${this.epoch}`);
    }
    const path: PathStep[] = [];
    let idx = index;
    for (let l = 0; l < this.depth; l++) {
      const cur = this.layers[l]!;
      const weAreRight = (idx & 1) === 1;
      const sibIdx = weAreRight ? idx - 1 : idx + 1;
      path.push({ sibling: cur[sibIdx]!, weAreRight });
      idx >>= 1;
    }
    return {
      poolAddr,
      poolRoot: this.entries[index]!.poolRoot,
      index,
      path,
    };
  }

  static verifyPoolProof(
    hasher: Hasher,
    root: Digest,
    proof: PoolInclusionProof,
  ): boolean {
    let h = hasher.hashLeaf(
      encodePoolLeaf({ poolAddr: proof.poolAddr, poolRoot: proof.poolRoot }),
    );
    for (const step of proof.path) {
      h = step.weAreRight
        ? hasher.hashNode(step.sibling, h)
        : hasher.hashNode(h, step.sibling);
    }
    return digestsEqual(h, root);
  }

  /** Stable, published identifier for this epoch's root (goes to IPFS record). */
  rootHex(): string {
    return digestToHex(this.root);
  }
}
