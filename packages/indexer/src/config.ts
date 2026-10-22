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
  /**
   * Spacing of spot-price samples inside the TWAP window, in seconds (DD-20). The
   * window [endTs − twapWindowSeconds, endTs] is sampled at every multiple of this
   * step from its start, endTs included; must divide twapWindowSeconds.
   */
  readonly priceSampleSeconds: number;
  /** Winsorization fraction trimmed from each tail of the price samples. */
  readonly winsorFraction: number;
  /** Anti-JIT: LP positions alive fewer than this many blocks get no depth credit. */
  readonly kMinBlocks: number;
  /** Only pools with liquidity at or above this floor are indexed. */
  readonly liquidityFloor: bigint;
  /**
   * Base tokens whose pools are indexed (DD-21): every pool of a base token against
   * each of the chain's quote assets, at every fee tier, found by factory.getPool.
   * Lowercase 0x addresses, strictly ascending (one canonical form per config).
   */
  readonly baseTokens: readonly string[];
  /** Only blocks at or before this finalized height are indexed. */
  readonly finalityConfirmations: number;
}

export const DEFAULT_CONFIG: IndexerConfig = {
  chainId: 8453,
  bandsBps: [50, 100, 200, 500],
  epochSeconds: 24 * 60 * 60,
  bucketSeconds: 30 * 60,
  twapWindowSeconds: 30 * 60,
  priceSampleSeconds: 60,
  winsorFraction: 0.05,
  kMinBlocks: 30,
  liquidityFloor: 0n,
  baseTokens: [],
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
  if (!Number.isInteger(cfg.twapWindowSeconds) || cfg.twapWindowSeconds <= 0 || cfg.twapWindowSeconds > cfg.epochSeconds) {
    throw new Error("twapWindowSeconds must be a positive integer no longer than the epoch");
  }
  if (!Number.isInteger(cfg.priceSampleSeconds) || cfg.priceSampleSeconds <= 0) {
    throw new Error("priceSampleSeconds must be a positive integer");
  }
  if (cfg.twapWindowSeconds % cfg.priceSampleSeconds !== 0) {
    throw new Error("twapWindowSeconds must be a whole number of price samples");
  }
  for (let i = 0; i < cfg.baseTokens.length; i++) {
    if (!/^0x[0-9a-f]{40}$/.test(cfg.baseTokens[i]!)) {
      throw new Error(`baseTokens must be lowercase 0x addresses: ${cfg.baseTokens[i]}`);
    }
    if (i > 0 && cfg.baseTokens[i]! <= cfg.baseTokens[i - 1]!) {
      throw new Error("baseTokens must be strictly ascending");
    }
  }
  if (cfg.winsorFraction < 0 || cfg.winsorFraction >= 0.5) {
    throw new Error("winsorFraction must be in [0, 0.5)");
  }
}

/** Number of time buckets per epoch. */
export function bucketsPerEpoch(cfg: IndexerConfig): number {
  return cfg.epochSeconds / cfg.bucketSeconds;
}

/** Spot-price sample times for an epoch's TWAP window (DD-20), ascending, endTs included. */
export function twapSampleTimes(cfg: IndexerConfig, endTs: number): number[] {
  const out: number[] = [];
  for (let t = endTs - cfg.twapWindowSeconds; t <= endTs; t += cfg.priceSampleSeconds) out.push(t);
  return out;
}
