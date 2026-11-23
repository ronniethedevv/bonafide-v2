// Does the market maker control every wallet it committed? Each committed wallet signs
// ownershipMessage (wallet, chain, the registration fingerprint); this runs wherever the check
// is made: the market maker's wizard or agent as it collects the signatures, and the client's
// portal before Accept unlocks. An ordinary wallet's signature is recovered locally; a smart
// wallet's (ERC-1271, or ERC-6492 before deployment) is checked on its chain.
//
// The signature primitives are passed in (the web app and the agent each use their own viem),
// so this package stays free of an EVM library and a bundle never carries two copies.

import { registrationFingerprint } from "./commitments.js";
import { ownershipMessage, type WalletOwnership } from "./ownership.js";

export interface SignatureVerifiers {
  /** The address that signed `message` (EIP-191 personal_sign); throws if it is not a plain signature. */
  recover(message: string, signature: string): Promise<string>;
  /** A smart wallet's signature, checked on its chain (ERC-1271, or ERC-6492 before deployment). */
  smartWallet(a: { address: string; message: string; signature: string; chainId: number }): Promise<boolean>;
}

export interface OwnershipStatus {
  wallet: string;
  ok: boolean;
  /** How it was proven, or why it was not. */
  detail: string;
}

export interface OwnershipCheck {
  /** Every committed wallet is proven. */
  all: boolean;
  wallets: OwnershipStatus[];
}

/** One wallet's signature over the ownership message for this engagement. */
export async function verifyWalletOwnership(
  a: { wallet: string; signature: string; chainId: number; fingerprint: string },
  v: SignatureVerifiers,
): Promise<OwnershipStatus> {
  const wallet = a.wallet.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return { wallet, ok: false, detail: "not an address" };
  const signature = a.signature.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return { wallet, ok: false, detail: "no signature" };
  const message = ownershipMessage({ wallet, chainId: a.chainId, fingerprint: a.fingerprint });
  try {
    if ((await v.recover(message, signature)).toLowerCase() === wallet) return { wallet, ok: true, detail: "signed by the wallet's key" };
  } catch {
    // not a plain ECDSA signature: may be a smart wallet's
  }
  try {
    if (await v.smartWallet({ address: wallet, message, signature, chainId: a.chainId })) {
      return { wallet, ok: true, detail: "signed by the smart wallet (checked on chain)" };
    }
  } catch {
    // the chain could not confirm it
  }
  return { wallet, ok: false, detail: "the signature is not this wallet's, or is for another engagement" };
}

/** Every committed wallet of a proposal, against its ownership signatures. */
export async function checkOwnership(
  p: { wallets: string[]; ownership?: WalletOwnership[]; commitments: { walletCommit: string; termsCommit: string }; registration?: { chainId: number } },
  v: SignatureVerifiers,
): Promise<OwnershipCheck> {
  const fingerprint = await registrationFingerprint(p.commitments.walletCommit, p.commitments.termsCommit);
  const chainId = p.registration?.chainId ?? 8453;
  const wallets = await Promise.all(
    p.wallets.map(async (w) => {
      const sig = p.ownership?.find((o) => o.wallet.toLowerCase() === w.toLowerCase());
      if (!sig) return { wallet: w.toLowerCase(), ok: false, detail: "no signature from this wallet" };
      return verifyWalletOwnership({ wallet: w, signature: sig.signature, chainId, fingerprint }, v);
    }),
  );
  return { all: wallets.length > 0 && wallets.every((w) => w.ok), wallets };
}
