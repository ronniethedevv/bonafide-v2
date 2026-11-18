import { NextResponse, type NextRequest } from "next/server";
import { authAgent } from "@/lib/agent/auth";
import { PHASES, reportEpochPhase, type Phase } from "@/lib/db/agent-store";

// The agent reports how far an epoch has got. Phases only — never whether it passed.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; epoch: string }> }) {
  const a = await authAgent(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const { id, epoch: epochStr } = await params;
  const epoch = Number(epochStr);
  if (!Number.isInteger(epoch) || epoch < 1 || epoch > 90) return NextResponse.json({ error: "Epoch must be 1 to 90." }, { status: 400 });
  let body: { phase?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (typeof body.phase !== "string" || !(PHASES as readonly string[]).includes(body.phase)) {
    return NextResponse.json({ error: `Phase must be one of ${PHASES.join(", ")}.` }, { status: 400 });
  }
  try {
    const r = await reportEpochPhase(a.pool, { registrationId: id, mmAccountId: a.agent.accountId, epoch, phase: body.phase as Phase });
    if (r === "not-found") return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (r === "not-accepted") return NextResponse.json({ error: "The client hasn't accepted this engagement yet." }, { status: 409 });
    if (r === "backwards") return NextResponse.json({ error: "That epoch is already further along." }, { status: 409 });
    return NextResponse.json({ ok: true, changed: r === "ok" });
  } catch {
    return NextResponse.json({ error: "Couldn't save the report." }, { status: 503 });
  }
}
