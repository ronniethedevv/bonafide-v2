// Chain, storage, and attester boundaries.
//
// These interfaces isolate every non-deterministic / network dependency so the
// deterministic core (leaf computation, tree building, root-of-roots) is unit
// testable with in-memory fakes. The real implementations — a Base archive-RPC
// reader, an IPFS client, and a Jubjub-Schnorr attester committee — live behind
// these same interfaces and are NOT part of this build host's scope.

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

export interface ChainProvider {
  chainId(): number;
  finalizedBlock(): Promise<number>;
  /**
   * Pools of `baseTokens` (DD-21) whose active liquidity at `atBlock` is ≥ `floor`,
   * ascending by address. The caller passes `baseTokens` from config.
   */
  poolsAboveFloor(
    floor: bigint,
    atBlock: number,
    baseTokens: readonly string[],
  ): Promise<PoolDescriptor[]>;
  poolActivity(pool: PoolDescriptor, range: EpochRange): Promise<AddressActivity[]>;
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

export interface AttesterSignature {
  readonly attester: string;
  /** Jubjub-Schnorr signature over (epoch, rootOfRoots, cid). Hex. */
  readonly signature: string;
}

export interface AttesterCommittee {
  readonly threshold: number;
  readonly size: number;
  sign(epoch: number, rootOfRootsHex: string, cid: string): Promise<AttesterSignature[]>;
}
