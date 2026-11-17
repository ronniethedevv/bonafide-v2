import { NextResponse, type NextRequest } from "next/server";
import { NONCE_COOKIE, SESSION_COOKIE, WALLET_SESSION_COOKIE, cookieOpts, homeOf, personaById, safeNext } from "@/lib/session";

// Demo-account sign-in and sign-out for every session type. A plain form POST (works
// without client JS): sets or clears cookies and redirects (303).
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const persona = form.get("persona");
  const next = safeNext(form.get("next"));

  if (persona === "signout") {
    const res = NextResponse.redirect(new URL("/", req.url), 303);
    res.cookies.delete(SESSION_COOKIE);
    res.cookies.delete(WALLET_SESSION_COOKIE);
    res.cookies.delete(NONCE_COOKIE);
    // The browser's preview account is kept, so the same wallet finds it on next sign-in.
    return res;
  }

  const session = personaById(typeof persona === "string" ? persona : undefined);
  if (!session) return NextResponse.redirect(new URL("/signin", req.url), 303);

  const res = NextResponse.redirect(new URL(next ?? homeOf(session), req.url), 303);
  res.cookies.set(SESSION_COOKIE, session.id, cookieOpts(60 * 60 * 24 * 7));
  res.cookies.delete(WALLET_SESSION_COOKIE); // a demo account replaces any wallet session
  return res;
}
