// Proposing an engagement, shared by the market maker's browser (/api/engagements) and its
// local agent (/api/agent/v1/engagements). Either way the server receives the client's
// address, the two commitments and the terms sealed to the client's inbox key: it cannot
// read the terms, the wallets, their ownership signatures or the secrets.

import "server-only";
import { NextResponse } from "next/server";
import type pg from "pg";
import { isEnvelope, registrationFingerprint } from "@mmr/engagement-file";
import { clientInboxKeyByAddress, registerEngagement } from "@/lib/db/store";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-f]{64}$/;

export async function proposeEngagement(
  pool: pg.Pool,
  mm: { accountId: string; address?: string | undefined },
  body: { clientAddress?: unknown; walletCommit?: unknown; termsCommit?: unknown; termsEnvelope?: unknown },
): Promise<NextResponse> {
  const { clientAddress, walletCommit, termsCommit, termsEnvelope } = body;
  if (typeof clientAddress !== "string" || !ADDR_RE.test(clientAddress)) {
    return NextResponse.json({ errors: { clientAddress: "Enter the client's 0x wallet address." } }, { status: 422 });
  }
  if (mm.address && clientAddress.toLowerCase() === mm.address.toLowerCase()) {
    return NextResponse.json({ errors: { clientAddress: "That's your own wallet. Use your client's." } }, { status: 422 });
  }
  if (typeof walletCommit !== "string" || !HASH_RE.test(walletCommit) || typeof termsCommit !== "string" || !HASH_RE.test(termsCommit)) {
    return NextResponse.json({ error: "Bad commitments." }, { status: 400 });
  }
  if (!isEnvelope(termsEnvelope)) return NextResponse.json({ error: "Bad sealed terms." }, { status: 400 });

  try {
    const r = await registerEngagement(pool, {
      mmAccountId: mm.accountId,
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

/** The client's public keys for a new proposal: the inbox key to seal to, and the Midnight key the bond names. */
export async function clientKeys(pool: pg.Pool, address: string): Promise<NextResponse> {
  if (!ADDR_RE.test(address)) return NextResponse.json({ error: "Enter the client's 0x wallet address." }, { status: 422 });
  try {
    const k = await clientInboxKeyByAddress(pool, address);
    if (!k.found) {
      return NextResponse.json({ error: "No client account uses this wallet yet. Ask your client to sign in once with it, then try again." }, { status: 404 });
    }
    if (!k.encryptionKey) {
      return NextResponse.json({ error: "Your client hasn't set up their private inbox yet. Ask them to open their client portal once, then try again." }, { status: 409 });
    }
    return NextResponse.json({ encryptionKey: k.encryptionKey, midnightCoinKey: k.midnightCoinKey }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Lookup failed. Please try again." }, { status: 503 });
  }
}
