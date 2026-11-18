// Replay step 1: find young project-token pools to replay.
//
// On a free archive-RPC plan eth_getLogs spans ≤ 10 blocks, so the indexer's position
// history (every Mint since a starting block) is only affordable for pools created shortly
// before the replay window. This scans the Uniswap v3 factory on Base for pools created in
// [DISCOVER_FROM, REPLAY_FROM), keeps those paired with USDC / USDbC / WETH, and ranks them
// by how much quote liquidity they still held at the start and end of the replay window.
//
//   cd packages/indexer && BASE_ARCHIVE_RPC_URL=https://base-mainnet.g.alchemy.com/v2 \
//     npx tsx scripts/replay-discover.mts
//
// The key is injected by the session's network proxy (never in the URL here). Every call
// is pinned to a historical block, so responses are cached on disk and a rerun resumes.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveChain } from "../src/chains.js";
import { JsonRpcClient } from "../src/evm/rpc.js";
import { resolveEpochRange } from "../src/evm/range.js";
import { getLogsChunked } from "../src/evm/logs.js";
import { TOPIC0, decodePoolCreated } from "../src/evm/abi.js";
import { rpcFetch } from "../src/live/proxy-fetch.js";
import { cachingFetch } from "../src/live/rpc-cache.js";
import { pacedFetch } from "./paced-fetch.mjs";

const DATA = resolve(import.meta.dirname, "../../../.replay-data");
// Base moved from 2 s to 0.2 s blocks around 2026-11-05/06; a day after that is ~432k
// blocks (10× the free-plan requests), so the replay stays before the switch.
const DISCOVER_FROM = Date.UTC(2026, 9, 17) / 1000; // 2026-10-17 00:00 UTC
const REPLAY_FROM = Date.UTC(2026, 9, 20) / 1000; //   2026-10-20 00:00 UTC
const REPLAY_TO = Date.UTC(2026, 9, 27) / 1000; //     2026-10-27 00:00 UTC (7 epochs)

const chain = resolveChain(8453);
const dex = chain.dexes[0]!;
const url = process.env.BASE_ARCHIVE_RPC_URL ?? "https://base-mainnet.g.alchemy.com/v2";
const rpc = new JsonRpcClient({ url, fetchImpl: cachingFetch(pacedFetch(rpcFetch(process.env), Number(process.env.MMR_RPS ?? 6)), join(DATA, "rpc-cache")), retries: 30 });

const QUOTES: Record<string, { symbol: string; decimals: number; min: bigint }> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6, min: 5_000n * 10n ** 6n },
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": { symbol: "USDbC", decimals: 6, min: 5_000n * 10n ** 6n },
  "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18, min: 2n * 10n ** 18n },
};

const SEL = { balanceOf: "0x70a08231", symbol: "0x95d89b41", decimals: "0x313ce567", liquidity: "0x1a686502" };
const word = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

async function callUint(to: string, data: string, block: number): Promise<bigint> {
  const r = await rpc.call(to, data, block);
  return r && r !== "0x" ? BigInt(r.slice(0, 66)) : 0n;
}
async function symbolOf(token: string, block: number): Promise<string> {
  try {
    const r = await rpc.call(token, SEL.symbol, block);
    const hex = r.replace(/^0x/, "");
    if (hex.length >= 192) {
      const len = Number(BigInt("0x" + hex.slice(64, 128)));
      return Buffer.from(hex.slice(128, 128 + len * 2), "hex").toString("utf8").replace(/[^\x20-\x7e]/g, "").slice(0, 20);
    }
    return Buffer.from(hex, "hex").toString("utf8").replace(/[^\x20-\x7e]/g, "").slice(0, 20);
  } catch {
    return "?";
  }
}

const t0 = Date.now();
const log = (m: string) => console.log(`[discover +${((Date.now() - t0) / 60000).toFixed(1)}m] ${m}`);

const disc = await resolveEpochRange(rpc, 0, DISCOVER_FROM, REPLAY_FROM);
const replay = await resolveEpochRange(rpc, 1, REPLAY_FROM, REPLAY_TO);
log(`discovery blocks ${disc.startBlock}–${disc.endBlock}; replay blocks ${replay.startBlock}–${replay.endBlock}`);

let lastPct = -1;
const logs = await getLogsChunked(
  rpc,
  { address: dex.factory, topics: [TOPIC0.poolCreated], fromBlock: disc.startBlock, toBlock: disc.endBlock },
  {
    concurrency: 2,
    onProgress: (d, n) => {
      const pct = Math.floor((d / n) * 100);
      if (pct % 5 === 0 && pct !== lastPct) {
        lastPct = pct;
        log(`factory scan ${pct}% (${d}/${n} requests)`);
      }
    },
  },
);
log(`${logs.length} pools created in the discovery window`);

const candidates = [];
for (const l of logs) {
  const ev = decodePoolCreated(l);
  const t0q = QUOTES[ev.token0.toLowerCase()];
  const t1q = QUOTES[ev.token1.toLowerCase()];
  if (!!t0q === !!t1q) continue; // need exactly one quote asset
  const quoteAddr = (t0q ? ev.token0 : ev.token1).toLowerCase();
  const baseAddr = (t0q ? ev.token1 : ev.token0).toLowerCase();
  const q = QUOTES[quoteAddr]!;
  const [qStart, qEnd, liqEnd] = await Promise.all([
    callUint(quoteAddr, SEL.balanceOf + word(ev.pool), replay.startBlock),
    callUint(quoteAddr, SEL.balanceOf + word(ev.pool), replay.endBlock),
    callUint(ev.pool, SEL.liquidity, replay.endBlock),
  ]);
  if (qStart < q.min || qEnd < q.min || liqEnd === 0n) continue;
  const [baseSymbol, baseDecimals] = await Promise.all([symbolOf(baseAddr, replay.endBlock), callUint(baseAddr, SEL.decimals, replay.endBlock)]);
  candidates.push({
    pool: ev.pool.toLowerCase(),
    fee: ev.fee,
    createdBlock: l.blockNumber,
    base: { address: baseAddr, symbol: baseSymbol, decimals: Number(baseDecimals) },
    quote: { address: quoteAddr, symbol: q.symbol, decimals: q.decimals },
    quoteInPoolAtStart: qStart.toString(),
    quoteInPoolAtEnd: qEnd.toString(),
  });
}
candidates.sort((a, b) => (BigInt(b.quoteInPoolAtEnd) > BigInt(a.quoteInPoolAtEnd) ? 1 : -1));
mkdirSync(DATA, { recursive: true });
writeFileSync(join(DATA, "candidates.json"), JSON.stringify({ discoverWindow: disc, replayWindow: replay, candidates }, null, 2));
log(`${candidates.length} candidates kept → .replay-data/candidates.json`);
for (const c of candidates.slice(0, 10)) {
  log(`  ${c.base.symbol}/${c.quote.symbol} fee ${c.fee} pool ${c.pool} created @${c.createdBlock} quote end ${c.quoteInPoolAtEnd}`);
}
