import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { migrate } from "@mmr/db/migrate";
import { InMemoryPublisher, type LiveEpochOptions, type RunResult } from "@mmr/indexer";
import { dayFromDate } from "./day.js";
import { indexDay } from "./index-day.js";
import { getWorkerState, saveIndexedEpoch } from "./store.js";

// indexDay against real Postgres (skipped without TEST_DATABASE_URL); the live pipeline is
// replaced by a stand-in so no RPC is needed. The pipeline itself is covered in @mmr/indexer.
const ADMIN = process.env.TEST_DATABASE_URL;
const TOKEN = "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b";
const DAY = dayFromDate("2026-11-16");

function fakeRun(calls: LiveEpochOptions[], root = `0x${"7a".repeat(32)}`) {
  return async (opts: LiveEpochOptions): Promise<RunResult> => {
    calls.push(opts);
    const reg = opts.activity?.registryPath;
    // The real provider reads and rewrites the registry file; mimic that.
    const before = reg && existsSync(reg) ? JSON.parse(readFileSync(reg, "utf8")) : { scannedAt: 0 };
    if (reg) writeFileSync(reg, JSON.stringify({ scannedAt: before.scannedAt + 1 }));
    const manifest = { chainId: opts.chainId, epoch: opts.epoch, startBlock: 100, endBlock: 200, endBlockHash: `0x${"11".repeat(32)}`, poolCount: 2, rootOfRootsHex: root, pools: [], votes: [] };
    return { rootHex: root, identical: true, manifestCid: "bafytestmanifest", manifest: manifest as unknown as RunResult["manifest"] };
  };
}

describe.skipIf(!ADMIN)("indexDay (real Postgres)", () => {
  const name = `mmr_worker_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let pool: pg.Pool;
  const workDir = mkdtempSync(join(tmpdir(), "mmr-worker-"));
  const env = { MMR_COVERAGE_8453: TOKEN, MMR_LOG_CHUNK_BLOCKS: "2000" };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const u = new URL(ADMIN!);
    u.pathname = `/${name}`;
    await migrate(u.toString());
    pool = new pg.Pool({ connectionString: u.toString(), max: 2 });
  });

  afterAll(async () => {
    await pool?.end();
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  });

  it("indexes a day once, stores the root and keeps the registry between runs", async () => {
    const calls: LiveEpochOptions[] = [];
    const deps = { db: pool, publisher: new InMemoryPublisher(), env, workDir, run: fakeRun(calls) };

    const first = await indexDay(8453, DAY, deps);
    expect(first).toMatchObject({ status: "indexed", day: "2026-11-16", manifestCid: "bafytestmanifest", poolCount: 2 });
    expect(calls[0]).toMatchObject({ chainId: 8453, epoch: DAY, startTs: DAY * 86400, endTs: (DAY + 1) * 86400, baseTokens: [TOKEN] });
    expect(calls[0]!.activity?.chunkBlocks).toBe(2000);
    expect(JSON.parse((await getWorkerState(pool, "registry:8453"))!)).toEqual({ scannedAt: 1 });

    const again = await indexDay(8453, DAY, deps);
    expect(again).toMatchObject({ status: "already-indexed", rootHex: `0x${"7a".repeat(32)}` });
    expect(calls).toHaveLength(1);

    await indexDay(8453, DAY + 1, deps);
    expect(JSON.parse((await getWorkerState(pool, "registry:8453"))!)).toEqual({ scannedAt: 2 }); // restored, then advanced

    const { rows } = await pool.query(`SELECT epoch, "rootHex", manifest->>'poolCount' AS pools FROM indexed_epoch ORDER BY epoch`);
    expect(rows.map((r) => r.epoch)).toEqual([DAY, DAY + 1]);
    expect(rows[0].pools).toBe("2");
  });

  it("skips chains with no covered tokens and refuses a conflicting root", async () => {
    expect(await indexDay(1, DAY, { db: pool, publisher: new InMemoryPublisher(), env, workDir, run: fakeRun([]) })).toMatchObject({ status: "no-coverage" });
    // Same (chain, day) stored again with a different root: determinism broken, fail loudly.
    const row = { chainId: 8453, epoch: DAY + 5, startTs: 0, endTs: 1, startBlock: 1, endBlock: 2, endBlockHash: "0x", rootHex: `0x${"7a".repeat(32)}`, manifestCid: "bafy", poolCount: 0, manifest: {} };
    await saveIndexedEpoch(pool, row);
    await saveIndexedEpoch(pool, row); // same root again: fine
    await expect(saveIndexedEpoch(pool, { ...row, rootHex: `0x${"99".repeat(32)}` })).rejects.toThrow(/different root/);
  });
});
