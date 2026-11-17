// One small connection pool per server instance (Neon's pooled DATABASE_URL in
// production). Absent DATABASE_URL, the app runs in preview mode: accounts live in a
// signed browser cookie and nothing is persisted server-side.

import pg from "pg";

const g = globalThis as unknown as { __mmrPool?: pg.Pool };

export function dbConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.DATABASE_URL);
}

export function db(): pg.Pool | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  g.__mmrPool ??= new pg.Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  return g.__mmrPool;
}
