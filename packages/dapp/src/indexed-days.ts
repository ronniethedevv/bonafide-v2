// @mmr/dapp — which days the daily indexer has stored: (chain, day, root, manifest CID).
//
// The scheduled job reads them from the indexer's Postgres table (DATABASE_URL). A local
// run without database access can name days explicitly:
//   MMR_INDEXED_DAYS='[{"day":20780,"rootHex":"0x…","manifestCid":"bafk…"}]'
// Either way the days are untrusted until loadPublishedDay recomputes them.

import pg from "pg";

export interface IndexedDay {
  chainId: number;
  day: number;
  rootHex: string;
  manifestCid: string;
}

export async function indexedDays(chainId: number, fromDay: number, toDay: number): Promise<IndexedDay[]> {
  if (toDay < fromDay) return [];
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const { rows } = await client.query<{ chainId: number; epoch: number; rootHex: string; manifestCid: string }>(
        `SELECT "chainId", epoch, "rootHex", "manifestCid" FROM indexed_epoch
          WHERE "chainId" = $1 AND epoch BETWEEN $2 AND $3 ORDER BY epoch`,
        [chainId, fromDay, toDay],
      );
      return rows.map((r) => ({ chainId: Number(r.chainId), day: Number(r.epoch), rootHex: r.rootHex, manifestCid: r.manifestCid }));
    } finally {
      await client.end();
    }
  }
  const raw = process.env.MMR_INDEXED_DAYS;
  if (!raw) return [];
  const listed = JSON.parse(raw) as { day: number; rootHex: string; manifestCid: string; chainId?: number }[];
  return listed
    .map((d) => ({ chainId: d.chainId ?? chainId, day: Number(d.day), rootHex: d.rootHex, manifestCid: d.manifestCid }))
    .filter((d) => d.chainId === chainId && d.day >= fromDay && d.day <= toDay)
    .sort((a, b) => a.day - b.day);
}
