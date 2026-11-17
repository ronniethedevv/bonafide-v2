// Postgres access for the worker: indexed epochs (public roots) and small resumable state.
// Tables come from packages/db migration 0004_indexer.

export interface Queryable {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface IndexedEpochRow {
  chainId: number;
  epoch: number;
  startTs: number;
  endTs: number;
  startBlock: number;
  endBlock: number;
  endBlockHash: string;
  rootHex: string;
  manifestCid: string;
  poolCount: number;
  manifest: unknown;
}

export async function indexedEpoch(db: Queryable, chainId: number, epoch: number): Promise<{ rootHex: string; manifestCid: string } | null> {
  const { rows } = await db.query<{ rootHex: string; manifestCid: string }>(
    `SELECT "rootHex", "manifestCid" FROM indexed_epoch WHERE "chainId" = $1 AND epoch = $2`,
    [chainId, epoch],
  );
  return rows[0] ?? null;
}

/** Insert once; a second writer for the same (chain, epoch) must have the same root. */
export async function saveIndexedEpoch(db: Queryable, r: IndexedEpochRow): Promise<void> {
  await db.query(
    `INSERT INTO indexed_epoch ("chainId", epoch, "startTs", "endTs", "startBlock", "endBlock", "endBlockHash", "rootHex", "manifestCid", "poolCount", manifest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT ("chainId", epoch) DO NOTHING`,
    [r.chainId, r.epoch, r.startTs, r.endTs, r.startBlock, r.endBlock, r.endBlockHash, r.rootHex, r.manifestCid, r.poolCount, JSON.stringify(r.manifest)],
  );
  const stored = await indexedEpoch(db, r.chainId, r.epoch);
  if (!stored || stored.rootHex !== r.rootHex) {
    throw new Error(`epoch ${r.epoch} on chain ${r.chainId} already stored with a different root (${stored?.rootHex}); determinism broken`);
  }
}

export async function getWorkerState(db: Queryable, key: string): Promise<string | null> {
  const { rows } = await db.query<{ value: string }>(`SELECT value FROM worker_state WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}

export async function setWorkerState(db: Queryable, key: string, value: string): Promise<void> {
  await db.query(
    `INSERT INTO worker_state (key, value, "updatedAt") VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
    [key, value],
  );
}
