// Live end-to-end epoch on ETHEREUM (Unit 3 cross-chain check): real ChainProvider on
// Ethereum mainnet, a single freshly-created Uniswap v3 pool, epoch 2026-11-10 UTC.
// buildEpoch twice over independent providers/publishers -> compare roots/manifests/trees;
// the watcher recomputes the attested root from the published tree. Same shape as the Base
// BROOMY/WETH milestone (scripts/live-epoch.mts), proving the reader on a second chain.
//
//   Run from packages/indexer:  npx tsx scripts/eth-epoch.mts
//   Transport is proxy-aware + cached (.rpc-cache), so it runs from a proxied cloud
//   session and resumes after a dropped connection.
//
// Pool chosen by scripts/eth-discover.mts: of the pools created in the 2 days before the
// epoch and quoted by exactly one asset, this was the most active in the epoch (89 swaps).

import { writeFileSync, mkdirSync } from "node:fs";
import { resolveChain } from "../src/chains.js";
import { JsonRpcClient } from "../src/evm/rpc.js";
import { UniswapV3ChainProvider } from "../src/evm/provider.js";
import { resolveEpochRange } from "../src/evm/range.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { buildEpoch, InMemoryPublisher } from "../src/epoch.js";
import type { ChainProvider } from "../src/provider.js";
import { parseAddr } from "@mmr/merkle";
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import { verifyEpoch } from "../../watcher/src/index.js";
import { rpcFetch } from "../src/live/proxy-fetch.js";
import { cachingFetch } from "../src/live/rpc-cache.js";

const POOL = 0x1de81afe8460edd06be81bea9596498fbd31e2c9n, CREATED = 26372841;
const BASE = "0x6af9b9f049062df14e3df99e042653b656666666"; // quote USDT, fee 500
const chain = resolveChain(1);
const env = process.env;
const url = env.ETH_ARCHIVE_RPC_URL!;
const fetchImpl = cachingFetch(rpcFetch(env), ".rpc-cache");
const startTs = Date.UTC(2026, 10, 10) / 1000; // 2026-11-10 00:00 UTC
const outDir = env.MMR_OUT_DIR ?? ".";
const range = await resolveEpochRange(new JsonRpcClient({ url, fetchImpl, retries: 20 }), 1, startTs, startTs + 86400);
console.log("range", JSON.stringify(range));
const config = { ...DEFAULT_CONFIG, chainId: 1, baseTokens: [BASE] };
const J = (x: unknown) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v));

async function run(tag: string) {
  const t = Date.now();
  const rpc = new JsonRpcClient({ url, fetchImpl, retries: 20 });
  const inner = new UniswapV3ChainProvider(chain, rpc, {
    historyFromBlock: CREATED, concurrency: 3, receiptConcurrency: 3,
    onStage: (s) => console.log(" ", tag, "stage", s, ((Date.now() - t) / 60000).toFixed(1), "min"),
  });
  const discovered: string[] = [];
  // one-pool milestone: real discovery, narrowed to the chosen pool
  const provider: ChainProvider = {
    chainId: () => inner.chainId(),
    finalizedBlock: () => inner.finalizedBlock(),
    poolsAboveFloor: async (f, b, bt) => { const all = await inner.poolsAboveFloor(f, b, bt); discovered.push(...all.map((p) => "0x" + p.poolAddr.toString(16))); return all.filter((p) => p.poolAddr === POOL); },
    poolActivity: (p, r, params) => inner.poolActivity(p, r, params),
    poolPriceSamples: (p, r, times) => inner.poolPriceSamples(p, r, times),
  };
  const publisher = new InMemoryPublisher();
  const res = await buildEpoch({ provider, publisher }, config, range);
  const trees = new Map<bigint, Uint8Array>();
  for (const p of res.manifest.pools) trees.set(parseAddr(p.poolAddr), publisher.get(p.cid)!);
  console.log(" ", tag, "done", ((Date.now() - t) / 60000).toFixed(1), "min, rpc retries", rpc.retriesTaken, "| discovered", discovered);
  return { res, trees };
}

const a = await run("A");
const b = await run("B");
const treeA = [...a.trees.values()][0]!, treeB = [...b.trees.values()][0]!;
const doc = JSON.parse(new TextDecoder().decode(treeA));
const leaves = doc.leaves.filter((l: any) => l.addr !== "0");
const hasher = new PoseidonHasher();
const wA = verifyEpoch(hasher, range.epoch, a.trees, a.res.manifest.rootOfRootsHex);
const wB = verifyEpoch(hasher, range.epoch, b.trees, a.res.manifest.rootOfRootsHex);
const summary = {
  chain: "ethereum", pool: "0x" + POOL.toString(16), epoch: range.epoch, blocks: [range.startBlock, range.endBlock], endBlockHash: range.endBlockHash,
  rootA: a.res.manifest.rootOfRootsHex, rootB: b.res.manifest.rootOfRootsHex, sameRoot: a.res.manifest.rootOfRootsHex === b.res.manifest.rootOfRootsHex,
  manifestIdentical: J(a.res.manifest) === J(b.res.manifest), publishedTreeBytesIdentical: Buffer.compare(Buffer.from(treeA), Buffer.from(treeB)) === 0,
  watcherOnA: { ok: wA.ok, recomputed: wA.recomputedRootOfRootsHex, mismatched: wA.mismatchedPools }, watcherBtreesVsAroot: wB.ok,
  poolRoot: a.res.manifest.pools[0]?.rootHex, referencePrice: a.res.manifest.pools[0]?.referencePrice, leaves: leaves.length,
  leavesWithSwaps: leaves.filter((l: any) => l.metrics.swapBaseIn !== "0" || l.metrics.swapBaseOut !== "0").length,
  leavesWithLp: leaves.filter((l: any) => l.metrics.lpBase !== "0" || l.metrics.lpQuote !== "0").length,
  protocolLeaves: leaves.filter((l: any) => l.isProtocol).length,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/manifest.json`, J(a.res.manifest));
writeFileSync(`${outDir}/pool-tree.json`, Buffer.from(treeA));
console.log(JSON.stringify(summary, null, 1));
