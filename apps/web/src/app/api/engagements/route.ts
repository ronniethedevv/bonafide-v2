import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db/pool";
import { registerEngagement } from "@/lib/db/store";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const COMMITMENT_RE = /^0x[0-9a-fA-F]{64}$/;

// Register an engagement: a signed-in market maker records the commitment (computed in
// their browser from the terms, wallets and a fresh salt) against a client account,
// found by the wallet that client signs in with. Only the parties, the commitment and
// the status are stored. The terms, wallets and salt never reach this server.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (session?.kind !== "mm") return NextResponse.json({ error: "Sign in as a market maker first." }, { status: 401 });
  const pool = db();
  if (!pool || !session.accountId) {
    return NextResponse.json({ error: "This account isn't stored in the database, so engagements can't be saved." }, { status: 409 });
  }

  let body: { clientAddress?: unknown; commitment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const { clientAddress, commitment } = body;
  if (typeof clientAddress !== "string" || !ADDR_RE.test(clientAddress)) {
    return NextResponse.json({ errors: { clientAddress: "Enter the client's 0x wallet address." } }, { status: 422 });
  }
  if (typeof commitment !== "string" || !COMMITMENT_RE.test(commitment)) {
    return NextResponse.json({ error: "Bad commitment." }, { status: 400 });
  }
  if (session.address && clientAddress.toLowerCase() === session.address.toLowerCase()) {
    return NextResponse.json({ errors: { clientAddress: "That's your own wallet. Use your client's." } }, { status: 422 });
  }

  try {
    const r = await registerEngagement(pool, { mmAccountId: session.accountId, clientAddress, commitment });
    if (!r.ok && r.error === "client-not-found") {
      return NextResponse.json(
        { errors: { clientAddress: "No client account uses this wallet yet. Ask your client to sign in once with it, then try again." } },
        { status: 422 },
      );
    }
    if (!r.ok) return NextResponse.json({ error: "This engagement is already registered." }, { status: 409 });
    return NextResponse.json({ ok: true, id: r.registration.id, clientName: r.registration.counterparty });
  } catch {
    return NextResponse.json({ error: "Couldn't save the engagement right now. Please try again." }, { status: 503 });
  }
}
