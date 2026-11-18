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
  type Hasher,
  encodeLeaf,
  encodePoolLeaf,
} from "@mmr/merkle";
import { PoseidonHasher, digestToField, fieldToDigest } from "@mmr/merkle/poseidon";
import {
  assembleDepthOpenings,
  assembleFlowOpenings,
  buildWalletVector,
  carryStep,
  commitTerms,
  commitWallets,
  createEngagement,
  evaluateEpoch,
  genesisCarry,
  roundTripCapHolds,
  roundTripFromOpenings,
  uptimeFromOpenings,
  verifyDepthOpenings,
  verifyFlowOpenings,
  ZERO_CARRY,
  type CarryTotals,
} from "@mmr/prover";
import { deriveClaimFromRecords, verifyClaimAgainstRecords } from "@mmr/watcher";
import {
  DEFAULT_CONFIG,
  bucketsPerEpoch,
  denseBandSeries,
  openBand,
  type AddressActivity,
  type DepthBucketSample,
  type EpochRange,
  type FlowWindowSample,
} from "@mmr/indexer";
import {
  HAVE_BUILD,
  callerAccepts,
  termsToEngagement,
  proveEpochs,
  runClaim,
  type ClaimArgs,
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
  type CarryTotalsW,
  runProveEpoch,
  profileTierKey,
  BUILD_DIR,
  KAT_ID,
  WALLET_B,
  toSlotLeaf,
} from "./harness.js";

/** The harness registers each witness's wallets / terms under this id (C2 on-chain). */
const ID = KAT_ID;
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
    expect(d).toEqual(rt.convertBigintToBytes(32, f, "kat"));
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
               depthTarget: 10n, roundtripSharePpm: 1_000_000n, bandBps: BAND, minUptimeBuckets: 48, epochsTotal: 3 },
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

describe.skipIf(!HAVE_BUILD)("M1: flow witness bound to flow_root; round-trip cap (I7)", () => {
  const M1 = /flow_root opening mismatch \(M1\)/;
  const I7 = /round-trip cap \(I7\)/;
  const run = (w: ReturnType<typeof buildScenario>["witness"], root: Uint8Array) =>
    runProveEpoch(w, ID, root, EPOCH);
  // The flow-openings.test.ts fixture, A in slot 0 and the extra member in slot 2:
  //   window 0: buy Σ=100, sell Σ=150 -> rt=100 · window 1: buy Σ=50, sell Σ=30 -> rt=30
  //   roundTrip = 130, gross = 330
  const FLOW_A: FlowWindowSample[] = [{ window: 0, buy: 100n, sell: 100n }, { window: 1, buy: 50n, sell: 0n }];
  const FLOW_C: FlowWindowSample[] = [{ window: 0, buy: 0n, sell: 50n }, { window: 1, buy: 0n, sell: 30n }];
  const scenario = (flowHasher?: Hasher) =>
    buildScenario(undefined, 1, {}, undefined, undefined, { 0: FLOW_A, 2: FLOW_C }, flowHasher);
  const withPpm = (w: ReturnType<typeof buildScenario>["witness"], ppm: bigint) => {
    const x = cloneWitness(w);
    x.terms.roundtrip_share_ppm = ppm;
    return x;
  };

  it("prover openings as witness: rt/gross == oracle sums; cap enforced at the exact boundary", async () => {
    const s = scenario();
    const wallets = s.witness.committedWallets.slice(0, Number(s.witness.activeCount));
    const activities = new Map<bigint, AddressActivity>([
      [wallets[0]!, { ...katActivity(wallets[0]!, depthSamples(flatDepth(10n))), flowWindows: FLOW_A }],
      [wallets[2]!, { ...katActivity(wallets[2]!, depthSamples(flatDepth(0n))), flowWindows: FLOW_C }],
    ]);
    const engagement = createEngagement({
      id: "m1-kat", poolAddr: POOL, wallets, salt: new Uint8Array(32).fill(1),
      terms: { floorPriceP: 2n, loanL0: 0n, quoteStartQ0: 0n, disposalD: 0n, netSellS: 0n,
               depthTarget: 10n, roundtripSharePpm: 500_000n, bandBps: BAND, minUptimeBuckets: 48, epochsTotal: 3 },
    });
    const openings = assembleFlowOpenings(engagement, activities);
    const hasher = new PoseidonHasher();
    const flowRootByAddr = new Map(s.tree.leaves.map((l) => [l.addr, l.flowRoot] as const));
    expect(openings.map((o) => o.slot)).toEqual([0, 2]);
    expect(verifyFlowOpenings(hasher, flowRootByAddr, openings)).toBe(true);

    const totals = roundTripFromOpenings(openings);
    const verdict = evaluateEpoch(engagement, activities, DEFAULT_CONFIG, KAT_RANGE, { settled: true });
    expect(totals).toEqual({ roundTripVolume: verdict.sums.roundTripVolume, grossVolume: verdict.sums.grossVolume });
    expect(totals).toEqual({ roundTripVolume: 130n, grossVolume: 330n });

    // Circuit witness = the prover's openings.
    const w = cloneWitness(s.witness);
    for (const o of openings) { w.flowBuy[o.slot] = o.opening.buy; w.flowSell[o.slot] = o.opening.sell; }
    await expect(run(w, s.rootOfRoots)).resolves.toMatchObject({ uptime: 48n });

    // 130·1e6 vs ppm·330: 393_940 -> 130_000_200 (holds), 393_939 -> 129_999_870 (breach).
    for (const [ppm, holds] of [[393_940n, true], [393_939n, false]] as const) {
      expect(roundTripCapHolds(totals, ppm)).toBe(holds);
      const p = run(withPpm(w, ppm), s.rootOfRoots);
      if (holds) await expect(p).resolves.toMatchObject({ uptime: 48n });
      else await expect(p).rejects.toThrow(I7);
    }
  });

  it("rejects a deflated sell on a member slot (leaf mismatch)", async () => {
    const { rootOfRoots, witness } = scenario();
    const w = cloneWitness(witness);
    w.flowSell[0]![0] = 0n; // would drop window-0 rt from 100 to 0
    await expect(run(w, rootOfRoots)).rejects.toThrow(M1);
  });

  it("rejects omitting a window (whole series is committed, DD-14)", async () => {
    const { rootOfRoots, witness } = scenario();
    const w = cloneWitness(witness);
    w.flowBuy[0]![0] = 0n; w.flowSell[0]![0] = 0n;
    await expect(run(w, rootOfRoots)).rejects.toThrow(M1);
  });

  it("rejects swapping two members' flow series", async () => {
    const { rootOfRoots, witness } = scenario();
    const w = cloneWitness(witness);
    [w.flowBuy[0], w.flowBuy[2]] = [witness.flowBuy[2]!, witness.flowBuy[0]!];
    [w.flowSell[0], w.flowSell[2]] = [witness.flowSell[2]!, witness.flowSell[0]!];
    await expect(run(w, rootOfRoots)).rejects.toThrow(M1);
  });

  it("rejects a flow_root committed with Sha256Hasher (only PoseidonHasher matches)", async () => {
    const { rootOfRoots, witness } = scenario(new Sha256Hasher());
    await expect(run(witness, rootOfRoots)).rejects.toThrow(M1);
  });

  it("non-member and padding flow is masked out of I7 (and unchecked)", async () => {
    const { rootOfRoots, witness } = buildScenario(); // members carry no flow: rt = gross = 0
    const w = withPpm(witness, 0n);                  // 0·1e6 <= 0·0 holds
    for (const j of [1, 5]) { w.flowBuy[j]!.fill(100n); w.flowSell[j]!.fill(100n); }
    await expect(run(w, rootOfRoots)).resolves.toMatchObject({ uptime: 48n });
  });
});

describe.skipIf(!HAVE_BUILD)("M2(b): I5 carry-forward commitment across epochs", () => {
  const CUM = /cumulative outflow cap \(I5, M2\)/;
  const CHAIN = /carry-forward chain broken \(M2\)/;
  const GENESIS = /carry-forward genesis not zero \(M2\)/;
  // D = 100. Every epoch member A sends 40 out and receives nothing: per-epoch I5
  // (40 <= 0 + 100) holds each epoch, but the lifetime total reaches 120 at epoch 3.
  const scenario = () => buildScenario(undefined, 0, { xferIn: 0n, xferOut: 40n, fromTreasury: 0n });
  const SUMS = { xferIn: 0n, xferOut: 40n, fromTreasury: 0n };
  const D = 100n;
  const salt = (k: number) => new Uint8Array(32).fill(0xc0 + k);
  const toW = (t: CarryTotals): CarryTotalsW =>
    ({ xfer_in: t.xferIn, xfer_out: t.xferOut, from_treasury: t.fromTreasury });
  const ch = new CompactHasher(); // carryCommit with CompactHasher == persistentCommit<CarryTotals>
  const withCarry = (w: ReturnType<typeof buildScenario>["witness"], prev: CarryTotals, prevSalt: Uint8Array, newSalt: Uint8Array) => {
    const x = cloneWitness(w);
    x.carryPrev = toW(prev); x.carryPrevSalt = prevSalt; x.carryNewSalt = newSalt;
    return x;
  };

  /** Prove epochs 1..n in sequence on one ledger, checking each against carryStep. */
  async function chain(n: number) {
    const { rootOfRoots, witness } = scenario();
    let state: Awaited<ReturnType<typeof runProveEpoch>>["state"] | undefined;
    let prev: CarryTotals = ZERO_CARRY;
    let prevSalt = salt(0);
    let prevCommitment = genesisCarry(ch, prevSalt);
    for (let e = 1; e <= n; e++) {
      const step = carryStep(ch, { prevCommitment, prevTotals: prev, prevSalt, epochSums: SUMS, newSalt: salt(e), disposalD: D });
      expect(step.ok).toBe(true);
      const r = await runProveEpoch(withCarry(witness, prev, prevSalt, salt(e)), ID, rootOfRoots, BigInt(e), state);
      expect(r.carryCommitment).toEqual(step.newCommitment); // byte-match: ledger == carryCommit
      state = r.state; prev = step.newTotals; prevSalt = salt(e); prevCommitment = step.newCommitment;
    }
    return { rootOfRoots, witness, state: state!, prev, prevSalt, prevCommitment };
  }

  it("3 epochs: each passes per-epoch I5; the cumulative crosses D at epoch 3 and reverts", async () => {
    const c = await chain(2);
    expect(c.prev).toEqual({ xferIn: 0n, xferOut: 80n, fromTreasury: 0n });

    const step3 = carryStep(ch, { prevCommitment: c.prevCommitment, prevTotals: c.prev, prevSalt: c.prevSalt,
                                  epochSums: SUMS, newSalt: salt(3), disposalD: D });
    expect(step3.chained).toBe(true);
    expect(step3.capHolds).toBe(false); // 120 > 100
    await expect(runProveEpoch(withCarry(c.witness, c.prev, c.prevSalt, salt(3)), ID, c.rootOfRoots, 3n, c.state))
      .rejects.toThrow(CUM);

    // The same epoch-3 activity passes on its own: only the carry-forward catches it.
    await expect(runProveEpoch(c.witness, ID, c.rootOfRoots, 3n)).resolves.toMatchObject({ uptime: 48n });
  });

  it("rejects a broken chain: understated prevTotals", async () => {
    const c = await chain(1);
    expect(carryStep(ch, { prevCommitment: c.prevCommitment, prevTotals: ZERO_CARRY, prevSalt: c.prevSalt,
                           epochSums: SUMS, newSalt: salt(2), disposalD: D }).chained).toBe(false);
    await expect(runProveEpoch(withCarry(c.witness, ZERO_CARRY, c.prevSalt, salt(2)), ID, c.rootOfRoots, 2n, c.state))
      .rejects.toThrow(CHAIN);
  });

  it("rejects a broken chain: right totals, wrong salt", async () => {
    const c = await chain(1);
    await expect(runProveEpoch(withCarry(c.witness, c.prev, salt(9), salt(2)), ID, c.rootOfRoots, 2n, c.state))
      .rejects.toThrow(CHAIN);
  });

  it("rejects a non-zero genesis (phantom prior inflow would buy outflow budget)", async () => {
    const { rootOfRoots, witness } = scenario();
    const phantom: CarryTotals = { xferIn: 1_000n, xferOut: 0n, fromTreasury: 0n };
    await expect(runProveEpoch(withCarry(witness, phantom, salt(0), salt(1)), ID, rootOfRoots, 1n))
      .rejects.toThrow(GENESIS);
  });
});

describe.skipIf(!HAVE_BUILD)("H4: claim credits only on-ledger epochs (DD-12)", () => {
  const SECRET = new Uint8Array(32).fill(0x99);
  const PROFILE = new Uint8Array(32).fill(0x77);
  // Terms: min_uptime_buckets = 40, epochs_total = 30 (DD-35). Proven epoch uptimes 48, 43, 0 ->
  // passed 2 of 30 (the 27 unproven epochs count toward the total, never toward passed).
  const a43 = flatDepth(10n);
  for (let b = 0; b < 5; b++) { a43.bid[b] = 3n; a43.ask[b] = 3n; }
  const epochScenarios = () => [
    buildScenario(),                                       // 48
    buildScenario(undefined, 0, {}, { 0: a43 }),           // 43
    buildScenario(undefined, 0, {}, { 0: flatDepth(0n) }), // 0
  ];

  /** Register, prove `n` epochs on one ledger, and return what a claim needs. */
  async function setup(scenarios = epochScenarios()) {
    const reg = await runRegister(scenarios[0]!.witness, SECRET);
    const { state, records } = await proveEpochs(scenarios, reg.id, new CompactHasher(), reg.state);
    const { terms, termsSalt } = scenarios[0]!.witness;
    const present = new Map(records.map((r) => [Number(r.epoch), r]));
    const base: ClaimArgs = {
      engagementId: reg.id, engagementSecret: SECRET, profileSecret: PROFILE, terms, termsSalt,
      present, epochsPassed: 2n, epochsTotal: 30n,
    };
    return { reg, state, records, base };
  }

  it("honest claim == deriveClaimFromRecords; counters credited once", async () => {
    const { reg, state, records, base } = await setup();
    expect(records.map((r) => r.uptime)).toEqual([48n, 43n, 0n]);
    expect(records.every((r) => r.termsCommit.every((x, i) => x === reg.termsCommit[i]))).toBe(true);
    const t = termsToEngagement(base.terms);
    const derived = deriveClaimFromRecords("h4", 1,
      records.map((r) => ({ epoch: Number(r.epoch), uptime: Number(r.uptime) })), t.minUptimeBuckets, t.epochsTotal);
    expect(derived).toMatchObject({ epochsPassed: 2, epochsTotal: 30 });
    expect(verifyClaimAgainstRecords(derived,
      records.map((r) => ({ epoch: Number(r.epoch), uptime: Number(r.uptime) })), t.minUptimeBuckets, t.epochsTotal)).toBe(true);

    const r = await runClaim(base, state);
    expect([r.completed, r.kpiHits, r.kpiTotal]).toEqual([1n, 2n, 30n]);
    // I10: the same engagement cannot be claimed twice
    await expect(runClaim(base, r.state)).rejects.toThrow(/engagement already claimed \(I10\)/);
  });

  it("rejects an inflated epochsPassed", async () => {
    const { state, base } = await setup();
    await expect(runClaim({ ...base, epochsPassed: 3n }, state))
      .rejects.toThrow(/epochsPassed does not match the epoch records \(H4\)/);
  });

  it("rejects a wrong denominator (epochsTotal != committed contract length)", async () => {
    const { state, base } = await setup();
    await expect(runClaim({ ...base, epochsTotal: 29n }, state))
      .rejects.toThrow(/epochsTotal is not the contract length \(H4\)/);
  });

  it("rejects a fabricated record (not on the ledger)", async () => {
    const { state, base, records } = await setup();
    const present = new Map(base.present);
    present.set(3, { ...records[2]!, uptime: 48n }); // epoch 3 really recorded 0
    await expect(runClaim({ ...base, present, epochsPassed: 3n }, state))
      .rejects.toThrow(/epoch record not on the ledger \(H4\)/);
  });

  it("rejects a real record presented in the wrong epoch slot", async () => {
    const { state, base, records } = await setup();
    const present = new Map(base.present);
    present.set(3, records[0]!); // epoch 1's 48 re-used as epoch 3
    await expect(runClaim({ ...base, present, epochsPassed: 3n }, state))
      .rejects.toThrow(/record is not this engagement's epoch \(H4\)/);
  });

  it("rejects claiming another engagement's id with one's own secret", async () => {
    const { state, base } = await setup();
    await expect(runClaim({ ...base, engagementSecret: new Uint8Array(32).fill(0x55) }, state))
      .rejects.toThrow(/secret does not derive engagementId \(H4\)/);
  });

  it("rejects loosened terms (a lower threshold does not match the records' termsCommit)", async () => {
    const { state, base } = await setup();
    const terms = { ...base.terms, min_uptime_buckets: 0n };
    await expect(runClaim({ ...base, terms, epochsPassed: 3n }, state))
      .rejects.toThrow(/record is not this engagement's epoch \(H4\)/);
  });

  it("an epoch beyond the contract cannot be proven; withholding only lowers the score", async () => {
    // a fresh engagement (genesis carry), so the only thing wrong is the epoch number
    const { witness, rootOfRoots } = buildScenario();
    const fresh = await runRegister(witness, new Uint8Array(32).fill(0x31));
    await expect(runProveEpoch(witness, fresh.id, rootOfRoots, 31n, fresh.state))
      .rejects.toThrow(/epoch outside the contract \(DD-35\)/);
    const { state, base } = await setup();
    const present = new Map(base.present);
    present.delete(2); // withhold epoch 2 (43 >= 40)
    await expect(runClaim({ ...base, present, epochsPassed: 1n }, state)).resolves.toMatchObject({ kpiHits: 1n });
  });

  it("the tier must be the registered one, and counters are kept per tier (DD-35)", async () => {
    const { state, base } = await setup();
    // the records were proven under tier A (1): claiming them as tier B does not match
    await expect(runClaim({ ...base, tier: 2n }, state))
      .rejects.toThrow(/record is not this engagement's epoch \(H4\)/);
    await expect(runClaim({ ...base, tier: 4n }, state)).rejects.toThrow(/unknown tier \(DD-35\)/);
    const a = await runClaim(base, state);
    expect([a.completed, a.kpiHits, a.kpiTotal]).toEqual([1n, 2n, 30n]);
    // a tier-B profile counter for the same profile is untouched
    const led = (await import(BUILD_DIR)).ledger(a.state);
    expect(led.completedCount.member(profileTierKey(rt.persistentHash(new rt.CompactTypeBytes(32), PROFILE), 2n))).toBe(false);
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
    lpFirstActiveTs: KAT_RANGE.endTs - 1_000_000, // old enough: not JIT
  };
}

describe.skipIf(!HAVE_BUILD)("C2: wallets + terms bound to the registered engagement", () => {
  const SECRET = new Uint8Array(32).fill(0x99);
  const C2_WALLET = /wallet commitment does not match registration \(C2\)/;

  async function registered() {
    const s = buildScenario();
    const reg = await runRegister(s.witness, SECRET);
    return { ...s, reg };
  }

  it("honest epoch: disclosed commitments equal registration's ledger values", async () => {
    const { rootOfRoots, witness, reg } = await registered();
    const r = await runProveEpoch(witness, reg.id, rootOfRoots, EPOCH, reg.state);
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
    expect(commitTerms(h, termsToEngagement(t), witness.termsSalt)).toEqual(reg.termsCommit);
  });

  it("an unregistered engagement cannot prove an epoch", async () => {
    const { rootOfRoots, witness, reg } = await registered();
    const other = new Uint8Array(32).fill(0x42);
    await expect(runProveEpoch(witness, other, rootOfRoots, EPOCH, reg.state))
      .rejects.toThrow(/engagement not registered \(C2\)/);
  });

  it("loosened terms still prove; the caller (and settleEpoch, H3b) rejects them", async () => {
    const { rootOfRoots, witness, reg } = await registered();
    const w = cloneWitness(witness);
    w.terms.disposal_D = 1n << 100n; // an MM relaxing its own outflow cap
    const r = await runProveEpoch(w, reg.id, rootOfRoots, EPOCH, reg.state);
    expect(r.walletCommit).toEqual(reg.walletCommit);
    expect(callerAccepts(reg, r)).toBe(false);
  });

  it("a dropped wallet reverts in-circuit", async () => {
    const { rootOfRoots, witness, reg } = await registered();
    const w = cloneWitness(witness);
    w.committedWallets[1] = 0n; // hide wallet B this epoch
    w.activeCount = 1n;
    w.slotLeaves[1]!.present = false;
    await expect(runProveEpoch(w, reg.id, rootOfRoots, EPOCH, reg.state)).rejects.toThrow(C2_WALLET);
  });

  it("a swapped wallet reverts in-circuit, even with a valid non-membership opening", async () => {
    const { rootOfRoots, witness, reg, tree } = await registered();
    const w = cloneWitness(witness);
    const swapped = WALLET_B + 1n; // another address outside the pool, bracketed by the same low leaf
    w.committedWallets[1] = swapped;
    const non = tree.nonMembershipProof(swapped);
    w.slotLeaves[1] = toSlotLeaf(non.lowLeaf, false);
    w.slotPaths[1] = toPath(non.path);
    await expect(runProveEpoch(w, reg.id, rootOfRoots, EPOCH, reg.state)).rejects.toThrow(C2_WALLET);
    // the same epoch proves for an engagement that registered the swapped wallet
    const reg2 = await runRegister(w, new Uint8Array(32).fill(0x98));
    await expect(runProveEpoch(w, reg2.id, rootOfRoots, EPOCH, reg2.state)).resolves.toMatchObject({ uptime: 48n });
  });

  it("a different wallet salt reverts in-circuit; a different terms salt is rejected by the caller", async () => {
    const { rootOfRoots, witness, reg } = await registered();
    const ws = cloneWitness(witness);
    ws.walletSalt[0] = ws.walletSalt[0]! ^ 1;
    await expect(runProveEpoch(ws, reg.id, rootOfRoots, EPOCH, reg.state)).rejects.toThrow(C2_WALLET);
    const ts = cloneWitness(witness);
    ts.termsSalt[0] = ts.termsSalt[0]! ^ 1;
    expect(callerAccepts(reg, await runProveEpoch(ts, reg.id, rootOfRoots, EPOCH, reg.state))).toBe(false);
  });
});
