// Browser-only helpers: find the signed-in wallet among installed wallets (EIP-6963) and
// ask it to sign a plain-text message. Used for the private inbox key and for accepting.

import { stringToHex } from "viem";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
interface Announced {
  info: { uuid: string; name: string };
  provider: Eip1193;
}

export function discoverProviders(waitMs = 400): Promise<Announced[]> {
  return new Promise((resolve) => {
    const found = new Map<string, Announced>();
    const onAnnounce = (ev: Event) => {
      const d = (ev as CustomEvent<Announced>).detail;
      if (d?.info?.uuid && d.provider) found.set(d.info.uuid, d);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const legacy = (window as unknown as { ethereum?: Eip1193 }).ethereum;
      if (found.size === 0 && legacy) found.set("legacy", { info: { uuid: "legacy", name: "Browser wallet" }, provider: legacy });
      resolve([...found.values()]);
    }, waitMs);
  });
}

export function walletErrorText(e: unknown): string {
  const err = e as { code?: number; message?: string } | undefined;
  if (err?.code === 4001) return "You cancelled the request in your wallet.";
  if (err?.code === -32002) return "Your wallet already has a request open. Check the wallet window.";
  return err?.message && err.message.length < 200 ? err.message : "Something went wrong with your wallet. Please try again.";
}

/** The installed wallet that controls `address` (asking for access if needed). */
export async function providerFor(address: string): Promise<Eip1193> {
  const want = address.toLowerCase();
  const providers = await discoverProviders();
  if (providers.length === 0) throw new Error("No browser wallet found. Open this page in the wallet you signed in with.");
  for (const p of providers) {
    try {
      const accts = (await p.provider.request({ method: "eth_accounts" })) as string[];
      if (accts?.some((a) => a.toLowerCase() === want)) return p.provider;
    } catch {
      // wallet locked or not permitted yet
    }
  }
  for (const p of providers) {
    const accts = (await p.provider.request({ method: "eth_requestAccounts" })) as string[];
    if (accts?.some((a) => a.toLowerCase() === want)) return p.provider;
  }
  throw new Error(`Switch your wallet to ${address.slice(0, 6)}…${address.slice(-4)}, the wallet you signed in with.`);
}

/** EIP-191 personal_sign of `message` by `address`. */
export async function signMessage(address: string, message: string): Promise<`0x${string}`> {
  const provider = await providerFor(address);
  return (await provider.request({ method: "personal_sign", params: [stringToHex(message), address] })) as `0x${string}`;
}
