// Index one closed UTC day on one chain: the deterministic pipeline runs twice (the first
// pass publishes trees + manifest to IPFS, the second recomputes from the RPC cache), the
// roots must match (invariant #4), and the root is stored for the record and the agents.
//
// The position registry (DD-24) lives in Postgres between runs, so a stateless worker
// machine scans only the position NFTs minted since the previous day.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runLiveEpoch, type LiveEpochOptions, type RunResult, type TreePublisher } from "@mmr/indexer";
import { coverage, dayLabel, dayWindow, logChunkBlocks, poolAllowlist, rpcConcurrency, treasury } from "./day.js";
import { getWorkerState, indexedEpoch, saveIndexedEpoch, setWorkerState, type Queryable } from "./store.js";

export interface IndexDayDeps {
  readonly db: Queryable;
  readonly publisher: TreePublisher;
  readonly env: Record<string, string | undefined>;
  /** Scratch directory for the RPC cache and registry file (deleted afterwards). */
  readonly workDir: string;
  readonly log?: (message: string, data?: Record<string, unknown>) => void;
  /** The live runner; injected in tests. */
  readonly run?: (opts: LiveEpochOptions) => Promise<RunResult>;
}

export type IndexDayOutcome =
  | { status: "indexed"; chainId: number; day: string; rootHex: string; manifestCid: string; poolCount: number }
  | { status: "already-indexed"; chainId: number; day: string; rootHex: string }
  | { status: "no-coverage"; chainId: number; day: string };

export async function indexDay(chainId: number, day: number, deps: IndexDayDeps): Promise<IndexDayOutcome> {
  const label = dayLabel(day);
  const log = deps.log ?? (() => {});
  const done = await indexedEpoch(deps.db, chainId, day);
  if (done) return { status: "already-indexed", chainId, day: label, rootHex: done.rootHex };

  const baseTokens = coverage(deps.env, chainId);
  if (baseTokens.length === 0) return { status: "no-coverage", chainId, day: label };

  const dir = join(deps.workDir, `index-${chainId}-${day}`);
  mkdirSync(dir, { recursive: true });
  const registryKey = `registry:${chainId}`;
  const registryPath = join(dir, "registry.json");
  let registrySaved = false;
  const saveRegistryFile = async (): Promise<void> => {
    if (registrySaved || !existsSync(registryPath)) return;
    await setWorkerState(deps.db, registryKey, readFileSync(registryPath, "utf8"));
    registrySaved = true;
  };
  try {
    const saved = await getWorkerState(deps.db, registryKey);
    if (saved) writeFileSync(registryPath, saved);
    log("indexing", { chainId, day: label, tokens: baseTokens.length, registry: saved ? "restored" : "new" });

    const { startTs, endTs } = dayWindow(day);
    const result = await (deps.run ?? runLiveEpoch)({
      chainId,
      epoch: day,
      startTs,
      endTs,
      baseTokens,
      treasuryAddresses: treasury(deps.env, chainId),
      ...(poolAllowlist(deps.env, chainId).length ? { configOverrides: { poolAllowlist: poolAllowlist(deps.env, chainId) } } : {}),
      env: deps.env,
      cacheDir: join(dir, "rpc-cache"),
      retries: 20,
      publisher: deps.publisher,
      activity: {
        registryPath,
        chunkBlocks: logChunkBlocks(deps.env),
        concurrency: rpcConcurrency(deps.env),
        receiptConcurrency: rpcConcurrency(deps.env),
        onStage: (stage) => log("stage", { chainId, day: label, stage }),
      },
    });

    // Save the registry first: it is valid on its own even if storing the root fails.
    await saveRegistryFile();
    const m = result.manifest;
    await saveIndexedEpoch(deps.db, {
      chainId,
      epoch: day,
      startTs,
      endTs,
      startBlock: m.startBlock,
      endBlock: m.endBlock,
      endBlockHash: m.endBlockHash,
      rootHex: result.rootHex,
      manifestCid: result.manifestCid,
      poolCount: m.poolCount,
      manifest: m,
    });
    log("indexed", { chainId, day: label, root: result.rootHex, cid: result.manifestCid, pools: m.poolCount });
    return { status: "indexed", chainId, day: label, rootHex: result.rootHex, manifestCid: result.manifestCid, poolCount: m.poolCount };
  } catch (e) {
    // A day that fails after the registry scan keeps the scan: the next run resumes from it.
    await saveRegistryFile().catch(() => {});
    throw e;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
