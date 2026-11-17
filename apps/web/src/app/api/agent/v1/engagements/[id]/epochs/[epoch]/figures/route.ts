import { NextResponse, type NextRequest } from "next/server";
import { isEnvelope } from "@mmr/engagement-file";
import { authAgent } from "@/lib/agent/auth";
import { addEpochMessage } from "@/lib/db/store";

// The agent posts an epoch's figures, sealed to the client's inbox key. We store ciphertext.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; epoch: string }> }) {
  const a = await authAgent(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const { id, epoch: epochStr } = await params;
  const epoch = Number(epochStr);
  if (!Number.isInteger(epoch) || epoch < 1 || epoch > 90) return NextResponse.json({ error: "Epoch must be 1 to 90." }, { status: 400 });
  let body: { envelope?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!isEnvelope(body.envelope)) return NextResponse.json({ error: "Bad sealed figures." }, { status: 400 });
  try {
    const r = await addEpochMessage(a.pool, { id, mmAccountId: a.agent.accountId, epoch, envelope: JSON.stringify(body.envelope) });
    if (r === "not-found") return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (r === "not-accepted") return NextResponse.json({ error: "The client hasn't accepted this engagement yet." }, { status: 409 });
    if (r === "duplicate") return NextResponse.json({ error: "Figures for this epoch were already shared." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save the figures." }, { status: 503 });
  }
}
