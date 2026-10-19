// KAT: @mmr/merkle (CompactHasher) roots == in-circuit roots for proveEpoch.
//
// PASS case proves the TS leaf / pool-leaf / node encodings are byte-identical
// to Compact's persistentHash. The tamper cases prove the C1 binding bites:
// change any opened byte and the circuit's Merkle assert fires.

import { describe, expect, it } from "vitest";
import * as rt from "@midnight-ntwrk/compact-runtime";
import {
  CompactHasher,
  IndexedMerkleTree,
  RootOfRoots,
  Sha256Hasher,
  encodeLeaf,
  encodePoolLeaf,
} from "@mmr/merkle";
import {
  HAVE_BUILD,
  buildScenario,
  cloneWitness,
  runProveEpoch,
} from "./harness.js";

const ID = new Uint8Array(32).fill(0x42);
const EPOCH = 7n;
const SLOT_PATH = /slot Merkle path mismatch \(C1\)/;
const POOL_PATH = /pool inclusion path mismatch \(C1\)/;

describe("CompactHasher matches compact-runtime persistentHash", () => {
  const h = new CompactHasher();

  it("hashNode == persistentHash<Vector<2, Bytes<32>>>", () => {
    const B32 = new rt.CompactTypeBytes(32);
    const l = new Uint8Array(32).map((_, i) => i);
    const r = new Uint8Array(32).map((_, i) => 255 - i);
    expect(h.hashNode(l, r)).toEqual(rt.persistentHash(new rt.CompactTypeVector(2, B32), [l, r]));
  });

  it("leaf / pool-leaf images use Compact's little-endian Uint layout", () => {
    const { tree, witness } = buildScenario();
    const leaf = tree.membershipProof(witness.committedWallets[0]!).leaf;
    expect(encodeLeaf(leaf).length).toBe(297);
    // addr is the first 20 bytes, little-endian.
    expect(encodeLeaf(leaf)[0]).toBe(Number(leaf.addr & 0xffn));
    expect(encodePoolLeaf(witness.poolEntry).length).toBe(52);
  });

  it("TS-side openings verify against the TS roots", () => {
    const { hasher, tree, ror, rootOfRoots, witness } = buildScenario();
    const pool = ror.poolProof(witness.poolEntry.poolAddr);
    expect(RootOfRoots.verifyPoolProof(hasher, rootOfRoots, pool)).toBe(true);
    const mem = tree.membershipProof(witness.committedWallets[0]!);
    expect(IndexedMerkleTree.verifyPath(hasher, tree.root, hasher.hashLeaf(encodeLeaf(mem.leaf)), mem.path)).toBe(true);
  });
});

describe.skipIf(!HAVE_BUILD)("proveEpoch KAT (compiled circuit)", () => {
  it("accepts the TS-built witness: TS roots == circuit roots", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const r = await runProveEpoch(witness, ID, rootOfRoots, EPOCH);
    expect(r.uptime).toBe(48n);
    expect(r.ledgerUptime).toBe(48n);
  });

  it("rejects a tampered slot-leaf metric (membership slot)", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.slotLeaves[0]!.base_end += 1n;
    await expect(runProveEpoch(w, ID, rootOfRoots, EPOCH)).rejects.toThrow(SLOT_PATH);
  });

  it("rejects a tampered leaf in the LAST slot (j = 15; Compact ranges are half-open)", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.slotLeaves[15]!.base_end = 1n << 120n; // would inflate heldBase if unchecked
    await expect(runProveEpoch(w, ID, rootOfRoots, EPOCH)).rejects.toThrow(SLOT_PATH);
  });

  it("rejects a tampered low-leaf next_addr (non-membership slot)", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.slotLeaves[1]!.next_addr = 0n; // would let B "bracket" against an open tail
    await expect(runProveEpoch(w, ID, rootOfRoots, EPOCH)).rejects.toThrow(SLOT_PATH);
  });

  it("rejects a tampered depth_root byte", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.slotLeaves[0]!.depth_root[31] = w.slotLeaves[0]!.depth_root[31]! ^ 1;
    await expect(runProveEpoch(w, ID, rootOfRoots, EPOCH)).rejects.toThrow(SLOT_PATH);
  });

  it("rejects a flipped path direction", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.slotPaths[0]![0]!.weAreRight = !w.slotPaths[0]![0]!.weAreRight;
    await expect(runProveEpoch(w, ID, rootOfRoots, EPOCH)).rejects.toThrow(SLOT_PATH);
  });

  it("rejects a tampered pool root", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.poolEntry.poolRoot[0] = w.poolEntry.poolRoot[0]! ^ 1;
    await expect(runProveEpoch(w, ID, rootOfRoots, EPOCH)).rejects.toThrow(POOL_PATH);
  });

  it("rejects a tampered pool address", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.poolEntry.poolAddr += 1n;
    await expect(runProveEpoch(w, ID, rootOfRoots, EPOCH)).rejects.toThrow(POOL_PATH);
  });

  it("rejects a different rootOfRoots", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const other = Uint8Array.from(rootOfRoots);
    other[5] = other[5]! ^ 1;
    await expect(runProveEpoch(witness, ID, other, EPOCH)).rejects.toThrow(POOL_PATH);
  });

  it("rejects a witness built with the tagged Sha256Hasher (only CompactHasher matches)", async () => {
    const { rootOfRoots, witness } = buildScenario(new Sha256Hasher());
    await expect(runProveEpoch(witness, ID, rootOfRoots, EPOCH)).rejects.toThrow(POOL_PATH);
  });
});
