// Daily indexer entry point for the demo, run by GitHub Actions' scheduler (DD-33); in
// production the same job runs on Trigger.dev (src/trigger/indexer.ts). Either way it is a
// background job, never an HTTP handler (invariant #1).
//
//   pnpm --filter @mmr/worker index
//     every covered chain, the last MMR_CATCHUP_DAYS (default 3) closed UTC days; days
//     already stored are skipped, so a missed run is caught up by the next one.
//   MMR_INDEX_DATE=2026-11-16 [MMR_INDEX_CHAIN=8453] pnpm --filter @mmr/worker index
//     one day (backfill), on one chain or every covered chain.
//
// Needs DATABASE_URL, IPFS_PINNING_JWT and the chain's archive RPC URL
// (BASE_ARCHIVE_RPC_URL / ETH_ARCHIVE_RPC_URL) once a chain has covered tokens
// (MMR_COVERAGE_<chainId>). With no coverage it exits at once and touches nothing.

import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { PinataTreePublisher } from "@mmr/indexer";
import { catchUpDays, catchUpWindow, coveredChains, dayFromDate, dayLabel, indexFromDay, SUPPORTED_CHAINS } from "./day.js";
import { indexDay } from "./index-day.js";

const log = (message: string, data?: Record<string, unknown>): void =>
  console.log(data ? `${message} ${JSON.stringify(data)}` : message);

function required(env: Record<string, string | undefined>, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function plan(env: Record<string, string | undefined>, now: Date): { chains: number[]; days: number[] } {
  let chains = coveredChains(env);
  if (env.MMR_INDEX_CHAIN) {
    const c = Number(env.MMR_INDEX_CHAIN);
    if (!(SUPPORTED_CHAINS as readonly number[]).includes(c)) throw new Error(`unsupported chain ${env.MMR_INDEX_CHAIN}`);
    chains = chains.filter((x) => x === c);
  }
  // A named day is indexed as asked; the catch-up window starts no earlier than MMR_INDEX_FROM.
  const from = indexFromDay(env);
  const days = env.MMR_INDEX_DATE
    ? [dayFromDate(env.MMR_INDEX_DATE)]
    : catchUpDays(now, catchUpWindow(env)).filter((d) => from === undefined || d >= from);
  return { chains, days };
}

async function main(): Promise<void> {
  const env = process.env;
  const { chains, days } = plan(env, new Date());
  if (chains.length === 0) {
    log("No chain has covered tokens (set MMR_COVERAGE_8453); nothing to index.");
    return;
  }
  log("indexing", { chains, days: days.map(dayLabel) });

  const db = new pg.Pool({ connectionString: required(env, "DATABASE_URL"), max: 2 });
  const publisher = new PinataTreePublisher({ jwt: required(env, "IPFS_PINNING_JWT") });
  let failed = 0;
  try {
    for (const chainId of chains) {
      for (const day of days) {
        try {
          const outcome = await indexDay(chainId, day, { db, publisher, env, workDir: tmpdir(), log });
          log("result", outcome);
        } catch (e) {
          failed++;
          log("failed", { chainId, day: dayLabel(day), error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  } finally {
    await db.end();
  }
  // A failed day is retried by the next run's catch-up window; the job still reports it.
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
