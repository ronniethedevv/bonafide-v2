// Deterministic indexer configuration.
//
// Every value here feeds root computation and MUST be fixed per epoch so that
// anyone with an archive RPC recomputes the same roots.

export interface PoolDepthFloor {
  readonly bandBps: number;
  /** Lowercase quote-asset address -> minimum depth in raw quote units. */
  readonly minQuote: Readonly<Record<string, bigint>>;
}

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
  /**
   * Anti-JIT (DD-31): an LP whose position first went live fewer than this many seconds
   * before the epoch end (by block timestamp) gets no depth credit for the epoch. In
   * seconds, not blocks, so the rule survives block-time changes (Base went 2 s → 0.2 s).
   */
  readonly kMinSeconds: number;
  /**
   * Pool inclusion floor (DD-23): a pool is indexed when its quote-denominated depth
   * min(bid, ask) within ±bandBps, measured at the epoch's end block, is ≥ the floor
   * for its quote asset. Floors are per quote asset (raw quote units), so pools are
   * only ever compared in their own quote's units; a quote asset with no entry has
   * floor 0.
   */
  readonly poolDepthFloor: PoolDepthFloor;
  /**
   * Base tokens whose pools are indexed (DD-21): every pool of a base token against
   * each of the chain's quote assets, at every fee tier, found by factory.getPool.
   * Lowercase 0x addresses, strictly ascending (one canonical form per config).
   */
  readonly baseTokens: readonly string[];
  /**
   * Treasury / loan-source addresses: base inflows from them are `fromTreasury` (I5
   * excludes the loan from the outflow budget). Lowercase, strictly ascending.
   */
  readonly treasuryAddresses: readonly string[];
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
  kMinSeconds: 60, // = the former 30 blocks at Base's 2 s blocks (DD-31)
  poolDepthFloor: { bandBps: 200, minQuote: {} },
  baseTokens: [],
  treasuryAddresses: [],
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
  const f = cfg.poolDepthFloor;
  if (!Number.isInteger(f.bandBps) || f.bandBps <= 0 || f.bandBps >= 10_000) {
    throw new Error("poolDepthFloor.bandBps must be an integer in (0, 10000)");
  }
  for (const [q, v] of Object.entries(f.minQuote)) {
    if (!/^0x[0-9a-f]{40}$/.test(q)) throw new Error(`poolDepthFloor.minQuote keys must be lowercase addresses: ${q}`);
    if (v < 0n) throw new Error("poolDepthFloor.minQuote values must be non-negative");
  }
  for (const [name, list] of [["baseTokens", cfg.baseTokens], ["treasuryAddresses", cfg.treasuryAddresses]] as const) {
    for (let i = 0; i < list.length; i++) {
      if (!/^0x[0-9a-f]{40}$/.test(list[i]!)) throw new Error(`${name} must be lowercase 0x addresses: ${list[i]}`);
      if (i > 0 && list[i]! <= list[i - 1]!) throw new Error(`${name} must be strictly ascending`);
    }
  }
  if (cfg.winsorFraction < 0 || cfg.winsorFraction >= 0.5) {
    throw new Error("winsorFraction must be in [0, 0.5)");
  }
  if (!Number.isInteger(cfg.kMinSeconds) || cfg.kMinSeconds < 0 || cfg.kMinSeconds >= cfg.epochSeconds) {
    throw new Error("kMinSeconds must be an integer in [0, epochSeconds)");
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
