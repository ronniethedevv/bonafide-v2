import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db/pool";
import { registrationForParty } from "@/lib/db/store";
import { findEngagementByCommitments } from "@/lib/chain/engagement";

// The engagement on Midnight that carries this registration's wallet and terms
// commitments, for either of its two parties. Only public chain state is returned; the
// client compares it with the terms it accepted before sending the loan.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const pool = db();
  if (!session?.accountId || !pool) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  try {
    const v = await registrationForParty(pool, id, session.accountId);
    if (!v) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const { walletCommit, termsCommit } = v.registration;
    if (!walletCommit || !termsCommit) return NextResponse.json({ engagement: null }, { headers: { "Cache-Control": "no-store" } });
    const engagement = await findEngagementByCommitments(walletCommit, termsCommit);
    return NextResponse.json({ engagement }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't read the contract." }, { status: 503 });
  }
}
