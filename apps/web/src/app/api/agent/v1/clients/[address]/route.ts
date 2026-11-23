import { NextResponse, type NextRequest } from "next/server";
import { authAgent } from "@/lib/agent/auth";
import { clientKeys } from "@/lib/engagement/propose";

// The client's public keys, for the agent creating a proposal: the inbox key to seal the
// terms to, and the Midnight coin key the bond names.
export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const a = await authAgent(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const { address } = await params;
  return clientKeys(a.pool, address);
}
