// @mmr/dapp — the circuit witness for one engagement on one published day.
//
// The same shape the contract tests build (test/harness.ts buildScenario), but from a
// real indexed day: the pool's rebuilt tree, its committed series, and the engagement's
// private opening (wallets, terms, salts). For each committed wallet the witness holds
// its leaf and Merkle path (membership), or the low leaf proving it is absent
// (non-membership); for each member, the contracted band's depth series with its path
// into depth_root and the full flow series behind flow_root. Every opening is checked
// here against the published roots before anything is proven.

import {
  BUCKETS, SLOTS, ZERO_CARRY_W, toField, toPath, toSlotLeaf,
  type CarryTotalsW, type EpochWitness, type PathStepW, type SlotLeafW, type TermsW,
} from "@mmr/contracts/harness";
import {
  type AddressSeries, commitDepth, commitFlow, denseBandSeries, openBand, openFlow, seriesOf,
} from "@mmr/indexer";
import { type Digest, type PathStep, digestToHex, emptyLeaf } from "@mmr/merkle";
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import type { PublishedDay } from "./published.js";

export interface EngagementPrivate {
  /** The engagement's pool on its chain. */
  poolAddr: bigint;
  /** Active wallets, ascending (the committed vector is these, zero-padded to 16). */
  wallets: bigint[];
  walletSalt: Uint8Array;
  terms: TermsW;
  termsSalt: Uint8Array;
}

export interface DayCarry {
  prev: CarryTotalsW;
  prevSalt: Uint8Array;
  newSalt: Uint8Array;
}

export interface RealWitness {
  witness: EpochWitness;
  /** The day's root-of-roots, as published on chain. */
  rootOfRoots: Uint8Array;
  /** Committed wallets present in the pool that day. */
  members: bigint[];
  /** Σ over member slots: the day's transfer sums (the carry-forward step's input). */
  sums: CarryTotalsW;
}

const ZERO_PATH: PathStep[] = Array.from({ length: 16 }, () => ({ sibling: new Uint8Array(32), weAreRight: false }));
const ZERO_BAND_PATH: PathStepW[] = [0, 1].map(() => ({ sibling: 0n, weAreRight: false }));
const zeroGrid = (): bigint[][] => Array.from({ length: SLOTS }, () => new Array<bigint>(BUCKETS).fill(0n));
const same = (a: Digest, b: Digest) => digestToHex(a) === digestToHex(b);

/** The committed wallet vector: ascending active wallets, zero-padded to 16 slots. */
export function walletVector(wallets: readonly bigint[]): bigint[] {
  const sorted = [...wallets].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (sorted.length === 0 || sorted.length > SLOTS) throw new Error(`1 to ${SLOTS} wallets, got ${sorted.length}`);
  if (new Set(sorted).size !== sorted.length) throw new Error("duplicate wallet");
  return [...sorted, ...new Array<bigint>(SLOTS - sorted.length).fill(0n)];
}

/**
 * Build the witness for `eng` on `day`. `series` is the pool's committed series (needed
 * only by proveEpoch; proveFunding reads leaves and paths only).
 */
export function realWitness(
  day: PublishedDay,
  eng: EngagementPrivate,
  series: { bandsBps: number[]; series: ReadonlyMap<bigint, AddressSeries> } | undefined,
  carry: DayCarry = { prev: { ...ZERO_CARRY_W }, prevSalt: new Uint8Array(32), newSalt: new Uint8Array(32) },
): RealWitness {
  const hasher = new PoseidonHasher();
  const tree = day.trees.get(eng.poolAddr);
  if (!tree) throw new Error(`pool 0x${eng.poolAddr.toString(16)} is not indexed on day ${day.day}`);
  const pool = day.ror.poolProof(eng.poolAddr);
  const committed = walletVector(eng.wallets);
  const active = committed.filter((w) => w !== 0n);
  const band = Number(eng.terms.band_bps);

  const slotLeaves: SlotLeafW[] = [];
  const slotPaths: PathStepW[][] = [];
  const bidMin = zeroGrid();
  const askMin = zeroGrid();
  const flowBuy = zeroGrid();
  const flowSell = zeroGrid();
  const depthPaths: PathStepW[][] = Array.from({ length: SLOTS }, () => ZERO_BAND_PATH);
  const members: bigint[] = [];
  const sums: CarryTotalsW = { ...ZERO_CARRY_W };

  for (let j = 0; j < SLOTS; j++) {
    const w = committed[j]!;
    if (w === 0n) {
      slotLeaves.push(toSlotLeaf(emptyLeaf(), false));
      slotPaths.push(toPath(ZERO_PATH));
      continue;
    }
    if (!tree.has(w)) {
      const non = tree.nonMembershipProof(w);
      slotLeaves.push(toSlotLeaf(non.lowLeaf, false));
      slotPaths.push(toPath(non.path));
      continue;
    }
    const mem = tree.membershipProof(w);
    slotLeaves.push(toSlotLeaf(mem.leaf, true));
    slotPaths.push(toPath(mem.path));
    members.push(w);
    sums.xfer_in += mem.leaf.metrics.xferIn;
    sums.xfer_out += mem.leaf.metrics.xferOut;
    sums.from_treasury += mem.leaf.metrics.fromTreasury;
    if (!series) continue;
    // H1 / M1: the published series must be exactly what this leaf commits to.
    const s = seriesOf(series.series, w);
    if (!same(commitDepth(hasher, s.depth, series.bandsBps), mem.leaf.depthRoot)) {
      throw new Error(`published depth series of ${w.toString(16)} does not match its leaf on day ${day.day}`);
    }
    if (!same(commitFlow(hasher, s.flow), mem.leaf.flowRoot)) {
      throw new Error(`published flow series of ${w.toString(16)} does not match its leaf on day ${day.day}`);
    }
    const bandSeries = s.depth.flatMap((b) =>
      b.perBand.filter((p) => p.bandBps === band).map((p) => ({ bucket: b.bucket, minBid: p.minBid, minAsk: p.minAsk })));
    const dense = denseBandSeries(bandSeries);
    bidMin[j] = dense.bid;
    askMin[j] = dense.ask;
    depthPaths[j] = toPath(openBand(hasher, s.depth, series.bandsBps, band).path);
    const f = openFlow(s.flow);
    flowBuy[j] = f.buy;
    flowSell[j] = f.sell;
  }

  return {
    rootOfRoots: day.ror.root,
    members,
    sums,
    witness: {
      committedWallets: committed,
      activeCount: BigInt(active.length),
      walletSalt: eng.walletSalt,
      slotLeaves,
      terms: eng.terms,
      termsSalt: eng.termsSalt,
      bidMin, askMin, depthPaths, flowBuy, flowSell, slotPaths,
      poolEntry: { poolAddr: pool.poolAddr, poolRoot: toField(pool.poolRoot) },
      poolPath: toPath(pool.path),
      carryPrev: carry.prev,
      carryPrevSalt: carry.prevSalt,
      carryNewSalt: carry.newSalt,
    },
  };
}
