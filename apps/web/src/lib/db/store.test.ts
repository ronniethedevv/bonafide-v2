import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "@mmr/db/migrate";
import {
  createAccount,
  findAccountByAddress,
  ping,
  registerEngagement,
  registrationsForClient,
  registrationsForMm,
} from "./store";

// Real-Postgres tests for the account store and engagement registry. Skipped unless
// TEST_DATABASE_URL is set (CI provides a postgres service). Uses a throwaway database.
const ADMIN = process.env.TEST_DATABASE_URL;

const MM_WALLET = "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const MM2_WALLET = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const CLIENT_WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const C1 = `0x${"ab".repeat(32)}`;

describe.skipIf(!ADMIN)("postgres store (real Postgres)", () => {
  const name = `mmr_web_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let pool: pg.Pool;

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
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  it("pings", async () => {
    expect(await ping(pool)).toBe(true);
  });

  it("creates an MM account and finds it by wallet, case-insensitively", async () => {
    const r = await createAccount(pool, MM_WALLET, 8453, { kind: "mm", handle: "acme", name: "Acme" });
    expect(r.ok).toBe(true);
    const found = await findAccountByAddress(pool, MM_WALLET.toUpperCase().replace("0X", "0x"));
    expect(found).toMatchObject({ kind: "mm", handle: "acme", name: "Acme" });
    expect(found?.id).toMatch(/^acc_[0-9a-f]{20}$/);
    expect(await findAccountByAddress(pool, MM2_WALLET)).toBeUndefined();
  });

  it("refuses a taken handle and a second account for the same wallet, atomically", async () => {
    expect(await createAccount(pool, MM2_WALLET, 1, { kind: "mm", handle: "acme", name: "Copycat" })).toEqual({ ok: false, error: "handle-taken" });
    // the failed attempt must not have left the wallet linked
    expect(await findAccountByAddress(pool, MM2_WALLET)).toBeUndefined();
    expect(await createAccount(pool, MM_WALLET, 1, { kind: "client", clientId: "x", name: "Again" })).toEqual({ ok: false, error: "wallet-linked" });
  });

  it("uses the database id as a client's id", async () => {
    const r = await createAccount(pool, CLIENT_WALLET, 8453, { kind: "client", clientId: "acct-ignored", name: "Nova Foundation" });
    expect(r.ok && r.account.kind === "client" && r.account.clientId === r.account.id).toBe(true);
  });

  it("registers an engagement against a client found by wallet, and scopes listings to the parties", async () => {
    const mm = (await findAccountByAddress(pool, MM_WALLET))!;
    const client = (await findAccountByAddress(pool, CLIENT_WALLET))!;

    expect(await registerEngagement(pool, { mmAccountId: mm.id!, clientAddress: MM2_WALLET, commitment: C1 })).toEqual({ ok: false, error: "client-not-found" });
    // an MM's wallet is not a client
    expect(await registerEngagement(pool, { mmAccountId: mm.id!, clientAddress: MM_WALLET, commitment: C1 })).toEqual({ ok: false, error: "client-not-found" });

    const r = await registerEngagement(pool, { mmAccountId: mm.id!, clientAddress: CLIENT_WALLET.toLowerCase(), commitment: C1.toUpperCase().replace("0X", "0x") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registration).toMatchObject({ commitment: C1, status: "registered", counterparty: "Nova Foundation" });
    expect(r.registration.id).toMatch(/^rec_[0-9a-f]{12}$/);

    expect(await registerEngagement(pool, { mmAccountId: mm.id!, clientAddress: CLIENT_WALLET, commitment: C1 })).toEqual({ ok: false, error: "duplicate" });

    const forMm = await registrationsForMm(pool, mm.id!);
    expect(forMm.map((x) => [x.id, x.counterparty])).toEqual([[r.registration.id, "Nova Foundation"]]);
    const forClient = await registrationsForClient(pool, client.id!);
    expect(forClient.map((x) => [x.id, x.counterparty, x.mmHandle])).toEqual([[r.registration.id, "Acme", "acme"]]);

    // another market maker sees nothing
    const other = await createAccount(pool, MM2_WALLET, 1, { kind: "mm", handle: "other-mm", name: "Other" });
    expect(other.ok && (await registrationsForMm(pool, other.account.id!))).toEqual([]);
  });
});
