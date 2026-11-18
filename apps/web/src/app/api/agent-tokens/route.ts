import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db/pool";
import { createAgentToken, listAgentTokens } from "@/lib/db/agent-store";

// "Connect agent": a signed-in market maker creates a token for their agent. The token is
// returned once and stored only as a hash.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const pool = db();
  if (session?.kind !== "mm" || session.via !== "wallet" || !session.accountId || !pool) {
    return NextResponse.json({ error: "Sign in with your market-maker wallet first." }, { status: 401 });
  }
  let label = "Agent";
  try {
    const body = (await req.json()) as { label?: unknown };
    if (typeof body.label === "string" && body.label.trim()) label = body.label.trim().slice(0, 40);
  } catch {
    // no body: default label
  }
  try {
    const active = (await listAgentTokens(pool, session.accountId)).filter((t) => !t.revokedAt);
    if (active.length >= 5) return NextResponse.json({ error: "Revoke an existing agent token first (at most 5)." }, { status: 409 });
    const { id, token } = await createAgentToken(pool, session.accountId, label);
    return NextResponse.json({ ok: true, id, token }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't create the token. Please try again." }, { status: 503 });
  }
}
