import { NextResponse } from "next/server";
import { sessionKey } from "@/lib/auth/token";
import { db } from "@/lib/db/pool";
import { ping } from "@/lib/db/store";

export const dynamic = "force-dynamic";

// Is the deployment wired up? Reports only on/off states, never configuration values.
export async function GET() {
  const pool = db();
  let database: "ok" | "not-configured" | "unreachable" = "not-configured";
  if (pool) {
    try {
      database = (await ping(pool)) ? "ok" : "unreachable";
    } catch {
      database = "unreachable";
    }
  }
  return NextResponse.json(
    { walletSignIn: sessionKey() ? "on" : "off", database },
    { headers: { "Cache-Control": "no-store" } },
  );
}
