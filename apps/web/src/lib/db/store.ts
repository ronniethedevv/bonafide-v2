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
  /** Registration fingerprint: SHA-256(walletCommit || termsCommit). */
  commitment: string;
  walletCommit: string | null;
  termsCommit: string | null;
  status: string;
  createdAt: string;
  respondedAt: string | null;
  /** The other party's display name. */
  counterparty: string;
  /** Market maker's public handle (client-side listings). */
  mmHandle?: string;
  /** Latest epoch the MM's agent reported, and its phase (null before any report). */
  lastEpoch?: number | null;
  lastPhase?: string | null;
}

const REG_COLS = `r.id, r.commitment, r."walletCommit", r."termsCommit", r.status, r."createdAt", r."respondedAt"`;
const PROGRESS_COLS = `
  (SELECT e.epoch FROM engagement_epoch e WHERE e."registrationId" = r.id ORDER BY e.epoch DESC LIMIT 1) AS "lastEpoch",
  (SELECT e.phase FROM engagement_epoch e WHERE e."registrationId" = r.id ORDER BY e.epoch DESC LIMIT 1) AS "lastPhase"`;

function toRegistration(r: Row): Registration {
  return {
    id: String(r.id),
    commitment: String(r.commitment),
    walletCommit: r.walletCommit ? String(r.walletCommit) : null,
    termsCommit: r.termsCommit ? String(r.termsCommit) : null,
    status: String(r.status),
    createdAt: new Date(r.createdAt as string).toISOString(),
    respondedAt: r.respondedAt ? new Date(r.respondedAt as string).toISOString() : null,
    counterparty: String(r.counterparty),
    ...(r.mmHandle ? { mmHandle: String(r.mmHandle) } : {}),
    ...(r.lastEpoch !== undefined ? { lastEpoch: r.lastEpoch === null ? null : Number(r.lastEpoch), lastPhase: (r.lastPhase as string | null) ?? null } : {}),
  };
}

// --- private inbox keys --------------------------------------------------------------

export async function getInboxKey(pool: pg.Pool, accountId: string): Promise<string | null> {
  const { rows } = await pool.query(`SELECT "encryptionKey" FROM account WHERE id = $1`, [accountId]);
  return rows[0]?.encryptionKey ?? null;
}

/**
 * Set an account's inbox key once. Re-setting the same key is fine; a different key is
 * refused, because envelopes already sealed to the old key would become unreadable.
 */
export async function setInboxKey(pool: pg.Pool, accountId: string, publicKey: string): Promise<"set" | "unchanged" | "conflict"> {
  const { rows } = await pool.query(
    `UPDATE account SET "encryptionKey" = $2 WHERE id = $1 AND "encryptionKey" IS NULL RETURNING id`,
    [accountId, publicKey],
  );
  if (rows.length) return "set";
  return (await getInboxKey(pool, accountId)) === publicKey ? "unchanged" : "conflict";
}

/** A client's inbox key, looked up by the wallet they sign in with. */
export async function clientInboxKeyByAddress(pool: pg.Pool, address: string): Promise<{ found: boolean; encryptionKey: string | null }> {
  const { rows } = await pool.query(
    `SELECT a."encryptionKey" FROM account_wallet w JOIN account a ON a.id = w."accountId"
      WHERE w.address = $1 AND a.kind = 'client'`,
    [address.toLowerCase()],
  );
  return rows[0] ? { found: true, encryptionKey: rows[0].encryptionKey ?? null } : { found: false, encryptionKey: null };
}

// --- registration ---------------------------------------------------------------------

export type RegisterResult =
  | { ok: true; registration: Registration }
  | { ok: false; error: "client-not-found" | "client-no-inbox" | "duplicate" };

/**
 * Record a proposed engagement and the terms sealed to the client, atomically. The
 * server stores the two public commitments, their fingerprint, and an envelope it
 * cannot open. The client then reviews the terms and accepts or declines.
 */
export async function registerEngagement(
  pool: pg.Pool,
  input: { mmAccountId: string; clientAddress: string; walletCommit: string; termsCommit: string; fingerprint: string; termsEnvelope: string },
): Promise<RegisterResult> {
  const found = await pool.query(
    `SELECT a.id, a.name, a."encryptionKey" FROM account_wallet w JOIN account a ON a.id = w."accountId"
      WHERE w.address = $1 AND a.kind = 'client'`,
    [input.clientAddress.toLowerCase()],
  );
  const client = found.rows[0];
  if (!client) return { ok: false, error: "client-not-found" };
  if (!client.encryptionKey) return { ok: false, error: "client-no-inbox" };

  const id = newId("rec_", 6);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rows } = await db.query(
      `INSERT INTO engagement_registration (id, "mmAccountId", "clientAccountId", commitment, "walletCommit", "termsCommit")
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${REG_COLS.replace(/r\./g, "")}`,
      [id, input.mmAccountId, client.id, input.fingerprint.toLowerCase(), input.walletCommit.toLowerCase(), input.termsCommit.toLowerCase()],
    );
    await db.query(
      `INSERT INTO engagement_message (id, "registrationId", kind, epoch, envelope) VALUES ($1, $2, 'terms', 0, $3)`,
      [newId("msg_", 8), id, input.termsEnvelope],
    );
    await db.query("COMMIT");
    return { ok: true, registration: toRegistration({ ...rows[0], counterparty: client.name }) };
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    if (isUnique(e, "engagement_registration_commitment_key")) return { ok: false, error: "duplicate" };
    throw e;
  } finally {
    db.release();
  }
}

export async function registrationsForMm(pool: pg.Pool, mmAccountId: string): Promise<Registration[]> {
  const { rows } = await pool.query(
    `SELECT ${REG_COLS}, ${PROGRESS_COLS}, c.name AS counterparty
       FROM engagement_registration r JOIN account c ON c.id = r."clientAccountId"
      WHERE r."mmAccountId" = $1 ORDER BY r."createdAt" DESC LIMIT 100`,
    [mmAccountId],
  );
  return rows.map(toRegistration);
}

export async function registrationsForClient(pool: pg.Pool, clientAccountId: string): Promise<Registration[]> {
  const { rows } = await pool.query(
    `SELECT ${REG_COLS}, ${PROGRESS_COLS}, m.name AS counterparty, m.handle AS "mmHandle"
       FROM engagement_registration r JOIN account m ON m.id = r."mmAccountId"
      WHERE r."clientAccountId" = $1 ORDER BY r."createdAt" DESC LIMIT 100`,
    [clientAccountId],
  );
  return rows.map(toRegistration);
}

export interface PartyView {
  registration: Registration;
  role: "mm" | "client";
  termsEnvelope: string | null;
}

/** One registration as seen by one of its two parties (undefined for anyone else). */
export async function registrationForParty(pool: pg.Pool, id: string, accountId: string): Promise<PartyView | undefined> {
  const { rows } = await pool.query(
    `SELECT ${REG_COLS}, r."mmAccountId", r."clientAccountId",
            CASE WHEN r."mmAccountId" = $2 THEN c.name ELSE m.name END AS counterparty,
            m.handle AS "mmHandle",
            (SELECT envelope FROM engagement_message x WHERE x."registrationId" = r.id AND x.kind = 'terms' AND x.epoch = 0) AS "termsEnvelope"
       FROM engagement_registration r
       JOIN account m ON m.id = r."mmAccountId"
       JOIN account c ON c.id = r."clientAccountId"
      WHERE r.id = $1 AND (r."mmAccountId" = $2 OR r."clientAccountId" = $2)`,
    [id, accountId],
  );
  const r = rows[0];
  if (!r) return undefined;
  return { registration: toRegistration(r), role: r.mmAccountId === accountId ? "mm" : "client", termsEnvelope: r.termsEnvelope ?? null };
}

/** The client accepts (with their wallet's signature) or declines a proposed engagement. */
export async function respondToRegistration(
  pool: pg.Pool,
  input: { id: string; clientAccountId: string; decision: "accept" | "decline"; signature?: string; signer?: string },
): Promise<boolean> {
  const { rows } = await pool.query(
    `UPDATE engagement_registration
        SET status = $3, "respondedAt" = CURRENT_TIMESTAMP, "acceptSignature" = $4, "acceptedBy" = $5
      WHERE id = $1 AND "clientAccountId" = $2 AND status = 'proposed'
      RETURNING id`,
    [input.id, input.clientAccountId, input.decision === "accept" ? "accepted" : "declined", input.signature ?? null, input.signer?.toLowerCase() ?? null],
  );
  return rows.length === 1;
}

export interface EpochMessage {
  epoch: number;
  envelope: string;
  createdAt: string;
}

/** The MM shares one epoch's figures, sealed to the client. Accepted engagements only. */
export async function addEpochMessage(
  pool: pg.Pool,
  input: { id: string; mmAccountId: string; epoch: number; envelope: string },
): Promise<"ok" | "not-found" | "not-accepted" | "duplicate"> {
  const { rows } = await pool.query(`SELECT status FROM engagement_registration WHERE id = $1 AND "mmAccountId" = $2`, [input.id, input.mmAccountId]);
  if (!rows[0]) return "not-found";
  if (!["accepted", "active", "completed"].includes(rows[0].status)) return "not-accepted";
  try {
    await pool.query(`INSERT INTO engagement_message (id, "registrationId", kind, epoch, envelope) VALUES ($1, $2, 'epoch', $3, $4)`, [
      newId("msg_", 8),
      input.id,
      input.epoch,
      input.envelope,
    ]);
    return "ok";
  } catch (e) {
    if (isUnique(e, "engagement_message_registrationId_kind_epoch_key")) return "duplicate";
    throw e;
  }
}

export async function epochMessages(pool: pg.Pool, id: string, accountId: string): Promise<EpochMessage[] | undefined> {
  const party = await pool.query(`SELECT 1 FROM engagement_registration WHERE id = $1 AND ("mmAccountId" = $2 OR "clientAccountId" = $2)`, [id, accountId]);
  if (!party.rows.length) return undefined;
  const { rows } = await pool.query(
    `SELECT epoch, envelope, "createdAt" FROM engagement_message WHERE "registrationId" = $1 AND kind = 'epoch' ORDER BY epoch`,
    [id],
  );
  return rows.map((r) => ({ epoch: Number(r.epoch), envelope: String(r.envelope), createdAt: new Date(r.createdAt).toISOString() }));
}

export async function ping(pool: pg.Pool): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}
