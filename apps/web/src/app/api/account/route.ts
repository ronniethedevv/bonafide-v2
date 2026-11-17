import { NextResponse, type NextRequest } from "next/server";
import {
  PREVIEW_ACCOUNT_AUD,
  PREVIEW_ACCOUNT_TTL_S,
  SESSION_AUD,
  SESSION_TTL_S,
  readToken,
  sessionKey,
  signToken,
  type WalletClaims,
} from "@/lib/auth/token";
import { validateNewAccount } from "@/lib/auth/accounts";
import { db } from "@/lib/db/pool";
import { createAccount, findAccountByAddress } from "@/lib/db/store";
import { PREVIEW_ACCOUNT_COOKIE, WALLET_SESSION_COOKIE, cookieOpts, homeOf, safeNext } from "@/lib/session";

// Onboarding: link a signed-in wallet to a new market-maker or client account.
// With a database connected the account is stored in Postgres; without one it is saved
// as a signed cookie in this browser ("preview account").
export async function POST(req: NextRequest) {
  const key = sessionKey();
  if (!key) return NextResponse.json({ error: "Wallet sign-in isn't configured." }, { status: 503 });

  const claims = await readToken<WalletClaims>(req.cookies.get(WALLET_SESSION_COOKIE)?.value, key, SESSION_AUD);
  if (!claims?.addr) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  if (claims.acct) return NextResponse.json({ error: "This wallet already has an account." }, { status: 409 });

  let body: { role?: unknown; name?: unknown; handle?: unknown; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const v = validateNewAccount(body, claims.addr);
  if (!v.ok) return NextResponse.json({ errors: v.errors }, { status: 422 });

  const pool = db();
  if (pool) {
    let account = v.account;
    try {
      const created = await createAccount(pool, claims.addr, claims.chainId, v.account);
      if (!created.ok && created.error === "handle-taken") {
        return NextResponse.json({ errors: { handle: "That handle is taken." } }, { status: 422 });
      }
      if (!created.ok) {
        // This wallet was linked meanwhile (another tab): sign in to that account instead.
        const existing = await findAccountByAddress(pool, claims.addr);
        if (!existing) throw new Error("wallet linked but account not found");
        account = existing;
      } else {
        account = created.account;
      }
    } catch {
      return NextResponse.json({ error: "Couldn't save your account right now. Please try again." }, { status: 503 });
    }
    const session: WalletClaims = { addr: claims.addr, chainId: claims.chainId, acct: account };
    const res = NextResponse.json({ ok: true, next: safeNext(body.next) ?? homeOf(account) });
    res.cookies.set(WALLET_SESSION_COOKIE, await signToken(session, key, SESSION_AUD, SESSION_TTL_S), cookieOpts(SESSION_TTL_S));
    res.cookies.delete(PREVIEW_ACCOUNT_COOKIE);
    return res;
  }

  const session: WalletClaims = { addr: claims.addr, chainId: claims.chainId, acct: v.account, preview: true };
  const res = NextResponse.json({ ok: true, next: safeNext(body.next) ?? homeOf(v.account) });
  res.cookies.set(WALLET_SESSION_COOKIE, await signToken(session, key, SESSION_AUD, SESSION_TTL_S), cookieOpts(SESSION_TTL_S));
  res.cookies.set(
    PREVIEW_ACCOUNT_COOKIE,
    await signToken({ addr: claims.addr, acct: v.account }, key, PREVIEW_ACCOUNT_AUD, PREVIEW_ACCOUNT_TTL_S),
    cookieOpts(PREVIEW_ACCOUNT_TTL_S),
  );
  return res;
}
