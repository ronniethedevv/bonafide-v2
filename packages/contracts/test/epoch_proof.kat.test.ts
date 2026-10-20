// KAT: @mmr/merkle (PoseidonHasher) roots == in-circuit roots for proveEpoch.
//
// PASS case proves the TS leaf / pool-leaf / node hashing and the Field <->
// Bytes<32> encoding agree with the circuit's transientHash. The tamper cases
// prove the C1 binding bites: change any opened value and the circuit's Merkle
// assert fires. CompactHasher (persistentHash) is still checked: it backs the
// C2 commitments.

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
import { PoseidonHasher, digestToField, fieldToDigest } from "@mmr/merkle/poseidon";
import {
  assembleDepthOpenings,
  buildWalletVector,
  commitTerms,
  commitWallets,
  createEngagement,
  evaluateEpoch,
  uptimeFromOpenings,
  verifyDepthOpenings,
} from "@mmr/prover";
import {
  DEFAULT_CONFIG,
  bucketsPerEpoch,
  denseBandSeries,
  openBand,
  type AddressActivity,
  type DepthBucketSample,
  type EpochRange,
} from "@mmr/indexer";
import {
  HAVE_BUILD,
  HAVE_REG_BUILD,
  callerAccepts,
  runRegister,
  buildScenario,
  cloneWitness,
  flatDepth,
  depthSamples,
  toPath,
  BAND,
  BANDS,
  POOL,
  type MemberDepth,
  runProveEpoch,
} from "./harness.js";

const ID = new Uint8Array(32).fill(0x42);
const EPOCH = 7n;
const SLOT_PATH = /slot Merkle path mismatch \(C1\)/;
const POOL_PATH = /pool inclusion path mismatch \(C1\)/;

describe("PoseidonHasher matches compact-runtime transientHash", () => {
  const h = new PoseidonHasher();
  const F = rt.CompactTypeField;

  it("hashNode == transientHash<Vector<2, Field>>, digest == `Field as Bytes<32>` (LE)", () => {
    const l = 123456789n, r = rt.MAX_FIELD - 7n;
    const f = rt.transientHash(new rt.CompactTypeVector(2, F), [l, r]);
    const d = h.hashNode(fieldToDigest(l), fieldToDigest(r));
    expect(d).toEqual(rt.convertFieldToBytes(32, f, "kat"));
    expect(d[0]).toBe(Number(f & 0xffn)); // little-endian
    expect(digestToField(d)).toBe(f);
  });

  it("rejects non-canonical digests (>= field modulus) and non-leaf preimages", () => {
    const big = new Uint8Array(32).fill(0xff);
    expect(() => h.hashNode(big, new Uint8Array(32))).toThrow(/exceeds maximum value/);
    expect(() => h.hashLeaf(new Uint8Array(64))).toThrow(/hashes only slot/);
  });

  it("a pool leaf hashes like a node (no alignment tag): safety rests on fixed path depth", () => {
    // transientHash<PoolEntry>(a, r) == transientHash<Vector<2, Field>>([a, r]). Opening a
    // level-k node as a pool leaf would need a 10-k step path; the circuit takes exactly 10.
    const root = fieldToDigest(99n);
    expect(h.hashLeaf(encodePoolLeaf({ poolAddr: 5n, poolRoot: root })))
      .toEqual(h.hashNode(fieldToDigest(5n), root));
  });
});

describe("CompactHasher matches compact-runtime persistentHash (C2 commitments)", () => {
  const h = new CompactHasher();

  it("hashNode == persistentHash<Vector<2, Bytes<32>>>", () => {
    const B32 = new rt.CompactTypeBytes(32);
    const l = new Uint8Array(32).map((_, i) => i);
    const r = new Uint8Array(32).map((_, i) => 255 - i);
    expect(h.hashNode(l, r)).toEqual(rt.persistentHash(new rt.CompactTypeVector(2, B32), [l, r]));
  });

  it("leaf / pool-leaf images use Compact's little-endian Uint layout", () => {
    const { tree, ror, witness } = buildScenario();
    const leaf = tree.membershipProof(witness.committedWallets[0]!).leaf;
    expect(encodeLeaf(leaf).length).toBe(297);
    // addr is the first 20 bytes, little-endian.
    expect(encodeLeaf(leaf)[0]).toBe(Number(leaf.addr & 0xffn));
    expect(encodePoolLeaf(ror.poolProof(witness.poolEntry.poolAddr)).length).toBe(52);
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
    w.poolEntry.poolRoot ^= 1n;
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

  it("rejects a witness built with the tagged Sha256Hasher (only PoseidonHasher matches)", async () => {
    const { rootOfRoots, witness } = buildScenario(new Sha256Hasher());
    await expect(runProveEpoch(witness, ID, rootOfRoots, EPOCH)).rejects.toThrow(POOL_PATH);
  });

  it("rejects pre-migration roots built with CompactHasher (persistentHash)", async () => {
    const { rootOfRoots, witness } = buildScenario(new CompactHasher());
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
    const { rootOfRoots, witness } = buildScenario(undefined, 0, {}, { 0: flatDepth(0n) });
    const w = cloneWitness(witness);
    w.bidMin[5]!.fill(10n); w.askMin[5]!.fill(10n);
    await expect(run(w, rootOfRoots)).resolves.toMatchObject({ uptime: 0n });
  });

  it("non-membership-slot depth does not count toward uptime (I6)", async () => {
    const { rootOfRoots, witness } = buildScenario(undefined, 0, {}, { 0: flatDepth(0n) });
    const w = cloneWitness(witness);
    w.bidMin[1]!.fill(10n); w.askMin[1]!.fill(10n);
    await expect(run(w, rootOfRoots)).resolves.toMatchObject({ uptime: 0n });
  });

  it("member depth still sums across slots (I6)", async () => {
    const c = flatDepth(6n);
    c.bid[0] = 5n; // bucket 0: 4 + 5 < 10 on bid
    // slot 2 is a member; both members' depth is committed in their depth_root (H1)
    const { rootOfRoots, witness } = buildScenario(undefined, 1, {}, { 0: flatDepth(4n), 2: c });
    await expect(run(witness, rootOfRoots)).resolves.toMatchObject({ uptime: 47n });
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

describe.skipIf(!HAVE_BUILD)("M2(a): I5 excludes the treasury loan (DD-11)", () => {
  const I5 = /outflow cap \(I5\)/;
  // Terms: disposal_D = 100. The 1000 loan arrives inside xfer_in (from_treasury ⊆ xfer_in).
  const prove = (over: { xferIn: bigint; xferOut: bigint; fromTreasury: bigint }) => {
    const { rootOfRoots, witness } = buildScenario(undefined, 0, over);
    return runProveEpoch(witness, ID, rootOfRoots, EPOCH);
  };

  it("rejects transferring the loan back out (xfer_out == from_treasury, xfer_in is only the loan)", async () => {
    // The pre-fix `xfer_out <= xfer_in + D + from_treasury` accepted this: 1000 <= 2100.
    await expect(prove({ xferIn: 1_000n, xferOut: 1_000n, fromTreasury: 1_000n })).rejects.toThrow(I5);
  });

  it("rejects outflow one unit over D when the only inflow is the loan", async () => {
    await expect(prove({ xferIn: 1_000n, xferOut: 101n, fromTreasury: 1_000n })).rejects.toThrow(I5);
  });

  it("accepts outflow exactly D when the only inflow is the loan (boundary)", async () => {
    await expect(prove({ xferIn: 1_000n, xferOut: 100n, fromTreasury: 1_000n })).resolves.toMatchObject({ uptime: 48n });
  });

  it("non-loan inflow still funds outflow", async () => {
    await expect(prove({ xferIn: 1_500n, xferOut: 600n, fromTreasury: 1_000n })).resolves.toMatchObject({ uptime: 48n });
    await expect(prove({ xferIn: 1_500n, xferOut: 601n, fromTreasury: 1_000n })).rejects.toThrow(I5);
  });
});

describe.skipIf(!HAVE_BUILD)("H1: depth witness bound to depth_root (I6)", () => {
  const H1 = /depth_root opening mismatch \(H1\)/;
  const run = (w: ReturnType<typeof buildScenario>["witness"], root: Uint8Array) =>
    runProveEpoch(w, ID, root, EPOCH);

  it("rejects an inflated bucket minBid on a member slot", async () => {
    const { rootOfRoots, witness } = buildScenario(undefined, 0, {}, { 0: flatDepth(0n) });
    const w = cloneWitness(witness);
    w.bidMin[0]![17] = 10n; // forge one passing bucket on the bid side
    await expect(run(w, rootOfRoots)).rejects.toThrow(H1);
  });

  it("rejects a tampered bucket minAsk on a member slot", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.askMin[0]![47] = 9n; // deflating also changes the leaf: values are bound, not bounded
    await expect(run(w, rootOfRoots)).rejects.toThrow(H1);
  });

  it("rejects a tampered band-path sibling", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.depthPaths[0]![1]!.sibling += 1n;
    await expect(run(w, rootOfRoots)).rejects.toThrow(H1);
  });

  it("rejects a flipped band-path direction", async () => {
    const { rootOfRoots, witness } = buildScenario();
    const w = cloneWitness(witness);
    w.depthPaths[0]![0]!.weAreRight = !w.depthPaths[0]![0]!.weAreRight;
    await expect(run(w, rootOfRoots)).rejects.toThrow(H1);
  });

  it("rejects another band's (deeper) series opened with its own valid path", async () => {
    // Band BANDS[1] carries 2·d+1 per bucket and its path is genuine, but the leaf the
    // circuit rebuilds carries t.band_bps, so only the contracted band can open.
    const { rootOfRoots, witness } = buildScenario();
    const other = BANDS[1]!;
    const samples = depthSamples(flatDepth(10n));
    const w = cloneWitness(witness);
    w.bidMin[0] = samples.map((b) => b.perBand.find((p) => p.bandBps === other)!.minBid);
    w.askMin[0] = samples.map((b) => b.perBand.find((p) => p.bandBps === other)!.minAsk);
    w.depthPaths[0] = toPath(openBand(new PoseidonHasher(), samples, BANDS, other).path);
    await expect(run(w, rootOfRoots)).rejects.toThrow(H1);
  });

  it("rejects a depth_root committed with Sha256Hasher (only PoseidonHasher matches)", async () => {
    const { rootOfRoots, witness } = buildScenario(undefined, 0, {}, undefined, new Sha256Hasher());
    await expect(run(witness, rootOfRoots)).rejects.toThrow(H1);
  });

  it("circuit uptime == uptimeFromOpenings == oracle uptimeBuckets (prover openings as witness)", async () => {
    // A: 3 in buckets 0..9, else 10. Extra member (slot 2): 7 in buckets 0..4, else 0.
    //   buckets 0..4: 10 pass · 5..9: 3 fail · 10..47: 10 pass  ->  43
    const a = flatDepth(10n);
    for (let b = 0; b < 10; b++) { a.bid[b] = 3n; a.ask[b] = 3n; }
    const c = flatDepth(0n);
    for (let b = 0; b < 5; b++) { c.bid[b] = 7n; c.ask[b] = 7n; }
    const s = buildScenario(undefined, 1, {}, { 0: a, 2: c });
    const n = Number(s.witness.activeCount);
    const wallets = s.witness.committedWallets.slice(0, n);

    // Prover side: B is absent from the pool, so it has no activity (non-member).
    const activities = new Map<bigint, AddressActivity>(
      [[wallets[0]!, a], [wallets[2]!, c]].map(([addr, d]) =>
        [addr as bigint, katActivity(addr as bigint, depthSamples(d as MemberDepth))]),
    );
    const engagement = createEngagement({
      id: "h1-kat", poolAddr: POOL, wallets, salt: new Uint8Array(32).fill(1),
      terms: { floorPriceP: 2n, loanL0: 0n, quoteStartQ0: 0n, disposalD: 0n, netSellS: 0n,
               depthTarget: 10n, roundtripSharePpm: 1_000_000n, bandBps: BAND },
    });
    const hasher = new PoseidonHasher();
    const openings = assembleDepthOpenings(hasher, engagement, activities, DEFAULT_CONFIG, KAT_RANGE);
    const depthRootByAddr = new Map(s.tree.leaves.map((l) => [l.addr, l.depthRoot] as const));
    expect(openings.map((o) => o.slot)).toEqual([0, 2]);
    expect(verifyDepthOpenings(hasher, depthRootByAddr, openings, BAND)).toBe(true);

    // Circuit witness = the prover's openings, densified.
    const w = cloneWitness(s.witness);
    for (const o of openings) {
      const d = denseBandSeries(o.series);
      w.bidMin[o.slot] = d.bid;
      w.askMin[o.slot] = d.ask;
      w.depthPaths[o.slot] = toPath(o.opening.path);
    }
    const r = await run(w, s.rootOfRoots);
    const verdict = evaluateEpoch(engagement, activities, DEFAULT_CONFIG, KAT_RANGE, { settled: true });
    const fromOpenings = uptimeFromOpenings(openings, bucketsPerEpoch(DEFAULT_CONFIG), 10n);
    expect(fromOpenings).toBe(verdict.uptimeBuckets);
    expect(r.uptime).toBe(BigInt(fromOpenings));
    expect(r.uptime).toBe(43n);
  });
});

const KAT_RANGE: EpochRange = {
  epoch: 7, startBlock: 900_000, endBlock: 1_000_000, endBlockHash: "0xkat",
  startTs: 1_000_000, endTs: 1_086_400,
};

function katActivity(addr: bigint, depthBuckets: DepthBucketSample[]): AddressActivity {
  return {
    addr, isProtocol: false,
    baseStart: 0n, baseEnd: 0n, quoteEnd: 0n, lpBase: 0n, lpQuote: 0n,
    xferIn: 0n, xferOut: 0n, fromTreasury: 0n,
    swapBaseIn: 0n, swapBaseOut: 0n, swapQuoteIn: 0n, swapQuoteOut: 0n,
    depthBuckets, flowWindows: [],
    lpFirstActiveBlock: KAT_RANGE.endBlock - 1_000_000, // old enough: not JIT
  };
}

describe.skipIf(!HAVE_BUILD || !HAVE_REG_BUILD)("C2: wallets + terms bound to the registered engagement", () => {
  const SECRET = new Uint8Array(32).fill(0x99);

  async function registered() {
    const s = buildScenario();
    const reg = await runRegister(s.witness, SECRET);
    return { ...s, reg };
  }

  it("honest epoch: disclosed commitments equal registration's ledger values", async () => {
    const { rootOfRoots, witness, reg } = await registered();
    const r = await runProveEpoch(witness, reg.id, rootOfRoots, EPOCH);
    expect(r.walletCommit).toEqual(reg.walletCommit);
    expect(r.termsCommit).toEqual(reg.termsCommit);
    expect(callerAccepts(reg, r)).toBe(true);
  });

  it("@mmr/prover commitWallets / commitTerms match the registration circuit", async () => {
    const { witness, reg } = await registered();
    const h = new CompactHasher();
    const active = witness.committedWallets.slice(0, Number(witness.activeCount));
    expect(commitWallets(h, buildWalletVector(active), witness.walletSalt)).toEqual(reg.walletCommit);
    const t = witness.terms;
    expect(commitTerms(h, {
      floorPriceP: t.floor_price_P, loanL0: t.loan_L0, quoteStartQ0: t.quote_start_Q0,
      disposalD: t.disposal_D, netSellS: t.net_sell_S, depthTarget: t.depth_target,
      roundtripSharePpm: t.roundtrip_share_ppm, bandBps: Number(t.band_bps),
    }, witness.termsSalt)).toEqual(reg.termsCommit);
  });

  it("loosened terms still prove, but the caller rejects them", async () => {
    const { rootOfRoots, witness, reg } = await registered();
    const w = cloneWitness(witness);
    w.terms.disposal_D = 1n << 100n; // an MM relaxing its own outflow cap
    const r = await runProveEpoch(w, reg.id, rootOfRoots, EPOCH);
    expect(r.walletCommit).toEqual(reg.walletCommit);
    expect(callerAccepts(reg, r)).toBe(false);
  });

  it("a dropped wallet still proves, but the caller rejects it", async () => {
    const { rootOfRoots, witness, reg } = await registered();
    const w = cloneWitness(witness);
    w.committedWallets[1] = 0n; // hide wallet B this epoch
    w.activeCount = 1n;
    w.slotLeaves[1]!.present = false;
    const r = await runProveEpoch(w, reg.id, rootOfRoots, EPOCH);
    expect(r.termsCommit).toEqual(reg.termsCommit);
    expect(callerAccepts(reg, r)).toBe(false);
  });

  it("a different wallet or terms salt is rejected by the caller", async () => {
    const { rootOfRoots, witness, reg } = await registered();
    const ws = cloneWitness(witness);
    ws.walletSalt[0] = ws.walletSalt[0]! ^ 1;
    expect(callerAccepts(reg, await runProveEpoch(ws, reg.id, rootOfRoots, EPOCH))).toBe(false);
    const ts = cloneWitness(witness);
    ts.termsSalt[0] = ts.termsSalt[0]! ^ 1;
    expect(callerAccepts(reg, await runProveEpoch(ts, reg.id, rootOfRoots, EPOCH))).toBe(false);
  });
});
