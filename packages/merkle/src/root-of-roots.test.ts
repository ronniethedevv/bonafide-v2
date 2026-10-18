import { describe, it, expect } from "vitest";
import { Sha256Hasher, digestToHex } from "./hash.js";
import { zeroMetrics, type Leaf } from "./leaf.js";
import { IndexedMerkleTree } from "./indexed-merkle-tree.js";
import { RootOfRoots, type PoolEntry } from "./root-of-roots.js";

const hasher = new Sha256Hasher();

function leafAt(addr: bigint): Leaf {
  return {
    addr,
    nextAddr: 0n,
    isProtocol: false,
    metrics: zeroMetrics(),
    depthRoot: new Uint8Array(32),
    flowRoot: new Uint8Array(32),
  };
}

function poolTreeRoot(addrs: bigint[]): Uint8Array {
  return IndexedMerkleTree.build(hasher, addrs.map(leafAt)).root;
}

describe("RootOfRoots", () => {
  const pools: PoolEntry[] = [
    { poolAddr: 0xaaa0n, poolRoot: poolTreeRoot([0x1n, 0x2n]) },
    { poolAddr: 0xbbb0n, poolRoot: poolTreeRoot([0x3n]) },
    { poolAddr: 0xccc0n, poolRoot: poolTreeRoot([0x4n, 0x5n, 0x6n]) },
    { poolAddr: 0xddd0n, poolRoot: poolTreeRoot([0x7n]) },
    { poolAddr: 0xeee0n, poolRoot: poolTreeRoot([0x8n]) },
  ];
  const ror = RootOfRoots.build(hasher, 42, pools);

  it("verifies a pool inclusion proof", () => {
    for (const p of pools) {
      const proof = ror.poolProof(p.poolAddr);
      expect(RootOfRoots.verifyPoolProof(hasher, ror.root, proof)).toBe(true);
    }
  });

  it("rejects a proof against the wrong root", () => {
    const proof = ror.poolProof(0xccc0n);
    const other = RootOfRoots.build(hasher, 43, pools.slice(0, 3));
    expect(RootOfRoots.verifyPoolProof(hasher, other.root, proof)).toBe(false);
  });

  it("is deterministic regardless of input order", () => {
    const a = RootOfRoots.build(hasher, 42, pools);
    const b = RootOfRoots.build(hasher, 42, [...pools].reverse());
    expect(a.rootHex()).toBe(b.rootHex());
  });

  it("changes the root when a pool root changes", () => {
    const mutated = pools.map((p, i) =>
      i === 2 ? { ...p, poolRoot: poolTreeRoot([0x4n, 0x5n, 0x99n]) } : p,
    );
    const changed = RootOfRoots.build(hasher, 42, mutated);
    expect(changed.rootHex()).not.toBe(ror.rootHex());
  });

  it("rejects duplicate pools", () => {
    expect(() =>
      RootOfRoots.build(hasher, 1, [pools[0]!, pools[0]!]),
    ).toThrow(/duplicate/);
  });

  it("handles a single pool", () => {
    const single = RootOfRoots.build(hasher, 1, [pools[0]!]);
    const proof = single.poolProof(0xaaa0n);
    expect(RootOfRoots.verifyPoolProof(hasher, single.root, proof)).toBe(true);
    expect(digestToHex(single.root).length).toBe(66);
  });
});
