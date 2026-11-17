// Accounts: which market maker or client a signed-in wallet acts for.
//
// The wallet used to SIGN IN is an identity wallet. It must not be one of the MM's
// quoting wallets: linking it to an account tells our server who it belongs to, and
// quoting wallets are private (they exist only on the MM's machine, committed by hash).
//
// Storage today (no database connected): an account lives in a signed cookie in the
// user's own browser ("preview account"), plus optional operator-configured links from a
// wallet to one of the demo accounts (DEMO_WALLET_LINKS). The AccountStore port below is
// what a Postgres adapter (packages/db: Account + AccountWallet) will implement.

import { listProfiles } from "@mmr/read-model";
import { WORLD } from "../world";
import type { AccountClaim } from "./token";

export interface AccountStore {
  findByAddress(address: string): Promise<AccountClaim | undefined>;
  link(address: string, account: AccountClaim): Promise<void>;
}

/** Handles already taken by existing market makers — a new account may not claim them. */
export function reservedHandles(): Set<string> {
  return new Set([...WORLD.workspaces.map((w) => w.handle), ...listProfiles().map((p) => p.handle)]);
}

/**
 * Operator links from wallet → demo account, e.g.
 *   DEMO_WALLET_LINKS="0xAbc…=mm:vega-mm,0xDef…=client:orion"
 * so a real wallet can sign in AS a demo account for a walkthrough.
 */
export function parseWalletLinks(raw: string | undefined): Map<string, AccountClaim> {
  const out = new Map<string, AccountClaim>();
  for (const part of (raw ?? "").split(",")) {
    const [addr, target] = part.trim().split("=");
    if (!addr || !target || !/^0x[0-9a-fA-F]{40}$/.test(addr)) continue;
    const [kind, id] = target.split(":");
    if (kind === "mm") {
      const ws = WORLD.workspaces.find((w) => w.handle === id);
      if (ws) out.set(addr.toLowerCase(), { kind: "mm", handle: ws.handle, name: ws.displayName });
    } else if (kind === "client" && id && WORLD.clients[id]) {
      out.set(addr.toLowerCase(), { kind: "client", clientId: id, name: WORLD.clients[id]!.name });
    }
  }
  return out;
}

export interface NewAccountInput {
  role?: unknown;
  name?: unknown;
  handle?: unknown;
}

export type NewAccountResult = { ok: true; account: AccountClaim } | { ok: false; errors: Record<string, string> };

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

/** Validate the onboarding form for a signed-in wallet. */
export function validateNewAccount(input: NewAccountInput, address: string): NewAccountResult {
  const errors: Record<string, string> = {};
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 60) errors.name = "Use 2 to 60 characters.";
  else if (/[<>{}\u0000-\u001f]/.test(name)) errors.name = "Letters, numbers and basic punctuation only.";

  if (input.role === "mm") {
    const handle = typeof input.handle === "string" ? input.handle.trim().toLowerCase() : "";
    if (!HANDLE_RE.test(handle)) errors.handle = "3 to 30 characters: lowercase letters, numbers and dashes.";
    else if (reservedHandles().has(handle)) errors.handle = "That handle is taken.";
    const taken = WORLD.workspaces.some((w) => w.displayName.toLowerCase() === name.toLowerCase());
    if (!errors.name && taken) errors.name = "That name belongs to an existing market maker.";
    if (Object.keys(errors).length) return { ok: false, errors };
    return { ok: true, account: { kind: "mm", handle, name } };
  }
  if (input.role === "client") {
    if (Object.keys(errors).length) return { ok: false, errors };
    // Deterministic per wallet, and never collides with the demo clients' ids.
    return { ok: true, account: { kind: "client", clientId: `acct-${address.slice(2, 12).toLowerCase()}`, name } };
  }
  errors.role = "Choose market maker or client.";
  return { ok: false, errors };
}

export { slugify, shortAddress } from "./shared";
