// Trigger.dev tasks: the production runner for the daily indexer (invariant #1: durable
// background workers, never an HTTP handler). The demo runs the same indexDay on GitHub
// Actions' scheduler (src/run-daily.ts, DD-33).
//
//   daily-index   01:10 UTC every day: index yesterday on every covered chain.
//   index-epoch   one (chain, day); also run by hand from the dashboard for backfills,
//                 payload {"chainId": 8453, "date": "2026-11-16"}.
//
// Environment (set in the Trigger.dev dashboard, never committed):
//   DATABASE_URL            Neon Postgres (same database as the web app)
//   BASE_ARCHIVE_RPC_URL    archive RPC with the key in the URL, e.g. Alchemy …/v2/<key>
//   ETH_ARCHIVE_RPC_URL     only if Ethereum tokens are covered
//   IPFS_PINNING_JWT        Pinata JWT (Files: Write)
//   MMR_COVERAGE_8453       comma-separated base tokens to index on Base
//   MMR_COVERAGE_1          … on Ethereum (optional)
//   MMR_LOG_CHUNK_BLOCKS    blocks per eth_getLogs (10 on a free key; e.g. 2000 on a paid one)

import { tmpdir } from "node:os";
import pg from "pg";
import { idempotencyKeys, logger, schedules, task } from "@trigger.dev/sdk";
import { PinataTreePublisher } from "@mmr/indexer";
import { coveredChains, dayFromDate, dayLabel, previousDay } from "../day.js";
import { indexDay, type IndexDayOutcome } from "../index-day.js";

export interface IndexEpochPayload {
  chainId: number;
  /** Unix day number, or give `date` instead. */
  day?: number;
  /** "YYYY-MM-DD" (UTC). */
  date?: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in this Trigger.dev environment`);
  return v;
}

export const indexEpoch = task({
  id: "index-epoch",
  // One indexing run at a time: they share the RPC budget and the registry state.
  concurrency: { total: 1 },
  machine: "small-2x",
  maxDuration: 6 * 60 * 60,
  // Covers an epoch that is not final yet and RPC outages; the run itself is idempotent.
  retry: { maxAttempts: 4, factor: 2, minTimeoutInMs: 10 * 60_000, maxTimeoutInMs: 60 * 60_000 },
  run: async (payload: IndexEpochPayload): Promise<IndexDayOutcome> => {
    const day = payload.day ?? (payload.date ? dayFromDate(payload.date) : NaN);
    if (!Number.isInteger(day)) throw new Error("payload needs `day` or `date`");
    const db = new pg.Pool({ connectionString: required("DATABASE_URL"), max: 2 });
    try {
      return await indexDay(payload.chainId, day, {
        db,
        publisher: new PinataTreePublisher({ jwt: required("IPFS_PINNING_JWT") }),
        env: process.env,
        workDir: tmpdir(),
        log: (message, data) => logger.info(message, data),
      });
    } finally {
      await db.end();
    }
  },
});

export const dailyIndex = schedules.task({
  id: "daily-index",
  // An hour after the UTC day closes, so the day's last block is final on both chains.
  cron: { pattern: "10 1 * * *", timezone: "UTC" },
  run: async (payload) => {
    const day = previousDay(payload.timestamp);
    const chains = coveredChains(process.env);
    if (chains.length === 0) {
      logger.warn("no chain has covered tokens (set MMR_COVERAGE_8453); nothing to index");
      return { day: dayLabel(day), triggered: [] };
    }
    const triggered = [];
    for (const chainId of chains) {
      const idempotencyKey = await idempotencyKeys.create(`index-epoch:${chainId}:${day}`, { scope: "global" });
      const handle = await indexEpoch.trigger({ chainId, day }, { idempotencyKey });
      triggered.push({ chainId, runId: handle.id });
    }
    return { day: dayLabel(day), triggered };
  },
});
