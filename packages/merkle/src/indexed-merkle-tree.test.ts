import { describe, it, expect } from "vitest";
import { Sha256Hasher, digestToHex } from "./hash.js";
import { type Leaf, encodeLeaf, emptyLeaf, zeroMetrics } from "./leaf.js";
import { IndexedMerkleTree, TREE_DEPTH } from "./indexed-merkle-tree.js";

const hasher = new Sha256Hasher();

function leafAt(addr: bigint, baseEnd = 0n): Leaf {
  return {
    addr,
    nextAddr: 0n, // overridden by the builder
    isProtocol: false,
    metrics: { ...zeroMetrics(), baseEnd },
    depthRoot: new Uint8Array(32),
    flowRoot: new Uint8Array(32),
  };
}

describe("leaf encoding", () => {
  it("has a fixed 297-byte canonical image", () => {
    expect(encodeLeaf(emptyLeaf()).length).toBe(297);
    expect(encodeLeaf(leafAt(0x1234n, 5n)).length).toBe(297);
  });
});

describe("IndexedMerkleTree", () => {
  const addrs = [0x30n, 0x10n, 0x20n, 0xffn];
  const tree = IndexedMerkleTree.build(hasher, addrs.map((a) => leafAt(a, a)));

  it("has every path of length TREE_DEPTH", () => {
    const p = tree.membershipProof(0x20n);
    expect(p.path.length).toBe(TREE_DEPTH);
  });

  it("verifies a membership proof", () => {
    const p = tree.membershipProof(0x20n);
    const leafDigest = hasher.hashLeaf(encodeLeaf(p.leaf));
    expect(
      IndexedMerkleTree.verifyPath(hasher, tree.root, leafDigest, p.path),
    ).toBe(true);
  });

  it("relinks nextAddr in ascending order", () => {
    // sentinel -> 0x10 -> 0x20 -> 0x30 -> 0xff -> tail(0)
    expect(tree.leaves[0]!.addr).toBe(0n);
    expect(tree.leaves[0]!.nextAddr).toBe(0x10n);
    expect(tree.leaves[1]!.nextAddr).toBe(0x20n);
    expect(tree.leaves[4]!.addr).toBe(0xffn);
    expect(tree.leaves[4]!.nextAddr).toBe(0n);
  });

  it("proves non-membership with a bracketing low leaf", () => {
    const p = tree.nonMembershipProof(0x25n);
    expect(p.lowLeaf.addr).toBe(0x20n);
    expect(p.lowLeaf.nextAddr).toBe(0x30n);
    const leafDigest = hasher.hashLeaf(encodeLeaf(p.lowLeaf));
    expect(
      IndexedMerkleTree.verifyPath(hasher, tree.root, leafDigest, p.path),
    ).toBe(true);
  });

  it("proves non-membership below the smallest address via the sentinel", () => {
    const p = tree.nonMembershipProof(0x05n);
    expect(p.lowLeaf.addr).toBe(0n);
    expect(p.lowLeaf.nextAddr).toBe(0x10n);
  });

  it("proves non-membership above the largest address via the tail", () => {
    const p = tree.nonMembershipProof(0x1000n);
    expect(p.lowLeaf.addr).toBe(0xffn);
    expect(p.lowLeaf.nextAddr).toBe(0n);
  });

  it("refuses non-membership of a present address", () => {
    expect(() => tree.nonMembershipProof(0x20n)).toThrow(/IS in the tree/);
  });

  it("rejects address 0 and duplicates", () => {
    expect(() => IndexedMerkleTree.build(hasher, [leafAt(0n)])).toThrow(
      /reserved/,
    );
    expect(() =>
      IndexedMerkleTree.build(hasher, [leafAt(0x1n), leafAt(0x1n)]),
    ).toThrow(/duplicate/);
  });

  it("is deterministic: independent builds, any order, same root", () => {
    const a = IndexedMerkleTree.build(hasher, addrs.map((x) => leafAt(x, x)));
    const b = IndexedMerkleTree.build(
      hasher,
      [...addrs].reverse().map((x) => leafAt(x, x)),
    );
    expect(digestToHex(a.root)).toBe(digestToHex(b.root));
  });

  it("changes the root when a metric changes", () => {
    const changed = IndexedMerkleTree.build(
      hasher,
      addrs.map((x) => leafAt(x, x === 0x20n ? 999n : x)),
    );
    expect(digestToHex(changed.root)).not.toBe(digestToHex(tree.root));
  });

  it("tampered sibling fails verification", () => {
    const p = tree.membershipProof(0x20n);
    const leafDigest = hasher.hashLeaf(encodeLeaf(p.leaf));
    const tampered = p.path.map((s, i) =>
      i === 0 ? { ...s, sibling: new Uint8Array(32).fill(7) } : s,
    );
    expect(
      IndexedMerkleTree.verifyPath(hasher, tree.root, leafDigest, tampered),
    ).toBe(false);
  });

  it("handles an empty set (sentinel only)", () => {
    const empty = IndexedMerkleTree.build(hasher, []);
    expect(empty.size).toBe(1);
    const p = empty.nonMembershipProof(0x42n);
    expect(p.lowLeaf.addr).toBe(0n);
    expect(p.lowLeaf.nextAddr).toBe(0n);
  });
});
