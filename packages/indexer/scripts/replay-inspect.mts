// Replay helper: show every quote-paired pool from discovery with its quote balance at
// the start and end of the replay window and its swap count over a sample of the window,
// so the selection threshold can be set from what young pools actually hold.
//
//   cd packages/indexer && BASE_ARCHIVE_RPC_URL=https://base-mainnet.g.alchemy.com/v2 npx tsx scripts/replay-inspect.mts

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveChain } from "../src/chains.js";
import { JsonRpcClient } from "../src/evm/rpc.js";
import { getLogsChunked } from "../src/evm/logs.js";
import { TOPIC0, decodePoolCreated } from "../src/evm/abi.js";
import { rpcFetch } from "../src/live/proxy-fetch.js";
import { cachingFetch } from "../src/live/rpc-cache.js";
import { pacedFetch } from "./paced-fetch.mjs";

const DATA = resolve(import.meta.dirname, "../../../.replay-data");
const cand = JSON.parse(readFileSync(join(DATA, "candidates.json"), "utf8")) as {
  discoverWindow: { startBlock: number; endBlock: number };
  replayWindow: { startBlock: number; endBlock: number };
};
const chain = resolveChain(8453);
const rpc = new JsonRpcClient({
  url: process.env.BASE_ARCHIVE_RPC_URL ?? "https://base-mainnet.g.alchemy.com/v2",
  fetchImpl: cachingFetch(pacedFetch(rpcFetch(process.env), 6), join(DATA, "rpc-cache")),
  retries: 30,
});
const QUOTES: Record<string, [string, number]> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": ["USDC", 6],
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": ["USDbC", 6],
  "0x4200000000000000000000000000000000000006": ["WETH", 18],
};
const word = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const uint = async (to: string, data: string, b: number) => {
  const r = await rpc.call(to, data, b);
  return r && r !== "0x" ? BigInt(r.slice(0, 66)) : 0n;
};

const logs = await getLogsChunked(rpc, { address: chain.dexes[0]!.factory, topics: [TOPIC0.poolCreated], fromBlock: cand.discoverWindow.startBlock, toBlock: cand.discoverWindow.endBlock }, { concurrency: 2 });
const rows = [];
let noQuote = 0;
for (const l of logs) {
  const ev = decodePoolCreated(l);
  const q0 = QUOTES[ev.token0.toLowerCase()];
  const q1 = QUOTES[ev.token1.toLowerCase()];
  if (!!q0 === !!q1) {
    noQuote++;
    continue;
  }
  const qa = (q0 ? ev.token0 : ev.token1).toLowerCase();
  const [sym, dec] = QUOTES[qa]!;
  const [s, e, liq] = await Promise.all([
    uint(qa, "0x70a08231" + word(ev.pool), cand.replayWindow.startBlock),
    uint(qa, "0x70a08231" + word(ev.pool), cand.replayWindow.endBlock),
    uint(ev.pool, "0x1a686502", cand.replayWindow.endBlock),
  ]);
  rows.push({ pool: ev.pool, fee: ev.fee, sym, start: Number(s) / 10 ** dec, end: Number(e) / 10 ** dec, liqEnd: liq > 0n });
}
rows.sort((a, b) => b.end - a.end);
console.log(`${logs.length} pools; ${noQuote} not paired with exactly one of USDC/USDbC/WETH; ${rows.length} quote-paired`);
for (const r of rows.slice(0, 25)) {
  console.log(`${r.pool} fee ${String(r.fee).padStart(5)}  ${r.sym.padEnd(5)} start ${r.start.toFixed(4).padStart(12)}  end ${r.end.toFixed(4).padStart(12)}  in-range liquidity at end: ${r.liqEnd}`);
}
