// Client-safe auth constants and helpers (no server-only imports), shared by the wallet
// sign-in UI in the browser and the verifier on the server.

export const SIWE_STATEMENT =
  "Sign in to BonaFide v2. This only proves you control this address: it sends no transaction and costs nothing.";

/** How long a nonce / signed sign-in message stays usable. */
export const SIWE_TTL_MS = 10 * 60_000;

/** Chain ids a sign-in may name: Ethereum and Base, the chains we index. */
export const SIGNIN_CHAIN_IDS = [1, 8453] as const;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
