import { NextResponse, type NextRequest } from "next/server";
import { isHex } from "viem";
import { verifySignIn } from "@/lib/auth/siwe";
import {
  PREVIEW_ACCOUNT_AUD,
  SESSION_AUD,
  SESSION_TTL_S,
  readToken,
  sessionKey,
  signToken,
  type AccountClaim,
  type WalletClaims,
} from "@/lib/auth/token";
import { parseWalletLinks } from "@/lib/auth/accounts";
import { db } from "@/lib/db/pool";
import { createAccount, findAccountByAddress } from "@/lib/db/store";
import {
  NONCE_COOKIE,
  PREVIEW_ACCOUNT_COOKIE,
  SESSION_COOKIE,
  WALLET_SESSION_COOKIE,
  cookieOpts,
  homeOf,
  safeNext,
} from "@/lib/session";

// Step 2 of wallet sign-in: check the signed SIWE message, then start a session. If the
// wallet is already linked to an account, go straight in; otherwise go to onboarding.
export async function POST(req: NextRequest) {
  const key = sessionKey();
  if (!key) return NextResponse.json({ error: "Wallet sign-in isn't configured on this deployment yet." }, { status: 503 });

  let body: { message?: unknown; signature?: unknown; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const { message, signature } = body;
  if (typeof message !== "string" || message.length > 2000 || typeof signature !== "string" || !isHex(signature)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const nonce = req.cookies.get(NONCE_COOKIE)?.value;
  if (!nonce) return NextResponse.json({ error: "Sign-in request expired; try again." }, { status: 401 });

  const result = await verifySignIn(message, signature, {
    domain: req.nextUrl.host,
    origin: req.nextUrl.origin,
    nonce,
    // "" = the chain's default public RPC; set BASE_RPC_URL / ETH_RPC_URL for a dedicated one.
    rpcUrl: (chainId) => (chainId === 8453 ? process.env.BASE_RPC_URL : process.env.ETH_RPC_URL) ?? "",
  });

  if (!result.ok) {
    const res = NextResponse.json({ error: result.reason }, { status: 401 });
    res.cookies.delete(NONCE_COOKIE); // one attempt per nonce
    return res;
  }

  const addr = result.address;
  // Which account does this wallet act for? Operator links first, then the database, then
  // (no database) this browser's preview account.
  let acct: AccountClaim | undefined = parseWalletLinks(process.env.DEMO_WALLET_LINKS).get(addr.toLowerCase());
  let preview = false;
  const saved = await readToken<{ addr: string; acct: AccountClaim }>(req.cookies.get(PREVIEW_ACCOUNT_COOKIE)?.value, key, PREVIEW_ACCOUNT_AUD);
  const savedHere = saved && saved.addr.toLowerCase() === addr.toLowerCase() ? saved.acct : undefined;
  const pool = db();
  let upgraded = false;
  if (!acct && pool) {
    try {
      acct = await findAccountByAddress(pool, addr);
      if (!acct && savedHere) {
        // An account made before the database was connected: move it in, if its handle is still free.
        const created = await createAccount(pool, addr, result.chainId, savedHere);
        if (created.ok) {
          acct = created.account;
          upgraded = true;
        }
      }
    } catch {
      return NextResponse.json({ error: "Accounts are temporarily unavailable. Please try again shortly." }, { status: 503 });
    }
  } else if (!acct && savedHere) {
    acct = savedHere;
    preview = true;
  }

  const claims: WalletClaims = { addr, chainId: result.chainId, ...(acct ? { acct } : {}), ...(preview ? { preview } : {}) };
  const next = safeNext(body.next);
  const res = NextResponse.json({
    ok: true,
    next: acct ? (next ?? homeOf(acct)) : `/onboarding${next ? `?next=${encodeURIComponent(next)}` : ""}`,
  });
  res.cookies.set(WALLET_SESSION_COOKIE, await signToken(claims, key, SESSION_AUD, SESSION_TTL_S), cookieOpts(SESSION_TTL_S));
  res.cookies.delete(NONCE_COOKIE);
  res.cookies.delete(SESSION_COOKIE); // a wallet session replaces any demo account
  if (upgraded) res.cookies.delete(PREVIEW_ACCOUNT_COOKIE); // now stored in the database
  return res;
}
