import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db/pool";
import { proposeEngagement } from "@/lib/engagement/propose";

// Propose an engagement from the market maker's browser. The browser has already:
//  - generated the secrets and computed the protocol commitments (walletCommit, termsCommit),
//  - collected each wallet's ownership signature,
//  - made them save the passphrase-encrypted engagement file, and
//  - sealed the full terms to the client's inbox key.
// The server stores the parties, the two commitments, their fingerprint and the sealed
// envelope. It cannot read the terms, wallets or secrets. The client then reviews and
// accepts or declines. A market maker's local agent proposes the same way
// (/api/agent/v1/engagements), and then the wallets never reach a web page at all.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (session?.kind !== "mm") return NextResponse.json({ error: "Sign in as a market maker first." }, { status: 401 });
  const pool = db();
  if (!pool || !session.accountId) {
    return NextResponse.json({ error: "This account isn't stored in the database, so engagements can't be saved." }, { status: 409 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  return proposeEngagement(pool, { accountId: session.accountId, address: session.address }, body);
}
