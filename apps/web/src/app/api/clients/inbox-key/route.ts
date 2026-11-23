import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db/pool";
import { clientInboxKeyByAddress } from "@/lib/db/store";

// A market maker about to register an engagement fetches the client's public keys: the
// inbox key to seal the terms to, and the Midnight coin key the client saved (the bond's
// beneficiary). Returns only public keys (no name), for signed-in market makers.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (session?.kind !== "mm" || !session.accountId) return NextResponse.json({ error: "Sign in as a market maker first." }, { status: 401 });
  const pool = db();
  if (!pool) return NextResponse.json({ error: "No database configured." }, { status: 409 });
  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: "Enter the client's 0x wallet address." }, { status: 422 });
  try {
    const k = await clientInboxKeyByAddress(pool, address);
    if (!k.found) {
      return NextResponse.json({ error: "No client account uses this wallet yet. Ask your client to sign in once with it, then try again." }, { status: 404 });
    }
    if (!k.encryptionKey) {
      return NextResponse.json({ error: "Your client hasn't set up their private inbox yet. Ask them to open their client portal once, then try again." }, { status: 409 });
    }
    // The client's own Midnight coin key, if saved: the wizard names it as the bond's
    // beneficiary, and the client's acceptance checks the registration against it.
    return NextResponse.json(
      { encryptionKey: k.encryptionKey, midnightCoinKey: k.midnightCoinKey },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Lookup failed. Please try again." }, { status: 503 });
  }
}
