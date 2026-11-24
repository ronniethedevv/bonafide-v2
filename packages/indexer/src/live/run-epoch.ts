// Live archive-RPC epoch runner.
//
// Drives the full deterministic pipeline (packages/indexer/src/epoch.ts) against a live
// archive RPC for one pool set + one closed 24h epoch on one chain, runs it twice over
// independent publishers, and confirms the root-of-roots is byte-identical (invariant
// #4, determinism). Prints the root + per-pool summary and, with MMR_OUT, writes the
// manifest as a reproducible fixture.
//
// Transport is proxy-aware (proxy-fetch.ts), so this runs from a host with direct egress
// (a laptop) or from a proxied cloud session — the only external requirement is a valid
// archive-RPC URL in the chain's env var (BASE_ARCHIVE_RPC_URL / ETH_ARCHIVE_RPC_URL).
//
// Nothing here is mocked: every number comes from the chain. With no env overrides it
// reproduces the committed Base epoch (BROOMY/WETH 0.3%, 2026-10-21), whose root is
// pinned in packages/watcher/fixtures and in DEMO.md.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolveChain } from "../chains.js";
import { JsonRpcClient, routeLogs } from "../evm/rpc.js";
import { UniswapV3ChainProvider } from "../evm/provider.js";
import { resolveEpochRange } from "../evm/range.js";
import { buildEpoch, InMemoryPublisher, type EpochManifest } from "../epoch.js";
import { DEFAULT_CONFIG, type IndexerConfig } from "../config.js";
import type { ChainProvider, EpochRange, TreePublisher } from "../provider.js";
import type { ActivityOptions } from "../evm/activity.js";
import { rpcFetch } from "./proxy-fetch.js";
import { cachingFetch } from "./rpc-cache.js";

export interface RunResult {
  /** The root-of-roots, as published on-chain by the attester committee. */
  readonly rootHex: string;
  /** buildEpoch twice over independent publishers produced the same root (invariant #4). */
  readonly identical: boolean;
  readonly manifest: EpochManifest;
  /** Manifest content id from the first run's publisher (an IPFS CID with Pinata). */
  readonly manifestCid: string;
}

/**
 * Run the deterministic pipeline twice and confirm the root is byte-identical. The
 * provider is injected, so this is unit-tested with a fake and no network.
 */
export async function runEpochTwice(
  provider: ChainProvider,
  config: IndexerConfig,
  range: EpochRange,
  publisher: TreePublisher = new InMemoryPublisher(),
  beforeSecond: () => void = () => {},
): Promise<RunResult> {
  // The first run publishes (IPFS in production); the second recomputes in memory.
  const first = await buildEpoch({ provider, publisher }, config, range);
  beforeSecond();
  const second = await buildEpoch({ provider, publisher: new InMemoryPublisher() }, config, range);
  const identical = first.manifest.rootOfRootsHex === second.manifest.rootOfRootsHex;
  if (!identical) {
    throw new Error(
      `non-deterministic root: ${first.manifest.rootOfRootsHex} != ${second.manifest.rootOfRootsHex}`,
    );
  }
  return { rootHex: first.manifest.rootOfRootsHex, identical, manifest: first.manifest, manifestCid: first.manifestCid };
}

export interface LiveEpochOptions {
  readonly chainId: number;
  readonly epoch: number;
  readonly startTs: number;
  readonly endTs: number;
  readonly baseTokens: readonly string[];
  readonly treasuryAddresses?: readonly string[];
  readonly configOverrides?: Partial<IndexerConfig>;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
  /** Persistent RPC cache directory; set to make a dropped run resumable. */
  readonly cacheDir?: string;
  /** Per-call retry budget for transient failures (default 10). */
  readonly retries?: number;
  /** Publisher for the first run's trees and manifest (default in-memory). */
  readonly publisher?: TreePublisher;
  /** Log-scan and position options: chunkBlocks (10 on a free key), registryPath, onStage. */
  readonly activity?: ActivityOptions;
}

/**
 * Build a live, proxy-aware provider, pin the epoch range from real blocks, and run the
 * pipeline twice. Hits the network; not unit-tested (the KAT fixtures cover the output).
 */
export async function runLiveEpoch(opts: LiveEpochOptions): Promise<RunResult> {
  const cfg = resolveChain(opts.chainId);
  const env = opts.env ?? process.env;
  const url = env[cfg.rpcEnvVar];
  if (!url) throw new Error(`${cfg.rpcEnvVar} is not set (archive RPC url for ${cfg.name})`);
  const baseFetch = rpcFetch(env);
  const fetchImpl = opts.cacheDir ? cachingFetch(baseFetch, opts.cacheDir) : baseFetch;
  const client = (u: string): JsonRpcClient =>
    new JsonRpcClient({
      url: u,
      fetchImpl,
      retries: opts.retries ?? 10,
      ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    });
  const archive = client(url);
  // A wide-range log endpoint, when set, serves eth_getLogs only (same cache, same chain).
  const logsUrl = env[cfg.logsRpcEnvVar];
  const logs = logsUrl ? client(logsUrl) : undefined;
  if (logs && (await logs.chainId()) !== cfg.chainId) throw new Error(`${cfg.logsRpcEnvVar} is not chain ${cfg.chainId}`);
  const rpc = logs ? routeLogs(archive, logs) : archive;
  const provider = new UniswapV3ChainProvider(cfg, rpc, opts.activity ?? {});
  await provider.assertChainId();
  const range = await resolveEpochRange(rpc, opts.epoch, opts.startTs, opts.endTs);
  const config: IndexerConfig = {
    ...DEFAULT_CONFIG,
    chainId: opts.chainId,
    baseTokens: opts.baseTokens,
    treasuryAddresses: opts.treasuryAddresses ?? [],
    ...opts.configOverrides,
  };
  // Both runs start from the same position registry: the first run saves one scanned to the
  // day's end, which the second would otherwise discard and rebuild from every NFT id.
  const registryPath = opts.activity?.registryPath;
  return runEpochTwice(provider, config, range, opts.publisher, registryPath ? snapshotFile(registryPath) : undefined);
}

/**
 * Remember a file as it is now and return a function that puts it back: the same bytes, or
 * no file if there was none.
 */
export function snapshotFile(path: string): () => void {
  const saved = existsSync(path) ? readFileSync(path) : undefined;
  return () => {
    if (saved === undefined) rmSync(path, { force: true });
    else writeFileSync(path, saved);
  };
}

// --- CLI -----------------------------------------------------------------------------

/** The committed Base cross-check epoch; the default when no env overrides are given. */
const BROOMY_WETH_EPOCH: LiveEpochOptions = {
  chainId: 8453,
  epoch: 1,
  startTs: Date.UTC(2026, 9, 21, 0, 0, 0) / 1000, // 2026-10-21 00:00 UTC
  endTs: Date.UTC(2026, 9, 22, 0, 0, 0) / 1000, // +24h
  baseTokens: ["0x8d81043bc4bd37b43d7b244fda79d20c9c27603b"],
  treasuryAddresses: [],
};

function csv(v: string | undefined): readonly string[] | undefined {
  if (v === undefined) return undefined;
  return v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function optionsFromEnv(env: Record<string, string | undefined>): LiveEpochOptions {
  const base = csv(env.MMR_BASE_TOKENS);
  const chainId = env.MMR_CHAIN_ID ? Number(env.MMR_CHAIN_ID) : BROOMY_WETH_EPOCH.chainId;
  // Default to the committed Base reproduction unless an epoch window is given.
  if (!env.MMR_EPOCH_DATE && !env.MMR_START_TS) {
    return base ? { ...BROOMY_WETH_EPOCH, chainId, baseTokens: base } : BROOMY_WETH_EPOCH;
  }
  const epochSeconds = DEFAULT_CONFIG.epochSeconds;
  let startTs: number;
  let endTs: number;
  if (env.MMR_START_TS) {
    startTs = Number(env.MMR_START_TS);
    endTs = env.MMR_END_TS ? Number(env.MMR_END_TS) : startTs + epochSeconds;
  } else {
    startTs = Date.parse(`${env.MMR_EPOCH_DATE}T00:00:00Z`) / 1000;
    endTs = startTs + epochSeconds;
  }
  if (!base) throw new Error("MMR_BASE_TOKENS is required with a custom epoch window");
  return {
    chainId,
    epoch: env.MMR_EPOCH ? Number(env.MMR_EPOCH) : 1,
    startTs,
    endTs,
    baseTokens: base,
    treasuryAddresses: csv(env.MMR_TREASURY) ?? [],
  };
}

async function main(): Promise<void> {
  const env = process.env;
  const cacheDir = env.MMR_CACHE_DIR ?? ".rpc-cache";
  const opts: LiveEpochOptions = { ...optionsFromEnv(env), cacheDir };
  const cfg = resolveChain(opts.chainId);
  process.stdout.write(
    `Running epoch ${opts.epoch} on ${cfg.name} (chain ${opts.chainId}), ` +
      `window [${opts.startTs}, ${opts.endTs}], base ${opts.baseTokens.join(", ")}\n`,
  );
  process.stdout.write(
    `RPC cache: ${cacheDir} (re-run to resume after a dropped connection; ` +
      `delete the dir for a clean run)\n\n`,
  );
  const res = await runLiveEpoch(opts);

  process.stdout.write(`\nroot-of-roots: ${res.rootHex}\n`);
  process.stdout.write(`deterministic (built twice): ${res.identical ? "yes" : "NO"}\n`);
  process.stdout.write(`pools: ${res.manifest.poolCount}\n`);
  for (const p of res.manifest.pools) {
    process.stdout.write(`  ${p.poolAddr}  leaves=${p.leafCount}  ref=${p.referencePrice}  ${p.rootHex}\n`);
  }

  const expect = env.MMR_EXPECT_ROOT;
  if (expect && expect !== res.rootHex) {
    throw new Error(`root mismatch: expected ${expect}, got ${res.rootHex}`);
  }
  if (expect) process.stdout.write(`\nmatches expected root ${expect}\n`);

  if (env.MMR_OUT) {
    writeFileSync(env.MMR_OUT, JSON.stringify(res.manifest, null, 1) + "\n");
    process.stdout.write(`\nwrote manifest fixture to ${env.MMR_OUT}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}
