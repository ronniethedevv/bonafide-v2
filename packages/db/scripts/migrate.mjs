#!/usr/bin/env node
// Apply packages/db/migrations/*.sql in filename order, each exactly once, recorded in
// the _mmr_migrations table. All pending files run in ONE transaction under an advisory
// lock, so concurrent builds can't double-apply and a failure leaves the schema as it was
// (Postgres DDL is transactional). A failure exits non-zero, which fails the build: code
// is never deployed against a schema it doesn't match.
//
// When it runs:
//   - Vercel PRODUCTION builds (VERCEL_ENV=production) with DATABASE_URL set.
//   - Anywhere with --force (local dev, tests, CI) — it migrates whatever DATABASE_URL names.
// Preview builds skip: an unmerged branch must not change the live schema.
//
//   node packages/db/scripts/migrate.mjs [--force]

import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const LOCK_KEY = 72_727_001; // arbitrary, stable advisory-lock id for this app's migrations
const log = (m) => process.stdout.write(`[migrate] ${m}\n`);

export async function migrate(connectionString, dir = join(dirname(fileURLToPath(import.meta.url)), "../migrations")) {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS _mmr_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    const done = new Set((await client.query("SELECT name FROM _mmr_migrations")).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      await client.query(await readFile(join(dir, f), "utf8"));
      await client.query("INSERT INTO _mmr_migrations (name) VALUES ($1)", [f]);
      applied.push(f);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
  return { applied, total: files.length };
}

// Compare real paths: the build runs this through the workspace symlink in node_modules.
const isMain = Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  const force = process.argv.includes("--force");
  // Migrations need a direct (non-pooled) connection when one is available.
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    log("no DATABASE_URL: skipping");
  } else if (!force && process.env.VERCEL_ENV !== "production") {
    log(`${process.env.VERCEL ? `Vercel ${process.env.VERCEL_ENV ?? "unknown"} build` : "not a production build"}: skipping (production builds migrate; use --force to migrate this database)`);
  } else {
    try {
      const { applied, total } = await migrate(url);
      log(applied.length ? `applied ${applied.join(", ")} (${total} total)` : `up to date (${total} migrations)`);
    } catch (e) {
      log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  }
}
