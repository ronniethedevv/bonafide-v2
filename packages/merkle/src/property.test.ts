// Property-based tests over the real merkle code (no mocks). fast-check generates
// many random inputs and checks invariants hold for all of them — stronger than
// the hand-picked example tests.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { encodeUint, decodeUint, assertUint } from "./uint.js";
import { Sha256Hasher, digestToHex } from "./hash.js";
import { IndexedMerkleTree } from "./indexed-merkle-tree.js";
import { zeroMetrics, encodeLeaf, type Leaf } from "./leaf.js";

const hasher = new Sha256Hasher();
const MASK128 = (1n << 128n) - 1n;

// Generators
const u128 = fc.bigInt({ min: 0n, max: MASK128 });
const addr = fc.bigInt({ min: 1n, max: (1n << 160n) - 1n });

function leafOf(a: bigint, baseEnd: bigint): Leaf {
  return {
    addr: a,
    nextAddr: 0n,
    isProtocol: false,
    metrics: { ...zeroMetrics(), baseEnd },
    depthRoot: new Uint8Array(32),
    flowRoot: new Uint8Array(32),
  };
}

describe("uint encoding — properties", () => {
  it("round-trips any in-range value at fixed width", () => {
    fc.assert(
      fc.property(u128, (v) => {
        const bytes = encodeUint(v, 128);
        expect(bytes.length).toBe(16);
        expect(decodeUint(bytes)).toBe(v);
      }),
    );
  });

  it("rejects every out-of-range value (never wraps)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n << 128n, max: (1n << 160n) - 1n }), (v) => {
        expect(() => assertUint(v, 128)).toThrow();
      }),
    );
  });
});

describe("indexed merkle tree — properties", () => {
  // A set of distinct positive addresses.
  const addrSet = fc
    .uniqueArray(addr, { minLength: 1, maxLength: 40 })
    .map((as) => as.slice());

  it("is order-independent: any permutation yields the same root", () => {
    fc.assert(
      fc.property(addrSet, (addrs) => {
        const a = IndexedMerkleTree.build(hasher, addrs.map((x) => leafOf(x, x & MASK128)));
        const shuffled = [...addrs].reverse();
        const b = IndexedMerkleTree.build(hasher, shuffled.map((x) => leafOf(x, x & MASK128)));
        expect(digestToHex(a.root)).toBe(digestToHex(b.root));
      }),
    );
  });

  it("every member verifies; a random non-member proves non-membership", () => {
    fc.assert(
      fc.property(addrSet, fc.bigInt({ min: 1n, max: (1n << 160n) - 1n }), (addrs, probe) => {
        const tree = IndexedMerkleTree.build(hasher, addrs.map((x) => leafOf(x, x & MASK128)));
        // membership for a real member
        const member = addrs[0]!;
        const mp = tree.membershipProof(member);
        const md = hasher.hashLeaf(encodeLeaf(mp.leaf));
        expect(IndexedMerkleTree.verifyPath(hasher, tree.root, md, mp.path)).toBe(true);
        // non-membership only when the probe isn't in the set
        if (!addrs.includes(probe)) {
          const nm = tree.nonMembershipProof(probe);
          const nd = hasher.hashLeaf(encodeLeaf(nm.lowLeaf));
          expect(IndexedMerkleTree.verifyPath(hasher, tree.root, nd, nm.path)).toBe(true);
          expect(nm.lowLeaf.addr < probe).toBe(true);
          expect(nm.lowLeaf.nextAddr === 0n || probe < nm.lowLeaf.nextAddr).toBe(true);
        }
      }),
    );
  });

  it("changing one metric changes the root", () => {
    fc.assert(
      fc.property(addrSet, (addrs) => {
        const base = IndexedMerkleTree.build(hasher, addrs.map((x) => leafOf(x, 0n)));
        const bumped = IndexedMerkleTree.build(
          hasher,
          addrs.map((x, i) => leafOf(x, i === 0 ? 1n : 0n)),
        );
        expect(digestToHex(base.root)).not.toBe(digestToHex(bumped.root));
      }),
    );
  });
});
