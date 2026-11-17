// Postgres adapter for accounts and the engagement registry (tables from
// packages/db/migrations). Functions take a pool so tests can point them at any database.
//
// What is stored: identity wallets → accounts, and for each registered engagement only
// its parties, on-chain commitment and status. Never pairs, terms, quoting wallets or salts.

import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { AccountClaim } from "../auth/token";

type Row = Record<string, unknown>;

function newId(prefix: string, bytes: number): string {
  return `${prefix}${randomBytes(bytes).toString("hex")}`;
}

function toClaim(r: Row): AccountClaim {
  return r.kind === "mm"
    ? { kind: "mm", id: String(r.id), handle: String(r.handle), name: String(r.name) }
    : { kind: "client", id: String(r.id), clientId: String(r.id), name: String(r.name) };
}

function isUnique(e: unknown, constraint: string): boolean {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" && err.constraint === constraint;
}

export async function findAccountByAddress(pool: pg.Pool, address: string): Promise<AccountClaim | undefined> {
  const { rows } = await pool.query(
    `SELECT a.id, a.kind, a.handle, a.name
       FROM account_wallet w JOIN account a ON a.id = w."accountId"
      WHERE w.address = $1`,
    [address.toLowerCase()],
  );
  return rows[0] ? toClaim(rows[0]) : undefined;
}

export type CreateAccountResult =
  | { ok: true; account: AccountClaim }
  | { ok: false; error: "handle-taken" | "wallet-linked" };

/** Create an account and link the signing wallet to it, atomically. */
export async function createAccount(
  pool: pg.Pool,
  address: string,
  chainId: number,
  account: AccountClaim,
): Promise<CreateAccountResult> {
  const id = newId("acc_", 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO account (id, kind, handle, name) VALUES ($1, $2, $3, $4)`, [
      id,
      account.kind,
      account.kind === "mm" ? account.handle : null,
      account.name,
    ]);
    await client.query(`INSERT INTO account_wallet (address, "accountId", "chainId") VALUES ($1, $2, $3)`, [
      address.toLowerCase(),
      id,
      chainId,
    ]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (isUnique(e, "account_handle_key")) return { ok: false, error: "handle-taken" };
    if (isUnique(e, "account_wallet_pkey")) return { ok: false, error: "wallet-linked" };
    throw e;
  } finally {
    client.release();
  }
  return {
    ok: true,
    account: account.kind === "mm" ? { kind: "mm", id, handle: account.handle, name: account.name } : { kind: "client", id, clientId: id, name: account.name },
  };
}

export interface Registration {
  id: string;
  commitment: string;
  status: string;
  createdAt: string;
  /** The other party's display name. */
  counterparty: string;
  /** Market maker's public handle (client-side listings). */
  mmHandle?: string;
}

export type RegisterResult =
  | { ok: true; registration: Registration }
  | { ok: false; error: "client-not-found" | "duplicate" };

/** Record a newly registered engagement between a market maker and a client account. */
export async function registerEngagement(
  pool: pg.Pool,
  input: { mmAccountId: string; clientAddress: string; commitment: string },
): Promise<RegisterResult> {
  const found = await pool.query(
    `SELECT a.id, a.name FROM account_wallet w JOIN account a ON a.id = w."accountId"
      WHERE w.address = $1 AND a.kind = 'client'`,
    [input.clientAddress.toLowerCase()],
  );
  const client = found.rows[0];
  if (!client) return { ok: false, error: "client-not-found" };
  const id = newId("rec_", 6);
  try {
    const { rows } = await pool.query(
      `INSERT INTO engagement_registration (id, "mmAccountId", "clientAccountId", commitment)
       VALUES ($1, $2, $3, $4) RETURNING status, "createdAt"`,
      [id, input.mmAccountId, client.id, input.commitment.toLowerCase()],
    );
    return {
      ok: true,
      registration: {
        id,
        commitment: input.commitment.toLowerCase(),
        status: String(rows[0].status),
        createdAt: new Date(rows[0].createdAt).toISOString(),
        counterparty: String(client.name),
      },
    };
  } catch (e) {
    if (isUnique(e, "engagement_registration_commitment_key")) return { ok: false, error: "duplicate" };
    throw e;
  }
}

function toRegistration(r: Row): Registration {
  return {
    id: String(r.id),
    commitment: String(r.commitment),
    status: String(r.status),
    createdAt: new Date(r.createdAt as string).toISOString(),
    counterparty: String(r.counterparty),
    ...(r.mmHandle ? { mmHandle: String(r.mmHandle) } : {}),
  };
}

export async function registrationsForMm(pool: pg.Pool, mmAccountId: string): Promise<Registration[]> {
  const { rows } = await pool.query(
    `SELECT r.id, r.commitment, r.status, r."createdAt", c.name AS counterparty
       FROM engagement_registration r JOIN account c ON c.id = r."clientAccountId"
      WHERE r."mmAccountId" = $1 ORDER BY r."createdAt" DESC LIMIT 100`,
    [mmAccountId],
  );
  return rows.map(toRegistration);
}

export async function registrationsForClient(pool: pg.Pool, clientAccountId: string): Promise<Registration[]> {
  const { rows } = await pool.query(
    `SELECT r.id, r.commitment, r.status, r."createdAt", m.name AS counterparty, m.handle AS "mmHandle"
       FROM engagement_registration r JOIN account m ON m.id = r."mmAccountId"
      WHERE r."clientAccountId" = $1 ORDER BY r."createdAt" DESC LIMIT 100`,
    [clientAccountId],
  );
  return rows.map(toRegistration);
}

export async function ping(pool: pg.Pool): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}
