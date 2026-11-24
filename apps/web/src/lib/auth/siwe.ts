// Sign-In with Ethereum (EIP-4361) verification — pure, framework-free, unit-tested.
//
// The browser asks the wallet to sign a SIWE message that names this site's domain, a
// one-time nonce the server issued, the chain, and a short expiry. The server accepts it
// only if every field matches what it expects AND the signature recovers to the address.
// Ordinary wallets (EOAs) are checked locally; smart-contract wallets (Safe, Coinbase
// Smart Wallet) fall back to an on-chain ERC-1271 / ERC-6492 check via the chain's RPC.
//
// The signature never authorises a transaction: it only proves control of an address.

import { createPublicClient, http, isAddressEqual, recoverMessageAddress, type Address, type Hex } from "viem";
import { base, mainnet } from "viem/chains";
import { parseSiweMessage, validateSiweMessage, verifySiweMessage } from "viem/siwe";
import { SIWE_STATEMENT, SIWE_TTL_MS } from "./shared";

/** Chains a sign-in may name. Base and Ethereum are the chains we index. */
export const SIWE_CHAINS = { 1: mainnet, 8453: base } as const;
export type SiweChainId = keyof typeof SIWE_CHAINS;

export { SIWE_STATEMENT, SIWE_TTL_MS };
const CLOCK_SKEW_MS = 60_000;

export interface SiweExpectation {
  domain: string; // host the browser is on, e.g. "bonafide-v2.vercel.app"
  origin: string; // e.g. "https://bonafide-v2.vercel.app"
  nonce: string; // issued by the server, held in an httpOnly cookie
  now?: Date;
  /** Chain RPC for smart-wallet checks; return undefined to skip (EOA-only). */
  rpcUrl?: (chainId: SiweChainId) => string | undefined;
}

export type SiweResult =
  | { ok: true; address: Address; chainId: SiweChainId; kind: "eoa" | "contract" }
  | { ok: false; reason: string };

export function isSiweChain(id: number | undefined): id is SiweChainId {
  return id !== undefined && Object.prototype.hasOwnProperty.call(SIWE_CHAINS, id);
}

export async function verifySignIn(message: string, signature: Hex, expect: SiweExpectation): Promise<SiweResult> {
  const now = expect.now ?? new Date();
  let fields: ReturnType<typeof parseSiweMessage>;
  try {
    fields = parseSiweMessage(message);
  } catch {
    return { ok: false, reason: "malformed sign-in message" };
  }
  const { address, chainId, domain, nonce, uri, issuedAt, expirationTime, version, statement } = fields;

  if (!address || !chainId || !domain || !nonce || !uri || !issuedAt || !expirationTime || version !== "1") {
    return { ok: false, reason: "sign-in message is missing required fields" };
  }
  if (!isSiweChain(chainId)) return { ok: false, reason: "unsupported chain (use Ethereum or Base)" };
  if (domain !== expect.domain) return { ok: false, reason: "message was signed for a different site" };
  let uriOrigin: string;
  try {
    uriOrigin = new URL(uri).origin;
  } catch {
    return { ok: false, reason: "malformed sign-in URI" };
  }
  if (uriOrigin !== expect.origin) return { ok: false, reason: "message was signed for a different site" };
  if (nonce !== expect.nonce) return { ok: false, reason: "sign-in request expired or already used; try again" };
  if (statement !== SIWE_STATEMENT) return { ok: false, reason: "unexpected sign-in statement" };

  // Freshness: issued recently, short-lived, not from the future.
  if (issuedAt.getTime() > now.getTime() + CLOCK_SKEW_MS) return { ok: false, reason: "message issued in the future" };
  if (now.getTime() - issuedAt.getTime() > SIWE_TTL_MS) return { ok: false, reason: "sign-in request expired; try again" };
  if (expirationTime.getTime() - issuedAt.getTime() > SIWE_TTL_MS + CLOCK_SKEW_MS) {
    return { ok: false, reason: "sign-in message lives too long" };
  }
  if (!validateSiweMessage({ message: fields, domain: expect.domain, nonce: expect.nonce, time: now })) {
    return { ok: false, reason: "sign-in request expired; try again" };
  }

  // 1) Ordinary wallet: recover the signer locally — no network.
  try {
    const signer = await recoverMessageAddress({ message, signature });
    if (isAddressEqual(signer, address)) return { ok: true, address, chainId, kind: "eoa" };
  } catch {
    // not a plain 65-byte ECDSA signature — may be a smart-wallet signature
  }

  // 2) Smart-contract wallet: ask the chain (ERC-1271, or ERC-6492 for undeployed wallets).
  const rpc = expect.rpcUrl?.(chainId);
  if (rpc === undefined) return { ok: false, reason: "signature does not match the address" };
  try {
    const client = createPublicClient({ chain: SIWE_CHAINS[chainId], transport: http(rpc || undefined) });
    const valid = await verifySiweMessage(client, { message, signature, address, domain: expect.domain, nonce: expect.nonce, time: now });
    return valid ? { ok: true, address, chainId, kind: "contract" } : { ok: false, reason: "signature does not match the address" };
  } catch {
    return { ok: false, reason: "could not verify the wallet's signature on-chain; try again" };
  }
}
