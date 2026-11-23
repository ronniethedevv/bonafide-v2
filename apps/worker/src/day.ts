// Pure helpers for the daily indexer: which day to index, and which tokens/chains are
// covered. Everything here comes from the clock or from public configuration, never from
// private engagement data.

export const DAY_SECONDS = 86_400;

/** Chains the indexer reads (read-only in v1): Base and Ethereum. */
export const SUPPORTED_CHAINS = [8453, 1] as const;

/** Index epochs are UTC days, numbered by unix day: startTs / 86400 (DD-32). */
export function dayWindow(day: number): { startTs: number; endTs: number } {
  if (!Number.isInteger(day) || day < 0) throw new Error(`bad day ${day}`);
  return { startTs: day * DAY_SECONDS, endTs: (day + 1) * DAY_SECONDS };
}

/** The last fully closed UTC day before `now`. */
export function previousDay(now: Date): number {
  return Math.floor(now.getTime() / 1000 / DAY_SECONDS) - 1;
}

/**
 * The last `n` closed UTC days before `now`, oldest first. Each run re-checks a few days
 * back, so a day missed by a failed or skipped run is picked up by the next one (stored
 * days are skipped at once).
 */
export function catchUpDays(now: Date, n: number): number[] {
  if (!Number.isInteger(n) || n < 1 || n > 14) throw new Error(`catch-up window must be 1..14 days, got ${n}`);
  const last = previousDay(now);
  return Array.from({ length: n }, (_, i) => last - (n - 1) + i);
}

/** Days to look back each run (MMR_CATCHUP_DAYS, default 3). */
export function catchUpWindow(env: Record<string, string | undefined>): number {
  const raw = env.MMR_CATCHUP_DAYS;
  return raw === undefined || raw === "" ? 3 : Number(raw);
}

/** "2026-11-16" for a unix day number. */
export function dayLabel(day: number): string {
  return new Date(day * DAY_SECONDS * 1000).toISOString().slice(0, 10);
}

/** Unix day number for "YYYY-MM-DD". */
export function dayFromDate(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`expected YYYY-MM-DD, got ${date}`);
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`bad date ${date}`);
  return ms / 1000 / DAY_SECONDS;
}

/** Comma-separated addresses → lowercase, validated, strictly ascending, deduplicated. */
export function addressList(raw: string | undefined, name: string): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const part of raw.split(",")) {
    const a = part.trim().toLowerCase();
    if (a === "") continue;
    if (!/^0x[0-9a-f]{40}$/.test(a)) throw new Error(`${name}: not an address: ${part.trim()}`);
    out.add(a);
  }
  return [...out].sort();
}

/** Base tokens whose pools are indexed on `chainId` (MMR_COVERAGE_<chainId>). */
export function coverage(env: Record<string, string | undefined>, chainId: number): string[] {
  return addressList(env[`MMR_COVERAGE_${chainId}`], `MMR_COVERAGE_${chainId}`);
}

/** Public loan-source addresses on `chainId` (MMR_TREASURY_<chainId>), optional. */
export function treasury(env: Record<string, string | undefined>, chainId: number): string[] {
  return addressList(env[`MMR_TREASURY_${chainId}`], `MMR_TREASURY_${chainId}`);
}

/** Pools to limit `chainId` to (MMR_POOLS_<chainId>), optional: every discovered pool when empty. */
export function poolAllowlist(env: Record<string, string | undefined>, chainId: number): string[] {
  return addressList(env[`MMR_POOLS_${chainId}`], `MMR_POOLS_${chainId}`);
}

/** The earliest day the catch-up window indexes (MMR_INDEX_FROM, YYYY-MM-DD), optional. */
export function indexFromDay(env: Record<string, string | undefined>): number | undefined {
  const raw = env.MMR_INDEX_FROM;
  return raw === undefined || raw.trim() === "" ? undefined : dayFromDate(raw.trim());
}

/** Supported chains that have at least one covered token. */
export function coveredChains(env: Record<string, string | undefined>): number[] {
  return SUPPORTED_CHAINS.filter((c) => coverage(env, c).length > 0);
}

/**
 * Blocks per eth_getLogs request. 10 on a free Alchemy key; a paid key takes thousands,
 * which turns a day of 0.2 s Base blocks from ~43k requests per scan into ~200.
 */
/**
 * RPC requests in flight for the log scan and the swap receipts (MMR_RPC_CONCURRENCY,
 * default 8). A rate-limited request is retried with backoff, so a value above the key's
 * capacity slows the scan rather than failing it.
 */
export function rpcConcurrency(env: Record<string, string | undefined>): number {
  const raw = env.MMR_RPC_CONCURRENCY;
  if (raw === undefined || raw === "") return 8;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 32) throw new Error(`MMR_RPC_CONCURRENCY must be 1..32, got ${raw}`);
  return n;
}

export function logChunkBlocks(env: Record<string, string | undefined>): number {
  const raw = env.MMR_LOG_CHUNK_BLOCKS;
  if (raw === undefined || raw === "") return 10;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100_000) throw new Error(`MMR_LOG_CHUNK_BLOCKS must be 1..100000, got ${raw}`);
  return n;
}
