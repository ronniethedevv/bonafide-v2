import { NextResponse } from "next/server";
import { generateSiweNonce } from "viem/siwe";
import { sessionKey } from "@/lib/auth/token";
import { SIWE_TTL_MS } from "@/lib/auth/siwe";
import { NONCE_COOKIE, cookieOpts } from "@/lib/session";

// Step 1 of wallet sign-in: a one-time nonce the wallet will sign. Held in an httpOnly
// cookie so the verify step can check the signed message was made for THIS request.
export async function GET() {
  if (!sessionKey()) {
    return NextResponse.json({ error: "Wallet sign-in isn't configured on this deployment yet." }, { status: 503 });
  }
  const nonce = generateSiweNonce();
  const res = NextResponse.json({ nonce }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(NONCE_COOKIE, nonce, cookieOpts(SIWE_TTL_MS / 1000));
  return res;
}
