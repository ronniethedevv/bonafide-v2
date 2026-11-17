import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db/pool";
import { registrationForParty } from "@/lib/db/store";

// One registration, for either of its two parties: status, commitments, and the sealed
// terms envelope (which only the client's inbox key opens).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const pool = db();
  if (!session?.accountId || !pool) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  try {
    const v = await registrationForParty(pool, id, session.accountId);
    if (!v) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(
      { registration: v.registration, role: v.role, termsEnvelope: v.termsEnvelope ? JSON.parse(v.termsEnvelope) : null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Couldn't load the engagement." }, { status: 503 });
  }
}
