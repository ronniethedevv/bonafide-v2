// Market-maker agent: tokens and per-epoch progress (tables from migration 0003).
//
// A token is shown to the MM once and stored only as its SHA-256 hash. The agent reports
// how far each epoch has got (phases only); whether it passed is sealed to the client.

import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

export const AGENT_TOKEN_PREFIX = "mmra_";
export const PHASES = ["captured", "proven", "submitted", "settled"] as const;
export type Phase = (typeof PHASES)[number];

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export interface AgentTokenInfo {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export async function createAgentToken(pool: pg.Pool, accountId: string, label: string): Promise<{ id: string; token: string }> {
  const token = AGENT_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const id = `agt_${randomBytes(6).toString("hex")}`;
  await pool.query(`INSERT INTO agent_token (id, "accountId", "tokenHash", label) VALUES ($1, $2, $3, $4)`, [id, accountId, hashToken(token), label]);
  return { id, token };
}

export async function listAgentTokens(pool: pg.Pool, accountId: string): Promise<AgentTokenInfo[]> {
  const { rows } = await pool.query(
    `SELECT id, label, "createdAt", "lastUsedAt", "revokedAt" FROM agent_token WHERE "accountId" = $1 ORDER BY "createdAt" DESC LIMIT 20`,
    [accountId],
  );
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return rows.map((r) => ({ id: r.id, label: r.label, createdAt: iso(r.createdAt)!, lastUsedAt: iso(r.lastUsedAt), revokedAt: iso(r.revokedAt) }));
}

export async function revokeAgentToken(pool: pg.Pool, accountId: string, id: string): Promise<boolean> {
  const { rows } = await pool.query(
    `UPDATE agent_token SET "revokedAt" = CURRENT_TIMESTAMP WHERE id = $1 AND "accountId" = $2 AND "revokedAt" IS NULL RETURNING id`,
    [id, accountId],
  );
  return rows.length === 1;
}

export interface AgentIdentity {
  tokenId: string;
  accountId: string;
  handle: string;
  name: string;
}

/** Resolve a bearer token to its market-maker account (undefined if unknown, revoked or not an MM). */
export async function authenticateAgent(pool: pg.Pool, token: string): Promise<AgentIdentity | undefined> {
  if (!token.startsWith(AGENT_TOKEN_PREFIX) || token.length > 100) return undefined;
  const { rows } = await pool.query(
    `SELECT t.id AS "tokenId", a.id AS "accountId", a.kind, a.handle, a.name
       FROM agent_token t JOIN account a ON a.id = t."accountId"
      WHERE t."tokenHash" = $1 AND t."revokedAt" IS NULL`,
    [hashToken(token)],
  );
  const r = rows[0];
  if (!r || r.kind !== "mm") return undefined;
  // Last-used, at most once a minute per token.
  await pool.query(
    `UPDATE agent_token SET "lastUsedAt" = CURRENT_TIMESTAMP
      WHERE id = $1 AND ("lastUsedAt" IS NULL OR "lastUsedAt" < CURRENT_TIMESTAMP - INTERVAL '1 minute')`,
    [r.tokenId],
  );
  return { tokenId: r.tokenId, accountId: r.accountId, handle: r.handle, name: r.name };
}

export interface AgentEngagement {
  id: string;
  status: string;
  walletCommit: string | null;
  termsCommit: string | null;
  clientName: string;
  /** The client's inbox key, to seal figures to (null until they set up their inbox). */
  clientInboxKey: string | null;
  epochs: Array<{ epoch: number; phase: string }>;
}

/** The MM's own engagements, with what the agent needs to work on them. */
export async function agentEngagements(pool: pg.Pool, mmAccountId: string): Promise<AgentEngagement[]> {
  const { rows } = await pool.query(
    `SELECT r.id, r.status, r."walletCommit", r."termsCommit", c.name AS "clientName", c."encryptionKey" AS "clientInboxKey",
            COALESCE((SELECT json_agg(json_build_object('epoch', e.epoch, 'phase', e.phase) ORDER BY e.epoch)
                        FROM engagement_epoch e WHERE e."registrationId" = r.id), '[]'::json) AS epochs
       FROM engagement_registration r JOIN account c ON c.id = r."clientAccountId"
      WHERE r."mmAccountId" = $1 ORDER BY r."createdAt" DESC LIMIT 100`,
    [mmAccountId],
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    walletCommit: r.walletCommit,
    termsCommit: r.termsCommit,
    clientName: r.clientName,
    clientInboxKey: r.clientInboxKey ?? null,
    epochs: r.epochs,
  }));
}

export type ReportResult = "ok" | "unchanged" | "not-found" | "not-accepted" | "backwards";

/**
 * Record that an epoch reached `phase`. Phases only move forward; the first report on an
 * accepted engagement marks it active. Only for the MM's own, client-accepted engagements.
 */
export async function reportEpochPhase(
  pool: pg.Pool,
  input: { registrationId: string; mmAccountId: string; epoch: number; phase: Phase },
): Promise<ReportResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reg = await client.query(`SELECT status FROM engagement_registration WHERE id = $1 AND "mmAccountId" = $2 FOR UPDATE`, [
      input.registrationId,
      input.mmAccountId,
    ]);
    if (!reg.rows[0]) {
      await client.query("ROLLBACK");
      return "not-found";
    }
    if (!["accepted", "active"].includes(reg.rows[0].status)) {
      await client.query("ROLLBACK");
      return "not-accepted";
    }
    const cur = await client.query(`SELECT phase FROM engagement_epoch WHERE "registrationId" = $1 AND epoch = $2`, [input.registrationId, input.epoch]);
    const before = cur.rows[0]?.phase as Phase | undefined;
    if (before && PHASES.indexOf(before) > PHASES.indexOf(input.phase)) {
      await client.query("ROLLBACK");
      return "backwards";
    }
    if (before === input.phase) {
      await client.query("ROLLBACK");
      return "unchanged";
    }
    await client.query(
      `INSERT INTO engagement_epoch ("registrationId", epoch, phase) VALUES ($1, $2, $3)
       ON CONFLICT ("registrationId", epoch) DO UPDATE SET phase = EXCLUDED.phase, "updatedAt" = CURRENT_TIMESTAMP`,
      [input.registrationId, input.epoch, input.phase],
    );
    if (reg.rows[0].status === "accepted") {
      await client.query(`UPDATE engagement_registration SET status = 'active' WHERE id = $1`, [input.registrationId]);
    }
    await client.query("COMMIT");
    return "ok";
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
