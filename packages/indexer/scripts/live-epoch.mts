// Live end-to-end epoch (Unit 3 milestone): real ChainProvider on Base, BROOMY/WETH 0.3%,
// epoch 2026-10-21 UTC; buildEpoch twice -> compare roots/manifests/trees; watcher recompute.
// Run from packages/indexer:  npx tsx --env-file=../../.env scripts/live-epoch.mts  (~40 min on Free tier)
// Expected root: 0x5a3a6373489512ce231856573012a90e45d2bc2720ce5538b92fc74af1d04461

import { writeFileSync } from "node:fs";
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
const POOL = 0xff3733f7469c034f774d3873c14e23a75345011an, CREATED = 52834921;
const BROOMY = "0x8d81043bc4bd37b43d7b244fda79d20c9c27603b";
const url = process.env.BASE_ARCHIVE_RPC_URL!;
const chain = resolveChain(8453);
const startTs = Date.UTC(2026, 9, 21) / 1000;
const range = await resolveEpochRange(new JsonRpcClient({ url, retries: 20 }), 1, startTs, startTs + 86400);
console.log("range", range);
const config = { ...DEFAULT_CONFIG, baseTokens: [BROOMY] };
const J = (x: unknown) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v));
async function run(tag: string) {
  const t = Date.now();
  const rpc = new JsonRpcClient({ url, retries: 20 });
  const inner = new UniswapV3ChainProvider(chain, rpc, { historyFromBlock: CREATED, concurrency: 3, receiptConcurrency: 3, onStage: (s) => console.log(" ", tag, "stage", s, ((Date.now() - t) / 60000).toFixed(1), "min") });
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
  return { res, trees, minutes: (Date.now() - t) / 60000 };
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
  pool: "0x" + POOL.toString(16), epoch: range.epoch, blocks: [range.startBlock, range.endBlock], endBlockHash: range.endBlockHash,
  rootA: a.res.manifest.rootOfRootsHex, rootB: b.res.manifest.rootOfRootsHex, sameRoot: a.res.manifest.rootOfRootsHex === b.res.manifest.rootOfRootsHex,
  manifestIdentical: J(a.res.manifest) === J(b.res.manifest), publishedTreeBytesIdentical: Buffer.compare(Buffer.from(treeA), Buffer.from(treeB)) === 0,
  watcherOnA: { ok: wA.ok, recomputed: wA.recomputedRootOfRootsHex, mismatched: wA.mismatchedPools }, watcherBtreesVsAroot: wB.ok,
  poolRoot: a.res.manifest.pools[0]?.rootHex, referencePrice: a.res.manifest.pools[0]?.referencePrice, leaves: leaves.length,
  leavesWithSwaps: leaves.filter((l: any) => l.metrics.swapBaseIn !== "0" || l.metrics.swapBaseOut !== "0").length,
  leavesWithLp: leaves.filter((l: any) => l.metrics.lpBase !== "0" || l.metrics.lpQuote !== "0").length,
  protocolLeaves: leaves.filter((l: any) => l.isProtocol).length, minutes: [a.minutes.toFixed(1), b.minutes.toFixed(1)],
};
writeFileSync("live-epoch-manifest.json", J(a.res.manifest));
writeFileSync("live-epoch-tree.json", Buffer.from(treeA));
console.log(JSON.stringify(summary, null, 1));
