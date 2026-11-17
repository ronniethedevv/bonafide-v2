// WalletConnect (Reown) for custody and phone wallets: Fireblocks, Safe{Wallet}, mobile
// apps. Loaded only when someone picks it, so it adds nothing to the page otherwise. The
// session persists in the browser, so later signatures (private inbox key, accepting an
// engagement) reuse the same connection.

import type { EthereumProvider } from "@walletconnect/ethereum-provider";

type WcProvider = Awaited<ReturnType<typeof EthereumProvider.init>>;

const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export function walletConnectEnabled(): boolean {
  return PROJECT_ID.length > 0;
}

let providerPromise: Promise<WcProvider> | null = null;

/** The shared WalletConnect provider (restores an existing session if there is one). */
export function getWalletConnectProvider(): Promise<WcProvider> {
  if (!walletConnectEnabled()) return Promise.reject(new Error("WalletConnect isn't configured on this deployment."));
  providerPromise ??= import("@walletconnect/ethereum-provider")
    .then(({ EthereumProvider }) =>
      EthereumProvider.init({
        projectId: PROJECT_ID,
        // Optional rather than required, so any wallet can connect; sign-in then asks for Base or Ethereum.
        optionalChains: [8453, 1],
        showQrModal: true,
        rpcMap: { 8453: "https://mainnet.base.org", 1: "https://ethereum-rpc.publicnode.com" },
        metadata: {
          name: "MM Reputation",
          description: "Verified reputation records for crypto market makers.",
          url: window.location.origin,
          icons: [],
        },
      }),
    )
    .catch((e: unknown) => {
      providerPromise = null; // allow a retry after a failed load
      throw e;
    });
  return providerPromise;
}

/** Connect (shows the QR / wallet list) unless a session already exists; returns the accounts. */
export async function connectWalletConnect(): Promise<{ provider: WcProvider; accounts: string[] }> {
  const provider = await getWalletConnectProvider();
  if (!provider.session) await provider.connect();
  return { provider, accounts: provider.accounts };
}
