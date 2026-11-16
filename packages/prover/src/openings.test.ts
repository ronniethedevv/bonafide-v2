import { describe, it, expect } from "vitest";
import {
  Sha256Hasher,
  IndexedMerkleTree,
  RootOfRoots,
  zeroMetrics,
  type Leaf,
  type PoolEntry,
} from "@mmr/merkle";
import { createEngagement, type EngagementTerms } from "./engagement.js";
import { assembleWitness, verifyWitness } from "./openings.js";

const hasher = new Sha256Hasher();

function leaf(addr: bigint, isProtocol = false): Leaf {
  return {
    addr,
    nextAddr: 0n,
    isProtocol,
    metrics: zeroMetrics(),
    depthRoot: new Uint8Array(32),
    flowRoot: new Uint8Array(32),
  };
}

const POOL = 0xabcdn;
const OTHER_POOL = 0xbeefn;

// Pool tree: wallets 0x10, 0x20, 0x40 active; a protocol contract at 0x30.
const tree = IndexedMerkleTree.build(hasher, [
  leaf(0x10n),
  leaf(0x20n),
  leaf(0x30n, true),
  leaf(0x40n),
]);
const otherTree = IndexedMerkleTree.build(hasher, [leaf(0x99n)]);

const pools: PoolEntry[] = [
  { poolAddr: POOL, poolRoot: tree.root },
  { poolAddr: OTHER_POOL, poolRoot: otherTree.root },
];
const ror = RootOfRoots.build(hasher, 1, pools);

const terms: EngagementTerms = {
  floorPriceP: 1n,
  loanL0: 0n,
  quoteStartQ0: 0n,
  disposalD: 0n,
  netSellS: 0n,
  depthTarget: 0n,
  roundtripSharePpm: 0n,
  bandBps: 100,
  minUptimeBuckets: 48, // every bucket (DEFAULT_CONFIG: 48 per epoch)
  epochsTotal: 30,
};

const salt = new Uint8Array(32).fill(9);

describe("witness assembly", () => {
  it("assembles and verifies membership + non-membership slots", () => {
    // 0x10, 0x40 are in the pool; 0x25 is not (non-membership).
    const eng = createEngagement({
      id: "e1",
      poolAddr: POOL,
      wallets: [0x10n, 0x40n, 0x25n],
      salt,
      terms,
    });
    const bundle = assembleWitness(tree, ror, eng);
    expect(verifyWitness(hasher, ror, bundle)).toBe(true);

    const active = bundle.slots.filter((s) => s.active);
    expect(active.length).toBe(3);
    expect(active.filter((s) => s.membership).length).toBe(2);
    const nonMember = active.find((s) => !s.membership)!;
    expect(nonMember.addr).toBe(0x25n);
  });

  it("fails verification against a different root-of-roots", () => {
    const eng = createEngagement({ id: "e2", poolAddr: POOL, wallets: [0x10n], salt, terms });
    const bundle = assembleWitness(tree, ror, eng);
    const otherRor = RootOfRoots.build(hasher, 2, [pools[1]!]);
    expect(verifyWitness(hasher, otherRor, bundle)).toBe(false);
  });

  it("detects a tampered membership leaf", () => {
    const eng = createEngagement({ id: "e3", poolAddr: POOL, wallets: [0x10n], salt, terms });
    const bundle = assembleWitness(tree, ror, eng);
    const slot = bundle.slots.find((s) => s.active)!;
    // mutate the opened leaf's metrics so its digest no longer matches the path
    (slot.proof as { leaf: Leaf }).leaf = { ...leaf(0x10n), metrics: { ...zeroMetrics(), baseEnd: 1n } };
    expect(verifyWitness(hasher, ror, bundle)).toBe(false);
  });

  it("refuses to treat a protocol contract as a member wallet", () => {
    // 0x30 is a protocol contract in the tree; committing it should verify false.
    const eng = createEngagement({ id: "e4", poolAddr: POOL, wallets: [0x30n], salt, terms });
    const bundle = assembleWitness(tree, ror, eng);
    expect(verifyWitness(hasher, ror, bundle)).toBe(false);
  });

  it("builds a zero-padded 16-slot vector with a correct bitmap", () => {
    const eng = createEngagement({ id: "e5", poolAddr: POOL, wallets: [0x40n, 0x10n], salt, terms });
    expect(eng.wallets.slots.length).toBe(16);
    expect(eng.wallets.slots[0]).toBe(0x10n); // sorted ascending
    expect(eng.wallets.slots[1]).toBe(0x40n);
    expect(eng.wallets.slots[2]).toBe(0n); // padding
    expect(eng.wallets.activeCount).toBe(2);
    expect(eng.wallets.bitmap.filter(Boolean).length).toBe(2);
  });
});
