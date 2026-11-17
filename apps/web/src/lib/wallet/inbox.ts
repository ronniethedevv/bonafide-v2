// The client's private inbox key, re-derived in the browser from a wallet signature.
// Nothing secret is stored: the same wallet recreates the same key on any device. The
// private half lives only in this page's memory.

import { INBOX_KEY_MESSAGE, inboxKeyFromSignature } from "@mmr/engagement-file";
import { signMessage } from "./browser";

let cached: { address: string; privateKey: Uint8Array; publicKey: string } | null = null;

export async function unlockInbox(address: string, expectedPublicKey: string | null): Promise<{ privateKey: Uint8Array; publicKey: string }> {
  if (cached && cached.address === address.toLowerCase() && (!expectedPublicKey || cached.publicKey === expectedPublicKey)) return cached;
  const signature = await signMessage(address, INBOX_KEY_MESSAGE);
  const key = await inboxKeyFromSignature(signature);
  if (expectedPublicKey && key.publicKey !== expectedPublicKey) {
    throw new Error(
      "This wallet produced a different key from the one on your account. Use the wallet you set up your inbox with. (Wallets that don't sign repeatably, such as some smart or MPC wallets, can't use the private inbox yet.)",
    );
  }
  cached = { address: address.toLowerCase(), ...key };
  return cached;
}
