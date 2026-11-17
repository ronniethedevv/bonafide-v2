import { NextResponse, type NextRequest } from "next/server";
import { isHex } from "viem";
import { acceptanceMessage } from "@mmr/engagement-file";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db/pool";
import { registrationForParty, respondToRegistration } from "@/lib/db/store";
import { verifyWalletSignature } from "@/lib/auth/signature";

// The client accepts or declines a proposed engagement. Accepting requires a signature
// from the client's signed-in wallet over a message naming the engagement and both
// commitments, so the acceptance is verifiable later (e.g. in a dispute), not just a click.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const pool = db();
  if (session?.kind !== "client" || !session.accountId || !session.address || !pool) {
    return NextResponse.json({ error: "Sign in as the client with your wallet first." }, { status: 401 });
  }
  let body: { decision?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (body.decision !== "accept" && body.decision !== "decline") return NextResponse.json({ error: "Bad decision." }, { status: 400 });

  try {
    const v = await registrationForParty(pool, id, session.accountId);
    if (!v || v.role !== "client") return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (v.registration.status !== "proposed") return NextResponse.json({ error: "This engagement was already answered." }, { status: 409 });

    if (body.decision === "decline") {
      const ok = await respondToRegistration(pool, { id, clientAccountId: session.accountId, decision: "decline" });
      return ok ? NextResponse.json({ ok: true, status: "declined" }) : NextResponse.json({ error: "Already answered." }, { status: 409 });
    }

    const { walletCommit, termsCommit } = v.registration;
    if (!walletCommit || !termsCommit) return NextResponse.json({ error: "This engagement predates signed acceptance." }, { status: 409 });
    if (typeof body.signature !== "string" || !isHex(body.signature) || body.signature.length > 4000) {
      return NextResponse.json({ error: "Missing signature." }, { status: 400 });
    }
    const message = acceptanceMessage({ registrationId: id, walletCommit, termsCommit });
    const valid = await verifyWalletSignature({ address: session.address, message, signature: body.signature, chainId: session.chainId ?? 8453 });
    if (!valid) return NextResponse.json({ error: "The signature doesn't match your signed-in wallet." }, { status: 401 });

    const ok = await respondToRegistration(pool, { id, clientAccountId: session.accountId, decision: "accept", signature: body.signature, signer: session.address });
    return ok ? NextResponse.json({ ok: true, status: "accepted" }) : NextResponse.json({ error: "Already answered." }, { status: 409 });
  } catch {
    return NextResponse.json({ error: "Couldn't save your answer. Please try again." }, { status: 503 });
  }
}
