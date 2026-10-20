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

// KAT_EPOCH_BUILD overrides the compiled-contract dir (e.g. to test a draft circuit).
export const BUILD_DIR = process.env.KAT_EPOCH_BUILD
  ? `${process.env.KAT_EPOCH_BUILD}/contract/index.js`
  : fileURLToPath(new URL("../build/epoch_proof/contract/index.js", import.meta.url));
export const REG_BUILD_DIR = fileURLToPath(new URL("../build/registration/contract/index.js", import.meta.url));
export const HAVE_BUILD = existsSync(BUILD_DIR);
export const HAVE_REG_BUILD = existsSync(REG_BUILD_DIR);

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
}

export interface PathStepW { sibling: bigint; weAreRight: boolean }

export interface EpochWitness {
  committedWallets: bigint[];
  activeCount: bigint;
  walletSalt: Uint8Array;
  slotLeaves: SlotLeafW[];
  terms: TermsW;
  termsSalt: Uint8Array;
  bidMin: bigint[][];
  askMin: bigint[][];
  slotPaths: PathStepW[][];
  poolEntry: { poolAddr: bigint; poolRoot: bigint };
  poolPath: PathStepW[];
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
): Scenario {
  const leaf = (addr: bigint, over: Partial<Leaf["metrics"]>, tag: number): Leaf => ({
    addr, nextAddr: 0n, isProtocol: false,
    metrics: { ...zeroMetrics(), ...over },
    depthRoot: fill32(tag), flowRoot: fill32(tag + 1),
  });
  const tree = IndexedMerkleTree.build(hasher, [
    leaf(WALLET_A, { baseStart: 900n, baseEnd: 1_000n, quoteEnd: 5n, lpBase: 7n, lpQuote: 3n,
                     xferIn: 4n, xferOut: 2n, swapBaseIn: 50n, swapBaseOut: 60n,
                     swapQuoteIn: 120n, swapQuoteOut: 100n, ...walletA }, 0xa0),
    leaf(OTHER_C, { baseEnd: 77n }, 0xc0),
    leaf(OTHER_D, { baseEnd: 88n, xferOut: 9n }, 0xd0),
    ...extras(extraMembers).map((a, k) => leaf(a, { baseEnd: BigInt(k + 1) }, 0xe0)),
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

  // Depth: slot 0 carries the full target on both sides in every bucket.
  const bidMin = zeroGrid();
  const askMin = zeroGrid();
  bidMin[0]!.fill(10n);
  askMin[0]!.fill(10n);

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
        roundtrip_share_ppm: 500_000n, band_bps: 50n,
      },
      termsSalt: fill32(0x7e),
      bidMin, askMin, slotPaths,
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
}

const COIN_PK = "0".repeat(64);

export async function runProveEpoch(
  w: EpochWitness,
  id: Uint8Array,
  rootOfRoots: Uint8Array,
  epoch: bigint,
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
    slotPaths: (c: { privateState: unknown }) => [c.privateState, w.slotPaths],
    poolEntry: (c: { privateState: unknown }) => [c.privateState, w.poolEntry],
    poolPath: (c: { privateState: unknown }) => [c.privateState, w.poolPath],
  };
  const contract = new mod.Contract(witnesses);
  const res = contract.circuits.proveEpoch(freshContext(contract), id, rootOfRoots, epoch);
  const led = mod.ledger(res.context.currentQueryContext.state);
  let ledgerUptime: bigint | undefined;
  for (const [, v] of led.epochUptime) ledgerUptime = v as bigint;
  const out = res.result as { uptime: bigint; walletCommit: Uint8Array; termsCommit: Uint8Array };
  return { uptime: out.uptime, walletCommit: out.walletCommit, termsCommit: out.termsCommit, ledgerUptime };
}

interface CompiledContract {
  initialState(ctx: unknown): { currentContractState: { data: rt.ChargedState }; currentPrivateState: unknown };
}

function freshContext(contract: CompiledContract) {
  const init = contract.initialState(rt.createConstructorContext({}, COIN_PK));
  return rt.createCircuitContext(
    rt.dummyContractAddress(), COIN_PK, init.currentContractState.data, init.currentPrivateState,
  );
}

// --- registration.register ------------------------------------------------------

export interface Registered {
  id: Uint8Array;
  walletCommit: Uint8Array;
  termsCommit: Uint8Array;
}

/**
 * Execute the compiled registration.register with the engagement's wallets,
 * wallet salt, terms and terms salt, and read back what it stored on the ledger.
 */
export async function runRegister(
  w: Pick<EpochWitness, "committedWallets" | "walletSalt" | "terms" | "termsSalt">,
  engagementSecret: Uint8Array,
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
  const res = contract.circuits.register(freshContext(contract), 1n, 1_700_000_000n);
  const id = res.result as Uint8Array;
  const led = mod.ledger(res.context.currentQueryContext.state);
  return { id, walletCommit: led.walletCommit.lookup(id), termsCommit: led.termsCommit.lookup(id) };
}

/**
 * The on-chain caller's C2 check: accept an epoch result only if its disclosed
 * commitments equal the ones registered for that engagement id.
 */
export function callerAccepts(reg: Registered, r: ProveResult): boolean {
  const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
  return eq(reg.walletCommit, r.walletCommit) && eq(reg.termsCommit, r.termsCommit);
}
