import { NextResponse, type NextRequest } from "next/server";
import { isPublicKeyHex } from "@mmr/engagement-file";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db/pool";
import { setInboxKey } from "@/lib/db/store";

// Register the public half of this account's private inbox. The browser derived it from
// the wallet's signature; the private half never leaves the browser and isn't stored.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.via !== "wallet" || !session.accountId) {
    return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  }
  const pool = db();
  if (!pool) return NextResponse.json({ error: "No database configured." }, { status: 409 });
  let body: { publicKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!isPublicKeyHex(body.publicKey)) return NextResponse.json({ error: "Bad key." }, { status: 400 });
  try {
    const r = await setInboxKey(pool, session.accountId, body.publicKey);
    if (r === "conflict") {
      return NextResponse.json(
        { error: "This wallet produced a different key than the one on your account. Sign with the same wallet you set up your inbox with." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, status: r });
  } catch {
    return NextResponse.json({ error: "Couldn't save your inbox key. Please try again." }, { status: 503 });
  }
}
