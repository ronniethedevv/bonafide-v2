// Bearer-token auth for the market-maker agent API (/api/agent/v1/*).

import type { NextRequest } from "next/server";
import { db } from "@/lib/db/pool";
import { authenticateAgent, type AgentIdentity } from "@/lib/db/agent-store";

export type AgentAuth = { ok: true; agent: AgentIdentity; pool: NonNullable<ReturnType<typeof db>> } | { ok: false; status: number; error: string };

export async function authAgent(req: NextRequest): Promise<AgentAuth> {
  const pool = db();
  if (!pool) return { ok: false, status: 503, error: "No database configured." };
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (!m) return { ok: false, status: 401, error: "Missing agent token." };
  try {
    const agent = await authenticateAgent(pool, m[1]!);
    return agent ? { ok: true, agent, pool } : { ok: false, status: 401, error: "Unknown or revoked agent token." };
  } catch {
    return { ok: false, status: 503, error: "Couldn't check the token right now." };
  }
}
