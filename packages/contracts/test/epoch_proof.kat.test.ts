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

  it("rejects a tampered leaf in the LAST slot when all 16 are active (half-open ranges)", async () => {
    const { rootOfRoots, witness } = buildScenario(undefined, 14);
    expect(witness.activeCount).toBe(16n);
    await expect(runProveEpoch(witness, ID, rootOfRoots, EPOCH)).resolves.toMatchObject({ uptime: 48n });
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

describe.skipIf(!HAVE_BUILD)("H2: active bitmap / padding slots", () => {
  const run = (w: ReturnType<typeof buildScenario>["witness"], root: Uint8Array) =>
    runProveEpoch(w, ID, root, EPOCH);

  it("padding slots need no valid opening (all-zero paths accepted)", async () => {
    const { rootOfRoots, witness } = buildScenario();
    expect(witness.activeCount).toBe(2n);
    await expect(run(witness, rootOfRoots)).resolves.toMatchObject({ uptime: 48n });
  });

  it("rejects a padding slot opened as present (would inflate heldBase)", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.slotLeaves[5]!.present = true;
    w.slotLeaves[5]!.base_end = 1n << 120n;
    await expect(run(w, rootOfRoots)).rejects.toThrow(/padding slot opened as present \(H2\)/);
  });

  it("padding-slot depth does not count toward uptime (I6)", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.bidMin[0]!.fill(0n); w.askMin[0]!.fill(0n);
    w.bidMin[5]!.fill(10n); w.askMin[5]!.fill(10n);
    await expect(run(w, rootOfRoots)).resolves.toMatchObject({ uptime: 0n });
  });

  it("non-membership-slot depth does not count toward uptime (I6)", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.bidMin[0]!.fill(0n); w.askMin[0]!.fill(0n);
    w.bidMin[1]!.fill(10n); w.askMin[1]!.fill(10n);
    await expect(run(w, rootOfRoots)).resolves.toMatchObject({ uptime: 0n });
  });

  it("member depth still sums across slots (I6)", async () => {
    const { rootOfRoots, witness } = buildScenario(undefined, 1); // slot 2 is a member
    const w = cloneWitness(witness);
    w.bidMin[0]!.fill(4n); w.askMin[0]!.fill(4n);
    w.bidMin[2]!.fill(6n); w.askMin[2]!.fill(6n);
    w.bidMin[2]![0] = 5n; // bucket 0: 4 + 5 < 10 on bid
    await expect(run(w, rootOfRoots)).resolves.toMatchObject({ uptime: 47n });
  });

  it("L1: rejects an interior zero [a, 0, b] (activeCount 3)", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.committedWallets[2] = w.committedWallets[1]!;
    w.committedWallets[1] = 0n;
    w.activeCount = 3n;
    await expect(run(w, rootOfRoots)).rejects.toThrow(/active wallet is zero \(I1\)/);
  });

  it("L1: rejects a non-zero wallet above activeCount", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.activeCount = 1n; // hides wallet B from the sums
    await expect(run(w, rootOfRoots)).rejects.toThrow(/padding slot not zero \(I1\)/);
  });

  it("rejects activeCount larger than the wallet count", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.activeCount = 3n;
    await expect(run(w, rootOfRoots)).rejects.toThrow(/active wallet is zero \(I1\)/);
  });

  it("rejects activeCount > 16", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.activeCount = 17n;
    await expect(run(w, rootOfRoots)).rejects.toThrow(/activeCount out of range \(H2\)/);
  });

  it("rejects unsorted or duplicate active wallets", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const swapped = cloneWitness(witness);
    [swapped.committedWallets[0], swapped.committedWallets[1]] = [witness.committedWallets[1]!, witness.committedWallets[0]!];
    await expect(run(swapped, rootOfRoots)).rejects.toThrow(/wallets not sorted\/unique \(I1\)/);
    const dup = cloneWitness(witness);
    dup.committedWallets[1] = dup.committedWallets[0]!;
    await expect(run(dup, rootOfRoots)).rejects.toThrow(/wallets not sorted\/unique \(I1\)/);
  });
});
