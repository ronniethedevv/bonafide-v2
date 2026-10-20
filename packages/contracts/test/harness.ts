// Known-answer harness for the compiled epoch_proof circuit.
//
// Builds a real scenario with @mmr/merkle (PoseidonHasher), converts it to the
// exact witness shapes `proveEpoch` declares, and executes the compiled
// circuit through @midnight-ntwrk/compact-runtime. Executing the circuit runs
// every in-circuit `transientHash` and `assert`, so a PASS means the TS roots
// and the circuit's roots are identical; a tampered witness must FAIL.
//
// Field boundary: tree digests are Fields in the circuit (PathStep.sibling,
// PoolEntry.poolRoot) and 32-byte LE images in TS; rootOfRoots stays Bytes<32>.
//
// The compiled contract lives in build/ (gitignored). Produce it with
//   pnpm --filter @mmr/contracts kat:build
// Tests skip when it is absent (CI hosts have no Compact toolchain).

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as rt from "@midnight-ntwrk/compact-runtime";
import {
  type Digest,
  type Hasher,
  IndexedMerkleTree,
  type Leaf,
  emptyLeaf,
  type PathStep,
  RootOfRoots,
  zeroMetrics,
} from "@mmr/merkle";
import { PoseidonHasher, digestToField } from "@mmr/merkle/poseidon";
import {
  type EngagementTerms, MAX_EPOCHS, ZERO_CARRY, carryStep, genesisCarry, type CarryTotals,
} from "@mmr/prover";
import {
  DEFAULT_CONFIG, type DepthBucketSample, type FlowWindowSample,
  commitDepth, commitFlow, openBand, openFlow,
} from "@mmr/indexer";

// KAT_EPOCH_BUILD overrides the compiled-contract dir (e.g. to test a draft circuit).
export const BUILD_DIR = process.env.KAT_EPOCH_BUILD
  ? `${process.env.KAT_EPOCH_BUILD}/contract/index.js`
  : fileURLToPath(new URL("../build/epoch_proof/contract/index.js", import.meta.url));
export const REG_BUILD_DIR = fileURLToPath(new URL("../build/registration/contract/index.js", import.meta.url));
export const BOND_BUILD_DIR = fileURLToPath(new URL("../build/bond/contract/index.js", import.meta.url));
export const HAVE_BUILD = existsSync(BUILD_DIR);
export const HAVE_REG_BUILD = existsSync(REG_BUILD_DIR);
export const HAVE_BOND_BUILD = existsSync(BOND_BUILD_DIR);

export const SLOTS = 16;
export const BUCKETS = 48;

// --- Witness shapes (mirror the generated index.d.ts) -----------------------

export interface SlotLeafW {
  addr: bigint; next_addr: bigint; is_protocol: boolean;
  base_start: bigint; base_end: bigint; quote_end: bigint;
  lp_base: bigint; lp_quote: bigint;
  xfer_in: bigint; xfer_out: bigint; from_treasury: bigint;
  swap_base_in: bigint; swap_base_out: bigint;
  swap_quote_in: bigint; swap_quote_out: bigint;
  depth_root: Uint8Array; flow_root: Uint8Array;
  present: boolean;
}

export interface TermsW {
  floor_price_P: bigint; loan_L0: bigint; quote_start_Q0: bigint;
  disposal_D: bigint; net_sell_S: bigint; depth_target: bigint;
  roundtrip_share_ppm: bigint; band_bps: bigint;
  min_uptime_buckets: bigint; epochs_total: bigint;
}

/** The harness terms as @mmr/prover EngagementTerms (for commitTerms / the oracle). */
export function termsToEngagement(t: TermsW): EngagementTerms {
  return {
    floorPriceP: t.floor_price_P, loanL0: t.loan_L0, quoteStartQ0: t.quote_start_Q0,
    disposalD: t.disposal_D, netSellS: t.net_sell_S, depthTarget: t.depth_target,
    roundtripSharePpm: t.roundtrip_share_ppm, bandBps: Number(t.band_bps),
    minUptimeBuckets: Number(t.min_uptime_buckets), epochsTotal: Number(t.epochs_total),
  };
}

export interface PathStepW { sibling: bigint; weAreRight: boolean }

/** M2(b): cumulative member transfer totals (circuit CarryTotals). */
export interface CarryTotalsW { xfer_in: bigint; xfer_out: bigint; from_treasury: bigint }
export const ZERO_CARRY_W: CarryTotalsW = { xfer_in: 0n, xfer_out: 0n, from_treasury: 0n };

export interface EpochWitness {
  committedWallets: bigint[];
  activeCount: bigint;
  walletSalt: Uint8Array;
  slotLeaves: SlotLeafW[];
  terms: TermsW;
  termsSalt: Uint8Array;
  bidMin: bigint[][];
  askMin: bigint[][];
  depthPaths: PathStepW[][];
  flowBuy: bigint[][];
  flowSell: bigint[][];
  slotPaths: PathStepW[][];
  poolEntry: { poolAddr: bigint; poolRoot: bigint };
  poolPath: PathStepW[];
  /** M2(b): previous cumulative totals + their salt, and the new commitment's salt. */
  carryPrev: CarryTotalsW;
  carryPrevSalt: Uint8Array;
  carryNewSalt: Uint8Array;
}

export function toSlotLeaf(leaf: Leaf, present: boolean): SlotLeafW {
  const m = leaf.metrics;
  return {
    addr: leaf.addr, next_addr: leaf.nextAddr, is_protocol: leaf.isProtocol,
    base_start: m.baseStart, base_end: m.baseEnd, quote_end: m.quoteEnd,
    lp_base: m.lpBase, lp_quote: m.lpQuote,
    xfer_in: m.xferIn, xfer_out: m.xferOut, from_treasury: m.fromTreasury,
    swap_base_in: m.swapBaseIn, swap_base_out: m.swapBaseOut,
    swap_quote_in: m.swapQuoteIn, swap_quote_out: m.swapQuoteOut,
    depth_root: leaf.depthRoot, flow_root: leaf.flowRoot,
    present,
  };
}

const FIELD_MODULUS = rt.MAX_FIELD + 1n;

/**
 * TS digest -> Field witness. A PoseidonHasher digest is canonical and converts
 * exactly (`Bytes<32> as Field`). A digest from another hasher can be >= the
 * modulus; it is reduced, as any prover would have to, so the wrong-hasher
 * cases reach the circuit's Merkle assert instead of failing in the harness.
 */
export function toField(d: Digest): bigint {
  let x = 0n;
  for (let i = d.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(d[i]!);
  return x < FIELD_MODULUS ? digestToField(d) : x % FIELD_MODULUS;
}

export const toPath = (p: readonly PathStep[]): PathStepW[] =>
  p.map((s) => ({ sibling: toField(s.sibling), weAreRight: s.weAreRight }));

const fill32 = (b: number): Digest => new Uint8Array(32).fill(b);
const zeroGrid = (): bigint[][] =>
  Array.from({ length: SLOTS }, () => new Array<bigint>(BUCKETS).fill(0n));

// --- Depth (H1) -----------------------------------------------------------------

/** The indexer's configured bands; the contracted band is BANDS[0] (terms.band_bps). */
export const BANDS = DEFAULT_CONFIG.bandsBps;
export const BAND = BANDS[0]!;
/** Depth-2 band-tree path for slots whose depth the circuit does not check. */
const ZERO_BAND_PATH: PathStepW[] = [0, 1].map(() => ({ sibling: 0n, weAreRight: false }));

/** Dense contracted-band series for one member wallet. */
export interface MemberDepth { bid: bigint[]; ask: bigint[] }
export const flatDepth = (v: bigint): MemberDepth =>
  ({ bid: new Array<bigint>(BUCKETS).fill(v), ask: new Array<bigint>(BUCKETS).fill(v) });

/**
 * Indexer depth samples for a member: the contracted band carries `d`; every other
 * band carries 2·d + 1, so opening the wrong band never matches by accident.
 */
export function depthSamples(d: MemberDepth): DepthBucketSample[] {
  return Array.from({ length: BUCKETS }, (_, bucket) => ({
    bucket,
    perBand: BANDS.map((bandBps) => bandBps === BAND
      ? { bandBps, minBid: d.bid[bucket]!, minAsk: d.ask[bucket]! }
      : { bandBps, minBid: 2n * d.bid[bucket]! + 1n, minAsk: 2n * d.ask[bucket]! + 1n }),
  }));
}

// --- Scenario -----------------------------------------------------------------

export const POOL = 0x00000000000000000000000000000000000000b2n;
export const WALLET_A = 0x1000000000000000000000000000000000000010n; // in the pool (membership)
export const WALLET_B = 0x2000000000000000000000000000000000000020n; // not in the pool (non-membership)
const OTHER_C = 0x3000000000000000000000000000000000000030n;
const OTHER_D = 0x4000000000000000000000000000000000000040n;

const extras = (n: number): bigint[] =>
  Array.from({ length: n }, (_, k) => 0x5000000000000000000000000000000000000000n + BigInt(k + 1));

export interface Scenario {
  hasher: Hasher;
  tree: IndexedMerkleTree;
  ror: RootOfRoots;
  rootOfRoots: Digest;
  witness: EpochWitness;
}

/**
 * One pool (depth-16 indexed tree) inside a root-of-roots (depth 10) with two
 * other pools. The engagement's active wallets are A (present in the pool) and
 * B (absent; proven by A as its low leaf). Slots 2..15 are padding (H2):
 * an empty, non-present leaf with an all-zero path that the circuit never checks.
 */
export function buildScenario(
  hasher: Hasher = new PoseidonHasher(),
  /** Extra active wallets (all present in the pool) after A and B; 14 fills all 16 slots. */
  extraMembers = 0,
  /** Overrides for wallet A's metrics; the tree is built from them, so openings stay valid. */
  walletA: Partial<Leaf["metrics"]> = {},
  /**
   * Contracted-band depth per MEMBER slot (0 = A, 2.. = extras), committed in that
   * wallet's depth_root (H1). Default: A carries the full target (10) in every
   * bucket; other members carry 0.
   */
  memberDepth: Partial<Record<number, MemberDepth>> = { 0: flatDepth(10n) },
  /** Hasher for depth_root / flow_root (H1, M1). Only PoseidonHasher matches the circuit. */
  commitHasher: Hasher = hasher,
  /** Flow windows per MEMBER slot (0 = A, 2.. = extras), committed in flow_root (M1). Default: none. */
  memberFlow: Partial<Record<number, FlowWindowSample[]>> = {},
  /** Hasher for flow_root only (defaults to commitHasher); isolates the M1 check in tests. */
  flowHasher: Hasher = commitHasher,
): Scenario {
  const flowOf = (slot: number): FlowWindowSample[] => memberFlow[slot] ?? [];
  const depthOf = (slot: number): MemberDepth => memberDepth[slot] ?? flatDepth(0n);
  // Member leaves (slot given) commit real depth/flow; other pool leaves get filler roots.
  const leaf = (addr: bigint, over: Partial<Leaf["metrics"]>, tag: number, slot?: number): Leaf => ({
    addr, nextAddr: 0n, isProtocol: false,
    metrics: { ...zeroMetrics(), ...over },
    depthRoot: slot === undefined ? fill32(tag) : commitDepth(commitHasher, depthSamples(depthOf(slot)), BANDS),
    flowRoot: slot === undefined ? fill32(tag + 1) : commitFlow(flowHasher, flowOf(slot)),
  });
  const tree = IndexedMerkleTree.build(hasher, [
    leaf(WALLET_A, { baseStart: 900n, baseEnd: 1_000n, quoteEnd: 5n, lpBase: 7n, lpQuote: 3n,
                     xferIn: 4n, xferOut: 2n, swapBaseIn: 50n, swapBaseOut: 60n,
                     swapQuoteIn: 120n, swapQuoteOut: 100n, ...walletA }, 0xa0, 0),
    leaf(OTHER_C, { baseEnd: 77n }, 0xc0),
    leaf(OTHER_D, { baseEnd: 88n, xferOut: 9n }, 0xd0),
    ...extras(extraMembers).map((a, k) => leaf(a, { baseEnd: BigInt(k + 1) }, 0xe0, k + 2)),
  ]);
  const ror = RootOfRoots.build(hasher, 7, [
    { poolAddr: 0xa1n, poolRoot: fill32(0x11) },
    { poolAddr: POOL, poolRoot: tree.root },
    { poolAddr: 0xc3n, poolRoot: fill32(0x33) },
  ]);
  const pool = ror.poolProof(POOL);

  const mem = tree.membershipProof(WALLET_A);
  const non = tree.nonMembershipProof(WALLET_B);
  const zeroPath: PathStep[] = Array.from({ length: 16 }, () => ({ sibling: fill32(0), weAreRight: false }));

  const active = [WALLET_A, WALLET_B, ...extras(extraMembers)];
  const committedWallets = new Array<bigint>(SLOTS).fill(0n);
  active.forEach((a, j) => { committedWallets[j] = a; });

  const slotLeaves: SlotLeafW[] = [];
  const slotPaths: PathStepW[][] = [];
  for (let j = 0; j < SLOTS; j++) {
    if (j === 0) { slotLeaves.push(toSlotLeaf(mem.leaf, true)); slotPaths.push(toPath(mem.path)); }
    else if (j === 1) { slotLeaves.push(toSlotLeaf(non.lowLeaf, false)); slotPaths.push(toPath(non.path)); }
    else if (j < active.length) {
      const p = tree.membershipProof(active[j]!);
      slotLeaves.push(toSlotLeaf(p.leaf, true)); slotPaths.push(toPath(p.path));
    }
    else { slotLeaves.push(toSlotLeaf(emptyLeaf(), false)); slotPaths.push(toPath(zeroPath)); }
  }

  // Depth (H1) + flow (M1): each member slot's dense series + its band opening against
  // depth_root; its full flow series (flow_root is that series' hash).
  const bidMin = zeroGrid();
  const askMin = zeroGrid();
  const flowBuy = zeroGrid();
  const flowSell = zeroGrid();
  const depthPaths = Array.from({ length: SLOTS }, () => ZERO_BAND_PATH);
  for (let j = 0; j < active.length; j++) {
    if (j === 1) continue; // B is not in the pool: no depth_root to open
    const d = depthOf(j);
    bidMin[j] = [...d.bid];
    askMin[j] = [...d.ask];
    depthPaths[j] = toPath(openBand(commitHasher, depthSamples(d), BANDS, BAND).path);
    const f = openFlow(flowOf(j));
    flowBuy[j] = f.buy;
    flowSell[j] = f.sell;
  }

  return {
    hasher, tree, ror, rootOfRoots: ror.root,
    witness: {
      committedWallets,
      activeCount: BigInt(active.length),
      walletSalt: fill32(0x5a),
      slotLeaves,
      terms: {
        floor_price_P: 2n, loan_L0: 1_000n, quote_start_Q0: 5n,
        disposal_D: 100n, net_sell_S: 100n, depth_target: 10n,
        roundtrip_share_ppm: 500_000n, band_bps: BigInt(BAND),
        min_uptime_buckets: 40n, epochs_total: 3n,
      },
      termsSalt: fill32(0x7e),
      carryPrev: { ...ZERO_CARRY_W }, carryPrevSalt: fill32(0), carryNewSalt: fill32(0xc1), // genesis
      bidMin, askMin, depthPaths, flowBuy, flowSell, slotPaths,
      poolEntry: { poolAddr: pool.poolAddr, poolRoot: toField(pool.poolRoot) },
      poolPath: toPath(pool.path),
    },
  };
}

/** Deep-ish clone so a test can tamper one field without touching the base. */
export function cloneWitness(w: EpochWitness): EpochWitness {
  return structuredClone(w);
}

// --- Circuit execution --------------------------------------------------------

export interface ProveResult {
  uptime: bigint;
  /** C2: disclosed commitments the caller checks against the registration ledger. */
  walletCommit: Uint8Array;
  termsCommit: Uint8Array;
  /** Ledger value written for this (id, epoch), read back from the new state. */
  ledgerUptime: bigint | undefined;
  /** M2(b): carryCommitment[id] after the call (undefined on a pre-M2(b) build). */
  carryCommitment: Uint8Array | undefined;
  /** Contract state after the call; pass to the next runProveEpoch to chain epochs. */
  state: rt.ChargedState;
}

const COIN_PK = "0".repeat(64);

/** A struct descriptor from (field, descriptor) pairs, as the compiler emits them. */
function structType<T extends object>(
  fields: readonly (readonly [keyof T & string, rt.CompactType<any>])[],
): rt.CompactType<T> {
  return {
    alignment: () => fields.flatMap(([, d]) => d.alignment()),
    toValue: (v: T) => fields.flatMap(([k, d]) => d.toValue((v as Record<string, unknown>)[k])),
    fromValue: () => { throw new Error("structType: fromValue unused"); },
  } as unknown as rt.CompactType<T>;
}
const U64 = new rt.CompactTypeUnsignedInteger((1n << 64n) - 1n, 8);
const U192 = new rt.CompactTypeUnsignedInteger((1n << 192n) - 1n, 24);
/** epoch_proof EpochRef { id: Bytes<32>, epoch: Uint<64> } — the epochUptime key preimage. */
const EPOCH_REF = structType<{ id: Uint8Array; epoch: bigint }>(
  [["id", new rt.CompactTypeBytes(32)], ["epoch", U64]]);
/** epoch_proof CarryTotals (M2(b)). */
export const CARRY_TOTALS = structType<CarryTotalsW>(
  [["xfer_in", U192], ["xfer_out", U192], ["from_treasury", U192]]);

export async function runProveEpoch(
  w: EpochWitness,
  id: Uint8Array,
  rootOfRoots: Uint8Array,
  epoch: bigint,
  /** Ledger state to run against (from a previous ProveResult); default a fresh contract. */
  state?: rt.ChargedState,
): Promise<ProveResult> {
  const mod = await import(BUILD_DIR);
  const witnesses = {
    committedWallets: (c: { privateState: unknown }) => [c.privateState, w.committedWallets],
    activeCount: (c: { privateState: unknown }) => [c.privateState, w.activeCount],
    walletSalt: (c: { privateState: unknown }) => [c.privateState, w.walletSalt],
    slotLeaves: (c: { privateState: unknown }) => [c.privateState, w.slotLeaves],
    terms: (c: { privateState: unknown }) => [c.privateState, w.terms],
    termsSalt: (c: { privateState: unknown }) => [c.privateState, w.termsSalt],
    bidMin: (c: { privateState: unknown }) => [c.privateState, w.bidMin],
    askMin: (c: { privateState: unknown }) => [c.privateState, w.askMin],
    depthPaths: (c: { privateState: unknown }) => [c.privateState, w.depthPaths],
    flowBuy: (c: { privateState: unknown }) => [c.privateState, w.flowBuy],
    flowSell: (c: { privateState: unknown }) => [c.privateState, w.flowSell],
    slotPaths: (c: { privateState: unknown }) => [c.privateState, w.slotPaths],
    poolEntry: (c: { privateState: unknown }) => [c.privateState, w.poolEntry],
    poolPath: (c: { privateState: unknown }) => [c.privateState, w.poolPath],
    carryPrev: (c: { privateState: unknown }) => [c.privateState, w.carryPrev],
    carryPrevSalt: (c: { privateState: unknown }) => [c.privateState, w.carryPrevSalt],
    carryNewSalt: (c: { privateState: unknown }) => [c.privateState, w.carryNewSalt],
    ...CLAIM_ONLY_WITNESSES,
  };
  const contract = new mod.Contract(witnesses);
  const res = contract.circuits.proveEpoch(freshContext(contract, state), id, rootOfRoots, epoch);
  const after = res.context.currentQueryContext.state as rt.ChargedState;
  const led = mod.ledger(after);
  const epochKey = rt.persistentHash(EPOCH_REF, { id, epoch });
  const ledgerUptime = led.epochUptime.member(epochKey) ? led.epochUptime.lookup(epochKey) as bigint : undefined;
  const out = res.result as { uptime: bigint; walletCommit: Uint8Array; termsCommit: Uint8Array };
  return {
    uptime: out.uptime, walletCommit: out.walletCommit, termsCommit: out.termsCommit, ledgerUptime,
    carryCommitment: led.carryCommitment?.member(id) ? led.carryCommitment.lookup(id) as Uint8Array : undefined,
    state: after,
  };
}

const unusedWitness = (name: string) => () => { throw new Error(`witness ${name} is claim-only`); };
const CLAIM_ONLY_WITNESSES = Object.fromEntries(
  ["engagementSecret", "profileSecret", "claimRecordPresent", "claimRecordPaths"].map((n) => [n, unusedWitness(n)]),
);

interface CompiledContract {
  initialState(ctx: unknown): { currentContractState: { data: rt.ChargedState }; currentPrivateState: unknown };
}

/** Default block time for circuits that read it (H3): 2023-11-14T22:13:20Z. */
export const BLOCK_TIME = 1_700_000_000n;

function freshContext(contract: CompiledContract, state?: rt.ChargedState, blockTime = BLOCK_TIME) {
  const init = contract.initialState(rt.createConstructorContext({}, COIN_PK));
  const ctx = rt.createCircuitContext(
    rt.dummyContractAddress(), COIN_PK, state ?? init.currentContractState.data, init.currentPrivateState,
  );
  // H3: the trusted "now" — what blockTimeLt/Gte compare against on-chain.
  ctx.currentQueryContext.block = { ...ctx.currentQueryContext.block, secondsSinceEpoch: blockTime };
  return ctx;
}

// --- registration.register ------------------------------------------------------

export interface Registered {
  id: Uint8Array;
  walletCommit: Uint8Array;
  termsCommit: Uint8Array;
  /** H3: registeredAt[id], the block-time-checked registration timestamp. */
  registeredAt: bigint;
}

/**
 * Execute the compiled registration.register with the engagement's wallets,
 * wallet salt, terms and terms salt, and read back what it stored on the ledger.
 */
export async function runRegister(
  w: Pick<EpochWitness, "committedWallets" | "walletSalt" | "terms" | "termsSalt">,
  engagementSecret: Uint8Array,
  /** H3: the timestamp to record, checked in-circuit against `blockTime`. */
  registeredTs: bigint = BLOCK_TIME,
  blockTime: bigint = BLOCK_TIME,
): Promise<Registered> {
  const mod = await import(REG_BUILD_DIR);
  const witnesses = {
    engagementSecret: (c: { privateState: unknown }) => [c.privateState, engagementSecret],
    walletVector: (c: { privateState: unknown }) => [c.privateState, w.committedWallets],
    walletSalt: (c: { privateState: unknown }) => [c.privateState, w.walletSalt],
    terms: (c: { privateState: unknown }) => [c.privateState, w.terms],
    termsSalt: (c: { privateState: unknown }) => [c.privateState, w.termsSalt],
  };
  const contract = new mod.Contract(witnesses);
  const res = contract.circuits.register(freshContext(contract, undefined, blockTime), 1n, registeredTs);
  const id = res.result as Uint8Array;
  const led = mod.ledger(res.context.currentQueryContext.state);
  return {
    id, walletCommit: led.walletCommit.lookup(id), termsCommit: led.termsCommit.lookup(id),
    registeredAt: led.registeredAt.lookup(id) as bigint,
  };
}

/**
 * The on-chain caller's C2 check: accept an epoch result only if its disclosed
 * commitments equal the ones registered for that engagement id.
 */
export function callerAccepts(reg: Registered, r: ProveResult): boolean {
  const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
  return eq(reg.walletCommit, r.walletCommit) && eq(reg.termsCommit, r.termsCommit);
}

// --- bond (H3: window gates read block time) ----------------------------------

export type BondGate = "releaseEpoch" | "voidUnfunded" | "defaultEngagement";

/**
 * Execute one of bond's time-gated circuits at `blockTime` (the trusted "now").
 * `anchor` is the gate's reference time (settledAt / registeredAt / deadline).
 */
export async function runBondGate(gate: BondGate, id: Uint8Array, anchor: bigint, blockTime: bigint): Promise<void> {
  const mod = await import(BOND_BUILD_DIR);
  const unused = () => { throw new Error("bond witness not used by time gates"); };
  const contract = new mod.Contract({ bondCoin: unused, bondSalt: unused });
  contract.circuits[gate](freshContext(contract, undefined, blockTime), id, anchor);
}

// --- H4: a run of proven epochs, then claim ----------------------------------------

/** epoch_proof EpochRecord (the epochRecords tree leaf). */
export interface EpochRecordW { id: Uint8Array; epoch: bigint; uptime: bigint; termsCommit: Uint8Array }
export const GENESIS_RECORD: EpochRecordW =
  { id: new Uint8Array(32), epoch: 0n, uptime: 0n, termsCommit: new Uint8Array(32) };

/**
 * Prove epochs 1..n for one engagement on one ledger, threading the M2(b) carry
 * commitment (carryStep with CompactHasher, as the KAT for M2(b) checks). Each
 * scenario supplies that epoch's witness + root; the terms/salts must be shared.
 */
export async function proveEpochs(
  scenarios: readonly Scenario[],
  id: Uint8Array,
  hasher: Hasher,
): Promise<{ state: rt.ChargedState; records: EpochRecordW[] }> {
  let state: rt.ChargedState | undefined;
  let prev: CarryTotals = ZERO_CARRY;
  let prevSalt = fill32(0);
  let prevCommitment = genesisCarry(hasher, prevSalt);
  const records: EpochRecordW[] = [];
  for (let k = 0; k < scenarios.length; k++) {
    const { witness, rootOfRoots } = scenarios[k]!;
    const epoch = BigInt(k + 1);
    const sums = memberTransferSums(witness);
    const newSalt = fill32(0xd0 + k);
    const step = carryStep(hasher, { prevCommitment, prevTotals: prev, prevSalt, epochSums: sums, newSalt,
                                     disposalD: witness.terms.disposal_D });
    const w = cloneWitness(witness);
    w.carryPrev = { xfer_in: prev.xferIn, xfer_out: prev.xferOut, from_treasury: prev.fromTreasury };
    w.carryPrevSalt = prevSalt;
    w.carryNewSalt = newSalt;
    const r = await runProveEpoch(w, id, rootOfRoots, epoch, state);
    records.push({ id, epoch, uptime: r.uptime, termsCommit: r.termsCommit });
    state = r.state; prev = step.newTotals; prevSalt = newSalt; prevCommitment = step.newCommitment;
  }
  return { state: state!, records };
}

/** Σ over member (present) slots of xfer_in / xfer_out / from_treasury — the circuit's I5 sums. */
function memberTransferSums(w: EpochWitness): CarryTotals {
  const m = w.slotLeaves.filter((l) => l.present);
  const sum = (f: (l: SlotLeafW) => bigint) => m.reduce((a, l) => a + f(l), 0n);
  return { xferIn: sum((l) => l.xfer_in), xferOut: sum((l) => l.xfer_out), fromTreasury: sum((l) => l.from_treasury) };
}

export interface ClaimArgs {
  engagementId: Uint8Array;
  engagementSecret: Uint8Array;
  profileSecret: Uint8Array;
  terms: TermsW;
  termsSalt: Uint8Array;
  /** Records the MM presents, by epoch (1-based); absent epochs get a genesis path. */
  present: ReadonlyMap<number, EpochRecordW>;
  epochsPassed: bigint;
  epochsTotal: bigint;
}

export interface ClaimResult {
  state: rt.ChargedState;
  completed: bigint;
  kpiHits: bigint;
  kpiTotal: bigint;
}

/** Execute epoch_proof.claim against `state`, building every path from the ledger itself. */
export async function runClaim(a: ClaimArgs, state: rt.ChargedState): Promise<ClaimResult> {
  const mod = await import(BUILD_DIR);
  const led = mod.ledger(state);
  const pathFor = (rec: EpochRecordW) => {
    const p = led.epochRecords.findPathForLeaf(rec);
    if (p === undefined) throw new Error(`record for epoch ${rec.epoch} is not on the ledger`);
    return p;
  };
  const genesis = pathFor(GENESIS_RECORD);
  const presentFlags: boolean[] = [];
  const paths: unknown[] = [];
  for (let e = 0; e < MAX_EPOCHS; e++) {
    const rec = a.present.get(e + 1);
    presentFlags.push(rec !== undefined);
    // a presented record not on the ledger gets a forged path (leaf swapped into a real one)
    paths.push(rec === undefined ? genesis : (led.epochRecords.findPathForLeaf(rec) ?? { ...genesis, leaf: rec }));
  }
  const wit = (v: unknown) => (c: { privateState: unknown }) => [c.privateState, v];
  const contract = new mod.Contract({
    ...Object.fromEntries(Object.keys(EPOCH_ONLY).map((k) => [k, unusedWitness(k)])),
    terms: wit(a.terms), termsSalt: wit(a.termsSalt),
    engagementSecret: wit(a.engagementSecret), profileSecret: wit(a.profileSecret),
    claimRecordPresent: wit(presentFlags), claimRecordPaths: wit(paths),
  });
  const res = contract.circuits.claim(freshContext(contract, state), a.engagementId, 1n, a.epochsPassed, a.epochsTotal);
  const after = res.context.currentQueryContext.state as rt.ChargedState;
  const l2 = mod.ledger(after);
  const pid = rt.persistentHash(new rt.CompactTypeBytes(32), a.profileSecret);
  return {
    state: after,
    completed: l2.completedCount.lookup(pid).read() as bigint,
    kpiHits: l2.kpiHits.lookup(pid).read() as bigint,
    kpiTotal: l2.kpiTotal.lookup(pid).read() as bigint,
  };
}

/** proveEpoch-only witnesses (stubbed when running claim). */
const EPOCH_ONLY = Object.fromEntries([
  "committedWallets", "activeCount", "walletSalt", "slotLeaves", "bidMin", "askMin", "depthPaths",
  "flowBuy", "flowSell", "slotPaths", "poolEntry", "poolPath", "carryPrev", "carryPrevSalt", "carryNewSalt",
].map((n) => [n, true]));
