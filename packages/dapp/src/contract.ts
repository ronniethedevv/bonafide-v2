// @mmr/dapp — Binding between the compiled epoch_proof module and its ZK assets.
//
// Midnight.js 5 takes a compact-js CompiledContract for a ledger 9 contract
// (compactc 0.36, runtime 0.21): make(tag, Contract).pipe(withWitnesses,
// withCompiledFileAssets). CompiledContract comes from the protocol package's
// v9 subpath, the copy Midnight.js itself compiles against.
//
// Witness values are carried in the private state rather than closed over, so
// the deploy (whose constructor needs none) and the call scripts can share one
// binding: each witness reads its slot and throws if a run left it unset. The
// shapes mirror packages/contracts/test/harness.ts, which assembles I1-I10.

import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/v9/compact-js";
import { Contract, type Witnesses } from "@mmr/contracts/epoch_proof";
import { Contract as BondToken } from "@mmr/contracts/test_bond_token";

/** Every witness epoch_proof declares, as optional private-state slots. */
export interface EpochProofPrivateState {
  committedWallets?: bigint[];
  activeCount?: bigint;
  walletSalt?: Uint8Array;
  slotLeaves?: unknown[];
  terms?: unknown;
  termsSalt?: Uint8Array;
  bidMin?: bigint[][];
  askMin?: bigint[][];
  depthPaths?: unknown[][];
  flowBuy?: bigint[][];
  flowSell?: bigint[][];
  slotPaths?: unknown[][];
  poolEntry?: unknown;
  poolPath?: unknown[];
  carryPrev?: unknown;
  carryPrevSalt?: Uint8Array;
  carryNewSalt?: Uint8Array;
  engagementSecret?: Uint8Array;
  profileSecret?: Uint8Array;
  claimRecordPresent?: boolean[];
  claimRecordPaths?: unknown[];
  bondCoin?: unknown;
  settleRecordPath?: unknown;
  /** The acting attester's secret for publishRoot (one member at a time). */
  attesterSecret?: Uint8Array;
}

/** The constructor reads no witnesses, so a deploy starts from empty slots. */
export const emptyPrivateState: EpochProofPrivateState = {};

export const PRIVATE_STATE_ID = "mmrEpochProofPrivateState";

type Slot = keyof EpochProofPrivateState;

/** Reads one slot, failing loudly rather than feeding a circuit a default. */
function slot<K extends Slot>(name: K) {
  return ({ privateState }: { privateState: EpochProofPrivateState }) => {
    const v = privateState[name];
    if (v === undefined) {
      throw new Error(
        `witness ${name} was not supplied for this circuit — populate it in the ` +
          `private state before calling (see packages/contracts/test/harness.ts).`,
      );
    }
    return [privateState, v] as [EpochProofPrivateState, never];
  };
}

const WITNESS_NAMES = [
  "committedWallets", "activeCount", "walletSalt", "slotLeaves", "terms", "termsSalt",
  "bidMin", "askMin", "depthPaths", "flowBuy", "flowSell", "slotPaths", "poolEntry",
  "poolPath", "carryPrev", "carryPrevSalt", "carryNewSalt", "engagementSecret",
  "profileSecret", "claimRecordPresent", "claimRecordPaths", "bondCoin",
  "settleRecordPath", "attesterSecret",
] as const satisfies readonly Slot[];

export const witnesses = Object.fromEntries(
  WITNESS_NAMES.map((n) => [n, slot(n)]),
) as unknown as Witnesses<EpochProofPrivateState>;

/**
 * The compiled contract bound to its witnesses and its on-disk ZK assets.
 * `zkConfigPath` is the directory holding keys/ and zkir/ — the same directory
 * NodeZkConfigProvider is pointed at.
 */
export function compiledEpochProof(zkConfigPath: string) {
  return CompiledContract.make<Contract<EpochProofPrivateState>>(
    "epoch_proof",
    Contract<EpochProofPrivateState>,
  ).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );
}

/**
 * The same binding with witnesses that read from `supply` (a value set by the caller
 * before each call), for scripts that hold their inputs in memory rather than in the
 * private-state store.
 */
export function compiledEpochProofFrom(zkConfigPath: string, supply: (name: Slot) => unknown) {
  const fromSupply = Object.fromEntries(
    WITNESS_NAMES.map((n) => [
      n,
      ({ privateState }: { privateState: EpochProofPrivateState }) => {
        const v = supply(n);
        if (v === undefined) throw new Error(`witness ${n} was not supplied for this call`);
        return [privateState, v];
      },
    ]),
  ) as unknown as Witnesses<EpochProofPrivateState>;
  return CompiledContract.make<Contract<EpochProofPrivateState>>("epoch_proof", Contract<EpochProofPrivateState>).pipe(
    CompiledContract.withWitnesses(fromSupply),
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );
}

/** The 12 circuit ids, for typing the ZK config provider. */
export type EpochProofCircuitId =
  | "register" | "postBond" | "activate" | "publishRoot" | "disputeRoot" | "proveFunding"
  | "proveEpoch" | "settleEpoch" | "releaseEpoch" | "voidUnfunded"
  | "defaultEngagement" | "claim";

/** The domain separator the test bond token mints under (test_bond_token.compact). */
export const BOND_TOKEN_DOMAIN = new Uint8Array(32);
BOND_TOKEN_DOMAIN.set(new TextEncoder().encode("mmr:bond:test"));

/** The test bond token (Preview only): no witnesses, its own ZK assets. */
export function compiledTestBondToken(zkConfigPath: string) {
  return CompiledContract.make<BondToken>("test_bond_token", BondToken).pipe(
    CompiledContract.withVacantWitnesses,
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );
}
