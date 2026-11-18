// Replay helper: liquidity of established project-token Uniswap v3 pools on Base at the
// replay start (single eth_calls, no log scans), to size the options for a real replay.
//
//   cd packages/indexer && BASE_ARCHIVE_RPC_URL=https://base-mainnet.g.alchemy.com/v2 npx tsx scripts/replay-established.mts

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveChain } from "../src/chains.js";
import { JsonRpcClient } from "../src/evm/rpc.js";
import { rpcFetch } from "../src/live/proxy-fetch.js";
import { cachingFetch } from "../src/live/rpc-cache.js";
import { pacedFetch } from "./paced-fetch.mjs";

const DATA = resolve(import.meta.dirname, "../../../.replay-data");
const { replayWindow } = JSON.parse(readFileSync(join(DATA, "candidates.json"), "utf8")) as { replayWindow: { startBlock: number } };
const B = replayWindow.startBlock;
const chain = resolveChain(8453);
const rpc = new JsonRpcClient({
  url: process.env.BASE_ARCHIVE_RPC_URL ?? "https://base-mainnet.g.alchemy.com/v2",
  fetchImpl: cachingFetch(pacedFetch(rpcFetch(process.env), 6), join(DATA, "rpc-cache")),
  retries: 30,
});
const TOKENS = {
  DEGEN: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
  BRETT: "0x532f27101965dd16442e59d40670faf5ebb142e4",
  TOSHI: "0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4",
  AERO: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
  VIRTUAL: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
};
const QUOTES: Record<string, [string, number]> = {
  "0x4200000000000000000000000000000000000006": ["WETH", 18],
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": ["USDC", 6],
};
const w = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const call = (to: string, data: string) => rpc.call(to, data, B);
const symbol = async (t: string) => {
  const h = (await call(t, "0x95d89b41")).replace(/^0x/, "");
  const len = Number(BigInt("0x" + h.slice(64, 128)));
  return Buffer.from(h.slice(128, 128 + len * 2), "hex").toString("utf8");
};

console.log(`block ${B} (replay start)`);
for (const [name, token] of Object.entries(TOKENS)) {
  const sym = await symbol(token).catch(() => "?");
  for (const [quote, [qs, qd]] of Object.entries(QUOTES)) {
    for (const fee of [500, 3000, 10000]) {
      const r = await call(chain.dexes[0]!.factory, "0x1698ee82" + w(token) + w(quote) + fee.toString(16).padStart(64, "0"));
      const pool = "0x" + r.slice(-40);
      if (/^0x0{40}$/.test(pool)) continue;
      const bal = BigInt((await call(quote, "0x70a08231" + w(pool))).slice(0, 66));
      console.log(`${name.padEnd(8)} (${sym}) / ${qs.padEnd(4)} fee ${String(fee).padStart(5)}  pool ${pool}  ${qs} in pool: ${(Number(bal) / 10 ** qd).toFixed(2)}`);
    }
  }
}
