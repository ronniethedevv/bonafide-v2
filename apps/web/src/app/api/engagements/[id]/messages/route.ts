import { NextResponse, type NextRequest } from "next/server";
import { isEnvelope } from "@mmr/engagement-file";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db/pool";
import { addEpochMessage, epochMessages } from "@/lib/db/store";

// Per-epoch figures, sealed by the market maker to the client's inbox key. The server
// relays ciphertext it cannot read. Posting is for the MM (the MM agent will do this
// daily); reading is for either party (only the client can open them).

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const pool = db();
  if (!session?.accountId || !pool) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  try {
    const msgs = await epochMessages(pool, id, session.accountId);
    if (!msgs) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(
      { messages: msgs.map((m) => ({ epoch: m.epoch, createdAt: m.createdAt, envelope: JSON.parse(m.envelope) })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Couldn't load messages." }, { status: 503 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const pool = db();
  if (session?.kind !== "mm" || !session.accountId || !pool) return NextResponse.json({ error: "Sign in as the market maker first." }, { status: 401 });
  let body: { epoch?: unknown; envelope?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (typeof body.epoch !== "number" || !Number.isInteger(body.epoch) || body.epoch < 1 || body.epoch > 90) {
    return NextResponse.json({ error: "Epoch must be 1 to 90." }, { status: 400 });
  }
  if (!isEnvelope(body.envelope)) return NextResponse.json({ error: "Bad sealed message." }, { status: 400 });
  try {
    const r = await addEpochMessage(pool, { id, mmAccountId: session.accountId, epoch: body.epoch, envelope: JSON.stringify(body.envelope) });
    if (r === "not-found") return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (r === "not-accepted") return NextResponse.json({ error: "The client hasn't accepted this engagement yet." }, { status: 409 });
    if (r === "duplicate") return NextResponse.json({ error: "Figures for this epoch were already shared." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save the message." }, { status: 503 });
  }
}
