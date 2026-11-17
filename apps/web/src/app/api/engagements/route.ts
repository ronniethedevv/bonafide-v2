import { NextResponse, type NextRequest } from "next/server";
import { isEnvelope, registrationFingerprint } from "@mmr/engagement-file";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db/pool";
import { registerEngagement } from "@/lib/db/store";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-f]{64}$/;

// Propose an engagement. The market maker's browser has already:
//  - generated the secrets and computed the protocol commitments (walletCommit, termsCommit),
//  - made them save the passphrase-encrypted engagement file, and
//  - sealed the full terms to the client's inbox key.
// The server stores the parties, the two commitments, their fingerprint and the sealed
// envelope. It cannot read the terms, wallets or secrets. The client then reviews and
// accepts or declines.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (session?.kind !== "mm") return NextResponse.json({ error: "Sign in as a market maker first." }, { status: 401 });
  const pool = db();
  if (!pool || !session.accountId) {
    return NextResponse.json({ error: "This account isn't stored in the database, so engagements can't be saved." }, { status: 409 });
  }

  let body: { clientAddress?: unknown; walletCommit?: unknown; termsCommit?: unknown; termsEnvelope?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const { clientAddress, walletCommit, termsCommit, termsEnvelope } = body;
  if (typeof clientAddress !== "string" || !ADDR_RE.test(clientAddress)) {
    return NextResponse.json({ errors: { clientAddress: "Enter the client's 0x wallet address." } }, { status: 422 });
  }
  if (session.address && clientAddress.toLowerCase() === session.address.toLowerCase()) {
    return NextResponse.json({ errors: { clientAddress: "That's your own wallet. Use your client's." } }, { status: 422 });
  }
  if (typeof walletCommit !== "string" || !HASH_RE.test(walletCommit) || typeof termsCommit !== "string" || !HASH_RE.test(termsCommit)) {
    return NextResponse.json({ error: "Bad commitments." }, { status: 400 });
  }
  if (!isEnvelope(termsEnvelope)) return NextResponse.json({ error: "Bad sealed terms." }, { status: 400 });

  try {
    const r = await registerEngagement(pool, {
      mmAccountId: session.accountId,
      clientAddress,
      walletCommit,
      termsCommit,
      fingerprint: await registrationFingerprint(walletCommit, termsCommit),
      termsEnvelope: JSON.stringify(termsEnvelope),
    });
    if (!r.ok && r.error === "client-not-found") {
      return NextResponse.json(
        { errors: { clientAddress: "No client account uses this wallet yet. Ask your client to sign in once with it, then try again." } },
        { status: 422 },
      );
    }
    if (!r.ok && r.error === "client-no-inbox") {
      return NextResponse.json(
        { errors: { clientAddress: "Your client hasn't set up their private inbox yet. Ask them to open their client portal once, then try again." } },
        { status: 422 },
      );
    }
    if (!r.ok) return NextResponse.json({ error: "This engagement is already registered." }, { status: 409 });
    return NextResponse.json({ ok: true, id: r.registration.id, clientName: r.registration.counterparty, fingerprint: r.registration.commitment });
  } catch {
    return NextResponse.json({ error: "Couldn't save the engagement right now. Please try again." }, { status: 503 });
  }
}
