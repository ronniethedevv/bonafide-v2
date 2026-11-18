import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db/pool";
import { revokeAgentToken } from "@/lib/db/agent-store";

// Revoke one of the signed-in market maker's agent tokens.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const pool = db();
  if (session?.kind !== "mm" || !session.accountId || !pool) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const ok = await revokeAgentToken(pool, session.accountId, id);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Couldn't revoke the token." }, { status: 503 });
  }
}
