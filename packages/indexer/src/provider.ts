// Chain, storage, and attester boundaries.
//
// These interfaces isolate every non-deterministic / network dependency so the
// deterministic core (leaf computation, tree building, root-of-roots) is unit
// testable with in-memory fakes. The real implementations — a Base archive-RPC
// reader, an IPFS client, and a Jubjub-Schnorr attester committee — live behind
// these same interfaces and are NOT part of this build host's scope.

import type { PoolDepthFloor } from "./config.js";

export interface PoolDescriptor {
  readonly poolAddr: bigint;
  readonly token0: bigint;
  readonly token1: bigint;
  /** Active liquidity used for the floor check. */
  readonly liquidity: bigint;
  readonly dex: "uniswap-v3" | "aerodrome-slipstream";
}

/** Per-band minimum depth this address held during one time bucket. */
export interface DepthBucketSample {
  readonly bucket: number;
  readonly perBand: ReadonlyArray<{
    readonly bandBps: number;
    readonly minBid: bigint;
    readonly minAsk: bigint;
  }>;
}

export interface FlowWindowSample {
  readonly window: number;
  readonly buy: bigint;
  readonly sell: bigint;
}

/**
 * Parsed per-address activity for one pool over one epoch. Amounts are raw,
 * unsigned, exactly as emitted on chain; the leaf builder derives the schema
 * fields and commitments from these without further interpretation.
 */
export interface AddressActivity {
  readonly addr: bigint;
  readonly isProtocol: boolean;
  readonly baseStart: bigint;
  readonly baseEnd: bigint;
  readonly quoteEnd: bigint;
  readonly lpBase: bigint;
  readonly lpQuote: bigint;
  readonly xferIn: bigint;
  readonly xferOut: bigint;
  readonly fromTreasury: bigint;
  readonly swapBaseIn: bigint;
  readonly swapBaseOut: bigint;
  readonly swapQuoteIn: bigint;
  readonly swapQuoteOut: bigint;
  readonly depthBuckets: readonly DepthBucketSample[];
  readonly flowWindows: readonly FlowWindowSample[];
  /** Block at which this address's LP position first became active (anti-JIT). */
  readonly lpFirstActiveBlock: number | null;
}

export interface PriceSample {
  /** Unix seconds. */
  readonly ts: number;
  /** Pool spot price at `ts`, replayed from pool state (fixed-point, unsigned). */
  readonly price: bigint;
}

export interface EpochRange {
  readonly epoch: number;
  readonly startBlock: number;
  readonly endBlock: number;
  /** End-block hash pins the range so the root is recomputable. */
  readonly endBlockHash: string;
  readonly startTs: number;
  readonly endTs: number;
}

export interface ActivityParams {
  readonly bucketSeconds: number;
  readonly bandsBps: readonly number[];
  readonly treasuryAddresses: readonly string[];
}

export interface ChainProvider {
  chainId(): number;
  finalizedBlock(): Promise<number>;
  /**
   * Pools of `baseTokens` (DD-21) whose quote-denominated depth at `atBlock` meets the
   * floor for their quote asset (DD-23), ascending by address. The caller passes
   * `floor` and `baseTokens` from config.
   */
  poolsAboveFloor(
    floor: PoolDepthFloor,
    atBlock: number,
    baseTokens: readonly string[],
  ): Promise<PoolDescriptor[]>;
  /** Per-address activity for one pool over one epoch; `params` come from config. */
  poolActivity(pool: PoolDescriptor, range: EpochRange, params: ActivityParams): Promise<AddressActivity[]>;
  /**
   * Spot price at each of `times` (ascending unix seconds inside the range), replayed
   * from pool state. The caller derives `times` from config (`twapSampleTimes`), so the
   * schedule — and the reference price — is fixed by the committed config, not the
   * provider.
   */
  poolPriceSamples(
    pool: PoolDescriptor,
    range: EpochRange,
    times: readonly number[],
  ): Promise<PriceSample[]>;
}

/** Content-addressed store. The full tree is published before its root is signed. */
export interface TreePublisher {
  /** Returns the content id (CID) for the published bytes. */
  publish(bytes: Uint8Array): Promise<string>;
}

/** One committee member's vote: its own publishRoot transaction (I8, DD-26). */
export interface AttesterVote {
  /** The member's attesterId (hex), as stored in the contract's committee set. */
  readonly attester: string;
}

/**
 * The attester committee (I8, DD-26: Option B). Each online member submits
 * publishRoot(epoch, rootOfRoots, cid) in its own transaction; the contract counts
 * distinct members and publishes the root at the threshold (2 of 3).
 */
export interface AttesterCommittee {
  readonly threshold: number;
  readonly size: number;
  publishRoot(epoch: number, rootOfRootsHex: string, cid: string): Promise<AttesterVote[]>;
}
