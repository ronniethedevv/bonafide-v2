import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db/pool";
import { clientKeys } from "@/lib/engagement/propose";

// A market maker about to register an engagement fetches the client's public keys: the
// inbox key to seal the terms to, and the Midnight coin key the client saved (the bond's
// beneficiary, which the client's acceptance checks). Only public keys, no name, for
// signed-in market makers.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (session?.kind !== "mm" || !session.accountId) return NextResponse.json({ error: "Sign in as a market maker first." }, { status: 401 });
  const pool = db();
  if (!pool) return NextResponse.json({ error: "No database configured." }, { status: 409 });
  return clientKeys(pool, req.nextUrl.searchParams.get("address") ?? "");
}
