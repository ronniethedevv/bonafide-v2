// Signed, httpOnly session tokens (HS256 JWT via jose). Framework-free so it can be tested.
//
// A wallet session carries only the signed-in address, its chain, and the account it is
// linked to. It never carries trading wallets, terms or figures — those stay with the MM.

import { SignJWT, jwtVerify } from "jose";

/** `id` is set for accounts stored in the database (absent for preview/demo accounts). */
export type AccountClaim =
  | { kind: "mm"; handle: string; name: string; id?: string }
  | { kind: "client"; clientId: string; name: string; id?: string };

export interface WalletClaims {
  addr: `0x${string}`;
  chainId: number;
  /** Linked account; absent until the wallet finishes onboarding. */
  acct?: AccountClaim;
  /** True when the account exists only in this browser (no database connected). */
  preview?: boolean;
}

// The project's earlier name: changing the issuer would end every signed-in session.
const ISSUER = "mm-reputation";
const MIN_SECRET_LEN = 32;
const DEV_SECRET = "dev-only-session-secret-do-not-use-in-production-000";

/**
 * The signing key. Production requires SESSION_SECRET (≥32 chars); without it wallet
 * sign-in is disabled rather than running on a guessable key. Dev/test use a fixed key.
 */
export function sessionKey(env: Record<string, string | undefined> = process.env): Uint8Array | undefined {
  const s = env.SESSION_SECRET;
  if (s && s.length >= MIN_SECRET_LEN) return new TextEncoder().encode(s);
  if (env.NODE_ENV === "production") return undefined;
  return new TextEncoder().encode(DEV_SECRET);
}

export async function signToken<T extends object>(claims: T, key: Uint8Array, audience: string, ttlSeconds: number): Promise<string> {
  return new SignJWT({ ...claims } as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

export async function readToken<T extends object>(token: string | undefined, key: Uint8Array, audience: string): Promise<T | undefined> {
  if (!token) return undefined;
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience, algorithms: ["HS256"] });
    return payload as unknown as T;
  } catch {
    return undefined;
  }
}

export const SESSION_AUD = "session";
export const PREVIEW_ACCOUNT_AUD = "preview-account";
export const SESSION_TTL_S = 7 * 24 * 3600;
export const PREVIEW_ACCOUNT_TTL_S = 30 * 24 * 3600;
