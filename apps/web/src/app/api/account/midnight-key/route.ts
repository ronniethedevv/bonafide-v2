import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db/pool";
import { normalizeMidnightKey, setMidnightKey } from "@/lib/db/store";

// A client saves its own Midnight coin public key. Market makers' registrations name it as
// the bond's beneficiary (the coin key paid if the engagement defaults), and the client's
// acceptance compares each registration with it, so a market maker cannot name itself.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.kind !== "client" || session.via !== "wallet" || !session.accountId) {
    return NextResponse.json({ error: "Sign in with your client wallet first." }, { status: 401 });
  }
  const pool = db();
  if (!pool) return NextResponse.json({ error: "No database configured." }, { status: 409 });
  let body: { key?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const key = normalizeMidnightKey(body.key);
  if (!key) return NextResponse.json({ error: "Enter your Midnight coin public key: 64 hex characters." }, { status: 422 });
  try {
    await setMidnightKey(pool, session.accountId, key);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save your key. Please try again." }, { status: 503 });
  }
}
