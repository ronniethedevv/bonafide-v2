import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../scripts/migrate.mjs";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI runs a postgres service;
// locally point it at any database whose role can CREATE DATABASE). Each run migrates a
// throwaway database and drops it afterwards.
const ADMIN = process.env.TEST_DATABASE_URL;

describe.skipIf(!ADMIN)("migrations (real Postgres)", () => {
  const name = `mmr_t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let url = "";

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const u = new URL(ADMIN!);
    u.pathname = `/${name}`;
    url = u.toString();
  });

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  it("applies every migration once, then is a no-op", async () => {
    const first = await migrate(url);
    expect(first.applied).toEqual(["0001_init.sql", "0002_acceptance_inbox.sql", "0003_agent.sql", "0004_indexer.sql"]);
    const second = await migrate(url);
    expect(second.applied).toEqual([]);
    expect(second.total).toBe(4);
  });

  it("creates the account and registry tables with their constraints", async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    const tables = (
      await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)
    ).rows.map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining(["account", "account_wallet", "engagement_registration", "_mmr_migrations"]));
    // A handle can be claimed once; a commitment can be registered once.
    await c.query(`INSERT INTO account (id, kind, handle, name) VALUES ('a1', 'mm', 'acme', 'Acme')`);
    await expect(c.query(`INSERT INTO account (id, kind, handle, name) VALUES ('a2', 'mm', 'acme', 'Other')`)).rejects.toMatchObject({
      code: "23505",
      constraint: "account_handle_key",
    });
    await c.end();
  });
});
