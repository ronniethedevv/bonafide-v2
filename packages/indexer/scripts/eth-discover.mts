// Discovery for a live Ethereum epoch (Unit 3, Ethereum cross-check): find a Uniswap v3
// pool *created shortly before* a chosen closed 24h epoch, priced by exactly one quote
// asset (USDC/USDT/WETH), that actually traded in the epoch. A freshly-created pool keeps
// the history-mode position scan (historyFromBlock = creation block) cheap on the Free
// tier — the same shape as the Base BROOMY/WETH milestone.
//
//   Run from packages/indexer:  npx tsx --env-file=../../.env scripts/eth-discover.mts
//   Env: MMR_EPOCH_DATE (default 2026-11-10), MMR_LOOKBACK_DAYS (default 2)
//
// Reads only; every call is cached under .rpc-cache so a re-run resumes.

import { resolveChain } from "../src/chains.js";
import { JsonRpcClient } from "../src/evm/rpc.js";
import { resolveEpochRange } from "../src/evm/range.js";
import { getLogsChunked } from "../src/evm/logs.js";
import { TOPIC0, decodePoolCreated } from "../src/evm/abi.js";
import { rpcFetch } from "../src/live/proxy-fetch.js";
import { cachingFetch } from "../src/live/rpc-cache.js";

const chain = resolveChain(1);
const factory = chain.dexes[0]!.factory;
const quotes = new Set(chain.quoteAssets.map((q) => q.toLowerCase()));
const quoteName: Record<string, string> = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT",
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETH",
};

const date = process.env.MMR_EPOCH_DATE ?? "2026-11-10";
const lookbackDays = Number(process.env.MMR_LOOKBACK_DAYS ?? 2);
const startTs = Date.parse(`${date}T00:00:00Z`) / 1000;
const endTs = startTs + 86400;

const env = process.env;
const url = env.ETH_ARCHIVE_RPC_URL!;
const fetchImpl = cachingFetch(rpcFetch(env), ".rpc-cache");
const rpc = new JsonRpcClient({ url, fetchImpl, retries: 20 });

const range = await resolveEpochRange(rpc, 1, startTs, endTs);
console.log("epoch", date, "range", JSON.stringify(range));

// 1. PoolCreated in the lookback window before the epoch start.
const dayBlocks = 7200; // ~12s blocks
const fromBlock = range.startBlock - lookbackDays * dayBlocks;
console.log(`scanning PoolCreated ${fromBlock}..${range.startBlock} (${lookbackDays}d, factory ${factory})`);
const createdLogs = await getLogsChunked(
  rpc,
  { address: [factory], topics: [[TOPIC0.poolCreated]], fromBlock, toBlock: range.startBlock },
  { chunkBlocks: 10, concurrency: 8, onProgress: (d, t) => { if (d % 200 === 0 || d === t) process.stdout.write(`\r  PoolCreated ${d}/${t}`); } },
);
process.stdout.write("\n");

type Cand = { pool: string; token0: string; token1: string; fee: number; base: string; quote: string; created: number };
const cands: Cand[] = [];
for (const l of createdLogs) {
  const e = decodePoolCreated(l);
  const t0 = e.token0.toLowerCase(), t1 = e.token1.toLowerCase();
  const q0 = quotes.has(t0), q1 = quotes.has(t1);
  if (q0 === q1) continue; // need exactly one quote asset
  cands.push({ pool: e.pool.toLowerCase(), token0: t0, token1: t1, fee: e.fee, base: q0 ? t1 : t0, quote: q0 ? t0 : t1, created: l.blockNumber });
}
console.log(`created in window: ${createdLogs.length}; single-quote candidates: ${cands.length}`);
if (cands.length === 0) { console.log("no candidates; widen MMR_LOOKBACK_DAYS or pick another date"); process.exit(0); }

// 2. Swap activity in the epoch, filtered to the candidate pools (one scan, address list).
const poolAddrs = cands.map((c) => c.pool);
console.log(`scanning Swap over epoch for ${poolAddrs.length} pools`);
const swapLogs = await getLogsChunked(
  rpc,
  { address: poolAddrs, topics: [[TOPIC0.swap]], fromBlock: range.startBlock + 1, toBlock: range.endBlock },
  { chunkBlocks: 10, concurrency: 8, onProgress: (d, t) => { if (d % 200 === 0 || d === t) process.stdout.write(`\r  Swap ${d}/${t}`); } },
);
process.stdout.write("\n");

const swapsByPool = new Map<string, number>();
for (const l of swapLogs) swapsByPool.set(l.address.toLowerCase(), (swapsByPool.get(l.address.toLowerCase()) ?? 0) + 1);

const traded = cands
  .map((c) => ({ ...c, swaps: swapsByPool.get(c.pool) ?? 0 }))
  .filter((c) => c.swaps > 0)
  .sort((a, b) => a.swaps - b.swaps);

console.log(`\ncandidates that traded in the epoch: ${traded.length}`);
for (const c of traded) {
  console.log(
    `  pool ${c.pool} fee ${c.fee} base ${c.base} quote ${quoteName[c.quote] ?? c.quote} created ${c.created} (${range.startBlock - c.created} blks before start) swaps ${c.swaps}`,
  );
}
console.log("\nretries", rpc.retriesTaken);
