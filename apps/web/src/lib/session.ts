// Who is signed in, and as which account.
//
// Two ways in:
//  1. Wallet sign-in (Sign-In with Ethereum): a signed, httpOnly session token holding the
//     wallet address and the account it is linked to. This is the real path.
//  2. Demo accounts: pick one of the four accounts in the demo world. The cookie holds just
//     a persona id; it exists so anyone can walk the product without a wallet.
//
// Every private page is scoped to the resulting account: an MM sees only their own
// workspace, a client only the engagements they are party to.

import { cookies } from "next/headers";
import { WORLD } from "./world";
import { readToken, sessionKey, SESSION_AUD, type WalletClaims } from "./auth/token";
import { dbConfigured } from "./db/pool";

export const SESSION_COOKIE = "mmr_demo_persona";
export const WALLET_SESSION_COOKIE = "mmr_session";
export const NONCE_COOKIE = "mmr_siwe_nonce";
export const PREVIEW_ACCOUNT_COOKIE = "mmr_preview_account";

interface SessionBase {
  /** How the visitor signed in. */
  via: "demo" | "wallet";
  /** Identity wallet, for wallet sessions. */
  address?: `0x${string}`;
  /** Account kept only in this browser (no database connected yet). */
  preview?: boolean;
  /** Database account id, for wallet accounts stored in Postgres. */
  accountId?: string;
}

export type Session =
  | (SessionBase & { kind: "mm"; id: string; handle: string; name: string })
  | (SessionBase & { kind: "client"; id: string; clientId: string; name: string });

export interface Persona {
  session: Session;
  blurb: string;
}

export const PERSONAS: Persona[] = [
  ...WORLD.workspaces.map((w) => ({
    session: { via: "demo" as const, kind: "mm" as const, id: `mm:${w.handle}`, handle: w.handle, name: w.displayName },
    blurb: `${w.engagements.length} engagements · clients ${[...new Set(w.engagements.map((e) => WORLD.clients[e.clientId]?.name ?? e.clientId))].join(", ")}`,
  })),
  ...Object.entries(WORLD.clients).map(([clientId, c]) => {
    const mms = WORLD.workspaces.filter((w) => w.engagements.some((e) => e.clientId === clientId));
    const n = mms.reduce((s, w) => s + w.engagements.filter((e) => e.clientId === clientId).length, 0);
    return {
      session: { via: "demo" as const, kind: "client" as const, id: `client:${clientId}`, clientId, name: c.name },
      blurb: `${n} engagements · with ${mms.map((w) => w.displayName).join(", ")}`,
    };
  }),
];

export function personaById(id: string | undefined): Session | undefined {
  return id ? PERSONAS.find((p) => p.session.id === id)?.session : undefined;
}

export interface Auth {
  session?: Session;
  /** Signed in with a wallet that hasn't been linked to an account yet. */
  pendingWallet?: { address: `0x${string}`; chainId: number };
  /** Wallet sign-in is available (a session key is configured). */
  walletEnabled: boolean;
  /** Accounts are stored in the database (vs. this browser only). */
  persistent: boolean;
}

function fromWallet(c: WalletClaims): Session | undefined {
  if (!c.acct) return undefined;
  const base = {
    via: "wallet" as const,
    address: c.addr,
    ...(c.preview ? { preview: true } : {}),
    ...(c.acct.id ? { accountId: c.acct.id } : {}),
  };
  return c.acct.kind === "mm"
    ? { ...base, kind: "mm", id: `wallet:${c.addr.toLowerCase()}`, handle: c.acct.handle, name: c.acct.name }
    : { ...base, kind: "client", id: `wallet:${c.addr.toLowerCase()}`, clientId: c.acct.clientId, name: c.acct.name };
}

export async function getAuth(): Promise<Auth> {
  const jar = await cookies();
  const key = sessionKey();
  if (key) {
    const claims = await readToken<WalletClaims>(jar.get(WALLET_SESSION_COOKIE)?.value, key, SESSION_AUD);
    if (claims?.addr) {
      const session = fromWallet(claims);
      return session
        ? { session, walletEnabled: true, persistent: dbConfigured() }
        : { pendingWallet: { address: claims.addr, chainId: claims.chainId }, walletEnabled: true, persistent: dbConfigured() };
    }
  }
  const demo = personaById(jar.get(SESSION_COOKIE)?.value);
  return { ...(demo ? { session: demo } : {}), walletEnabled: key !== undefined, persistent: dbConfigured() };
}

export async function getSession(): Promise<Session | undefined> {
  return (await getAuth()).session;
}

/** Where an account lands after signing in. */
export function homeOf(s: Pick<Session, "kind">): string {
  return s.kind === "mm" ? "/dashboard" : "/client";
}

/** Only same-site absolute paths are allowed as post-sign-in destinations. */
export function safeNext(next: unknown): string | undefined {
  if (typeof next !== "string") return undefined;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return undefined;
  return next;
}

/** Cookie options shared by every auth cookie. */
export function cookieOpts(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
