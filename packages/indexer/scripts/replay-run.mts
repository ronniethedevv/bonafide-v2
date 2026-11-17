// Replay step 2: index real epochs for the selected pools with the production indexer.
//
// For each pool in .replay-data/selected.json and each 24h epoch in the replay window,
// run the real UniswapV3ChainProvider.poolActivity (history mode from the pool's creation
// block) and save every address's activity for that epoch to
// .replay-data/activity/<pool>/epoch-<n>.json. Already-saved epochs are skipped and every
// RPC response is cached on disk, so the run resumes after any interruption.
//
//   cd packages/indexer && BASE_ARCHIVE_RPC_URL=https://base-mainnet.g.alchemy.com/v2 \
//     npx tsx scripts/replay-run.mts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveChain } from "../src/chains.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { JsonRpcClient } from "../src/evm/rpc.js";
import { resolveEpochRange } from "../src/evm/range.js";
import { UniswapV3ChainProvider } from "../src/evm/provider.js";
import { rpcFetch } from "../src/live/proxy-fetch.js";
import { cachingFetch } from "../src/live/rpc-cache.js";

const DATA = resolve(import.meta.dirname, "../../../.replay-data");
const DAY = 86_400;

interface Selected {
  replayFrom: number; // unix seconds, 00:00 UTC
  epochs: number;
  pools: Array<{
    pool: string;
    createdBlock: number;
    base: { address: string; symbol: string; decimals: number };
    quote: { address: string; symbol: string; decimals: number };
  }>;
}

const sel = JSON.parse(readFileSync(join(DATA, "selected.json"), "utf8")) as Selected;
const chain = resolveChain(8453);
const url = process.env.BASE_ARCHIVE_RPC_URL ?? "https://base-mainnet.g.alchemy.com/v2";
const rpc = new JsonRpcClient({ url, fetchImpl: cachingFetch(rpcFetch(process.env), join(DATA, "rpc-cache")), retries: 40 });
const J = (x: unknown) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v));
const t0 = Date.now();
const log = (m: string) => console.log(`[replay +${((Date.now() - t0) / 60000).toFixed(1)}m] ${m}`);

const SEL_LIQ = "0x1a686502";
const params = { bucketSeconds: DEFAULT_CONFIG.bucketSeconds, bandsBps: DEFAULT_CONFIG.bandsBps, treasuryAddresses: [] as string[] };

await new UniswapV3ChainProvider(chain, rpc).assertChainId();

for (const p of sel.pools) {
  const dir = join(DATA, "activity", p.pool);
  mkdirSync(dir, { recursive: true });
  const [a, b] = [p.base.address, p.quote.address].map((x) => BigInt(x));
  const token0 = a! < b! ? a! : b!;
  const token1 = a! < b! ? b! : a!;
  for (let i = 0; i < sel.epochs; i++) {
    const file = join(dir, `epoch-${i + 1}.json`);
    if (existsSync(file)) {
      log(`${p.base.symbol}/${p.quote.symbol} epoch ${i + 1}: already saved`);
      continue;
    }
    const startTs = sel.replayFrom + i * DAY;
    const range = await resolveEpochRange(rpc, i + 1, startTs, startTs + DAY);
    const liq = await rpc.call(p.pool, SEL_LIQ, range.endBlock);
    const pool = { poolAddr: BigInt(p.pool), token0, token1, liquidity: BigInt(liq.slice(0, 66)), dex: "uniswap-v3" as const };
    const provider = new UniswapV3ChainProvider(chain, rpc, {
      historyFromBlock: p.createdBlock,
      onStage: (s) => log(`${p.base.symbol}/${p.quote.symbol} epoch ${i + 1}: ${s}`),
    });
    const activities = await provider.poolActivity(pool, range, params);
    writeFileSync(file, J({ pool: p, epoch: i + 1, range, activities }));
    const lps = activities.filter((x) => x.lpBase > 0n || x.lpQuote > 0n).length;
    log(`${p.base.symbol}/${p.quote.symbol} epoch ${i + 1}: saved ${activities.length} addresses (${lps} with LP positions)`);
  }
}
log("replay indexing complete");
