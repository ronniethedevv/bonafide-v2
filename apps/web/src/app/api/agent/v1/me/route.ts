import { NextResponse, type NextRequest } from "next/server";
import { authAgent } from "@/lib/agent/auth";

// The agent checks its token and learns which market maker it works for.
export async function GET(req: NextRequest) {
  const a = await authAgent(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  return NextResponse.json({ handle: a.agent.handle, name: a.agent.name }, { headers: { "Cache-Control": "no-store" } });
}
