import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, homeOf, personaById, safeNext } from "@/lib/session";

// Demo sign-in / sign-out. A plain form POST (works without client JS): sets or clears the
// persona cookie and redirects (303) to where the visitor was heading.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const persona = form.get("persona");
  const next = safeNext(form.get("next"));

  if (persona === "signout") {
    const res = NextResponse.redirect(new URL("/", req.url), 303);
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  const session = personaById(typeof persona === "string" ? persona : undefined);
  if (!session) return NextResponse.redirect(new URL("/signin", req.url), 303);

  const res = NextResponse.redirect(new URL(next ?? homeOf(session), req.url), 303);
  res.cookies.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
