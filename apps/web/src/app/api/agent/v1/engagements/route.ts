import { NextResponse, type NextRequest } from "next/server";
import { authAgent } from "@/lib/agent/auth";
import { agentEngagements } from "@/lib/db/agent-store";

// The agent's work list: the market maker's engagements, their commitments (to match the
// engagement files it holds), the client's inbox key (to seal figures) and progress so far.
export async function GET(req: NextRequest) {
  const a = await authAgent(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  try {
    return NextResponse.json({ engagements: await agentEngagements(a.pool, a.agent.accountId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load engagements." }, { status: 503 });
  }
}
