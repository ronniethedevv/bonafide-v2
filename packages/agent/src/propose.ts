// The market maker creates and proposes an engagement on its own machine: the website never
// sees the trading wallets, only the two commitments and the terms sealed to the client.
//
//   createOpening    fresh secrets, the real commitments and the registration's public
//                    arguments (the bond names the client's own Midnight key); the caller
//                    seals it to a local file
//   ownershipTasks   the message each committed wallet must sign (a signature, no transaction)
//   attachOwnership  verify every signature (smart wallets on their chain) and add them
//   proposalFor      the request the server stores: commitments + the sealed client copy

import {
  clientPayload, contexts, newOpening, ownershipMessage, registrationFingerprint, seal, termsFromJson,
  type EngagementOpening, type TermsJson, type TokenInfo,
} from "@mmr/engagement-file";
import { verifyWalletOwnership, type SignatureVerifiers } from "@mmr/engagement-file/verify";
import { verifiers as defaultVerifiers } from "./verifiers.js";

export interface NewEngagement {
  clientAddress: string;
  /** Midnight coin public key the client saved (from the server): the bond's beneficiary. */
  beneficiary: string;
  chainId: number;
  pool: { address: string; pair: string; base?: TokenInfo; quote?: TokenInfo };
  wallets: string[];
  terms: TermsJson;
  tier: number;
  bond: string;
  label?: string;
}

const ADDR = /^0x[0-9a-f]{40}$/;
const CHAIN_NAME: Record<number, string> = { 8453: "Base", 1: "Ethereum" };

export async function createOpening(e: NewEngagement): Promise<EngagementOpening> {
  const wallets = e.wallets.map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (wallets.length === 0 || !wallets.every((w) => ADDR.test(w))) throw new Error("wallets must be 0x addresses");
  if (new Set(wallets).size !== wallets.length) throw new Error("a wallet is listed twice");
  const pool = e.pool.address.toLowerCase();
  if (!ADDR.test(pool)) throw new Error("the pool is not an address");
  if (!/^[0-9a-f]{64}$/.test(e.beneficiary.replace(/^0x/, "").toLowerCase())) {
    throw new Error("the client has not saved a Midnight key yet: ask them to save it in their portal");
  }
  if (![1, 2, 3].includes(e.tier)) throw new Error("tier is 1 (A), 2 (B) or 3 (C)");
  // The pool is committed with the terms (DD-38): always this engagement's pool.
  const terms = termsFromJson({ ...e.terms, pool: BigInt(pool).toString() });
  return newOpening({
    pool: { chain: CHAIN_NAME[e.chainId] ?? String(e.chainId), address: pool, pair: e.pool.pair, ...(e.pool.base ? { base: e.pool.base } : {}), ...(e.pool.quote ? { quote: e.pool.quote } : {}) },
    client: { address: e.clientAddress.toLowerCase() },
    ...(e.label ? { label: e.label } : {}),
    wallets,
    terms,
    human: {},
    registration: { tier: e.tier, chainId: e.chainId, bond: e.bond, beneficiary: e.beneficiary.replace(/^0x/, "").toLowerCase() },
  });
}

/** What each committed wallet signs for this engagement. */
export async function ownershipTasks(o: EngagementOpening): Promise<{ wallet: string; message: string }[]> {
  const fingerprint = await registrationFingerprint(o.commitments.walletCommit, o.commitments.termsCommit);
  const chainId = o.registration?.chainId ?? 8453;
  return o.wallets.map((wallet) => ({ wallet, message: ownershipMessage({ wallet, chainId, fingerprint }) }));
}

/** Verify a signature for every committed wallet and add them; throws listing what is missing or wrong. */
export async function attachOwnership(
  o: EngagementOpening,
  signatures: Record<string, string>,
  verifiers: SignatureVerifiers = defaultVerifiers,
): Promise<EngagementOpening> {
  const fingerprint = await registrationFingerprint(o.commitments.walletCommit, o.commitments.termsCommit);
  const chainId = o.registration?.chainId ?? 8453;
  const byWallet = new Map(Object.entries(signatures).map(([w, s]) => [w.toLowerCase(), s]));
  const results = await Promise.all(
    o.wallets.map((wallet) => verifyWalletOwnership({ wallet, signature: byWallet.get(wallet) ?? "", chainId, fingerprint }, verifiers)),
  );
  const bad = results.filter((r) => !r.ok);
  if (bad.length) throw new Error(`wallet ownership not proven: ${bad.map((r) => `${r.wallet} (${r.detail})`).join(", ")}`);
  return { ...o, ownership: o.wallets.map((wallet) => ({ wallet, signature: byWallet.get(wallet)!.trim() })) };
}

/** The proposal the server stores: the commitments and the client's copy sealed to its inbox key. */
export async function proposalFor(o: EngagementOpening, clientInboxKey: string) {
  if (!o.client.address) throw new Error("the engagement names no client address");
  if (!o.ownership || o.ownership.length !== o.wallets.length) throw new Error("prove the wallets' ownership first");
  const { walletCommit, termsCommit } = o.commitments;
  return {
    clientAddress: o.client.address,
    walletCommit,
    termsCommit,
    termsEnvelope: await seal(JSON.stringify(clientPayload(o)), clientInboxKey, contexts.terms(walletCommit, termsCommit)),
  };
}
