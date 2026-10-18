// Deterministic indexer configuration.
//
// Every value here feeds root computation and MUST be fixed per epoch so that
// anyone with an archive RPC recomputes the same roots.

export interface IndexerConfig {
  /** Base chain id (8453 mainnet). */
  readonly chainId: number;
  /** Depth bands in basis points, committed in depth_root. Ascending, fixed. */
  readonly bandsBps: readonly number[];
  /** Epoch length in seconds (24h default). */
  readonly epochSeconds: number;
  /** Time-bucket length in seconds for uptime/depth sampling (30 min default). */
  readonly bucketSeconds: number;
  /** TWAP reference window in seconds (winsorized). */
  readonly twapWindowSeconds: number;
  /** Winsorization fraction trimmed from each tail of the price samples. */
  readonly winsorFraction: number;
  /** Anti-JIT: LP positions alive fewer than this many blocks get no depth credit. */
  readonly kMinBlocks: number;
  /** Only pools with liquidity at or above this floor are indexed. */
  readonly liquidityFloor: bigint;
  /** Only blocks at or before this finalized height are indexed. */
  readonly finalityConfirmations: number;
}

export const DEFAULT_CONFIG: IndexerConfig = {
  chainId: 8453,
  bandsBps: [50, 100, 200, 500],
  epochSeconds: 24 * 60 * 60,
  bucketSeconds: 30 * 60,
  twapWindowSeconds: 30 * 60,
  winsorFraction: 0.05,
  kMinBlocks: 30,
  liquidityFloor: 0n,
  finalityConfirmations: 1800, // well past Base L1 finality; tune per environment
};

export function assertConfig(cfg: IndexerConfig): void {
  if (cfg.bandsBps.length === 0) throw new Error("bandsBps must be non-empty");
  for (let i = 1; i < cfg.bandsBps.length; i++) {
    if (cfg.bandsBps[i]! <= cfg.bandsBps[i - 1]!) {
      throw new Error("bandsBps must be strictly ascending");
    }
  }
  if (cfg.epochSeconds % cfg.bucketSeconds !== 0) {
    throw new Error("epochSeconds must be a whole number of buckets");
  }
  if (cfg.winsorFraction < 0 || cfg.winsorFraction >= 0.5) {
    throw new Error("winsorFraction must be in [0, 0.5)");
  }
}

/** Number of time buckets per epoch. */
export function bucketsPerEpoch(cfg: IndexerConfig): number {
  return cfg.epochSeconds / cfg.bucketSeconds;
}
