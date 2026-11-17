// Where the agent gets an epoch's public activity from.
//
//  - replay: activity files written by packages/indexer/scripts/replay-run.mts — real
//    chain data indexed earlier (dev/test, and today's real-history demo).
//  - published (planned): our indexer's daily published record, checked against the
//    attested root. No RPC key needed. Arrives with the daily indexer service.
//  - rpc (planned): the MM's own archive RPC running the same deterministic indexer.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AddressActivity, EpochRange } from "@mmr/indexer";

export interface EpochActivity {
  range: EpochRange;
  pool: string;
  activities: AddressActivity[];
}

export interface ActivitySource {
  readonly name: string;
  activity(epoch: number): Promise<EpochActivity>;
}

const BIGINT_KEYS = new Set([
  "addr", "baseStart", "baseEnd", "quoteEnd", "lpBase", "lpQuote", "xferIn", "xferOut", "fromTreasury",
  "swapBaseIn", "swapBaseOut", "swapQuoteIn", "swapQuoteOut", "minBid", "minAsk", "buy", "sell",
]);

/** JSON reviver: the replay files store bigints as decimal strings. */
export function reviveActivity(key: string, value: unknown): unknown {
  return BIGINT_KEYS.has(key) && typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : value;
}

/** Activity files from replay-run.mts: <dir>/epoch-<n>.json. */
export function replaySource(dir: string): ActivitySource {
  return {
    name: `replay:${dir}`,
    async activity(epoch: number): Promise<EpochActivity> {
      const file = join(dir, `epoch-${epoch}.json`);
      if (!existsSync(file)) throw new Error(`no replayed activity for epoch ${epoch} (${file})`);
      const j = JSON.parse(readFileSync(file, "utf8"), reviveActivity) as {
        pool: { pool: string };
        range: EpochRange;
        activities: AddressActivity[];
      };
      // Files from before DD-31 carry the LP's first-active block, not its timestamp.
      if (j.activities.some((a) => !("lpFirstActiveTs" in a))) {
        throw new Error(`${file} predates the seconds-based anti-JIT rule (DD-31); re-run replay-run.mts to rewrite it`);
      }
      return { range: j.range, pool: j.pool.pool, activities: j.activities };
    },
  };
}
