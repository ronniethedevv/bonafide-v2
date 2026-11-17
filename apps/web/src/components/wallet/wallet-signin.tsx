"use client";

import { useEffect, useState } from "react";
import { getAddress, stringToHex } from "viem";
import { createSiweMessage } from "viem/siwe";
import { SIGNIN_CHAIN_IDS, SIWE_STATEMENT, SIWE_TTL_MS, shortAddress } from "@/lib/auth/shared";
import { ArrowRight, Info, Shield } from "@/components/icons";

// Sign in with an EVM wallet (Sign-In with Ethereum, EIP-4361).
//
// Wallets are discovered with EIP-6963, so every installed browser wallet (MetaMask,
// Rabby, Coinbase Wallet, OKX, Phantom…) shows up by name, with a legacy window.ethereum
// fallback. The flow: connect → make sure the wallet is on Ethereum or Base → fetch a
// one-time nonce → sign a plain-text message → the server verifies it and starts a session.

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}
interface Wallet {
  info: WalletInfo;
  provider: Eip1193;
}

type Step = "idle" | "connecting" | "switching" | "signing" | "verifying";

const STEP_TEXT: Record<Exclude<Step, "idle">, string> = {
  connecting: "Approve the connection in your wallet…",
  switching: "Switch your wallet to Base…",
  signing: "Sign the message in your wallet. It costs nothing and sends no transaction.",
  verifying: "Checking your signature…",
};

function errorText(e: unknown): string {
  const err = e as { code?: number; message?: string } | undefined;
  if (err?.code === 4001) return "You cancelled the request in your wallet.";
  if (err?.code === -32002) return "Your wallet already has a request open. Check the wallet window.";
  return err?.message && err.message.length < 160 ? err.message : "Something went wrong. Please try again.";
}

/** Discover installed wallets via EIP-6963 (plus the legacy injected provider). */
function useWallets(): { wallets: Wallet[]; ready: boolean } {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const found = new Map<string, Wallet>();
    const onAnnounce = (ev: Event) => {
      const d = (ev as CustomEvent<Wallet>).detail;
      if (!d?.info?.uuid || !d.provider || found.has(d.info.uuid)) return;
      found.set(d.info.uuid, d);
      setWallets([...found.values()]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = window.setTimeout(() => {
      const legacy = (window as unknown as { ethereum?: Eip1193 }).ethereum;
      if (found.size === 0 && legacy) {
        found.set("legacy", { info: { uuid: "legacy", name: "Browser wallet", icon: "", rdns: "" }, provider: legacy });
        setWallets([...found.values()]);
      }
      setReady(true);
    }, 450);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      window.clearTimeout(t);
    };
  }, []);
  return { wallets, ready };
}

async function ensureSupportedChain(provider: Eip1193, setStep: (s: Step) => void): Promise<number> {
  const current = Number.parseInt(String(await provider.request({ method: "eth_chainId" })), 16);
  if ((SIGNIN_CHAIN_IDS as readonly number[]).includes(current)) return current;
  setStep("switching");
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: "0x2105", chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }],
    });
  }
  return 8453;
}

export function WalletSignIn({ next, enabled }: { next: string | undefined; enabled: boolean }) {
  const { wallets, ready } = useWallets();
  const [step, setStep] = useState<Step>("idle");
  const [active, setActive] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  useEffect(() => setPageUrl(window.location.href), []);

  async function signIn(w: Wallet) {
    setError(null);
    setActive(w.info.uuid);
    try {
      setStep("connecting");
      const accounts = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts?.[0]) throw new Error("No account was shared by the wallet.");
      const addr = getAddress(accounts[0]);
      setAddress(addr);
      const chainId = await ensureSupportedChain(w.provider, setStep);

      const nonceRes = await fetch("/api/auth/nonce", { cache: "no-store" });
      const nonceBody = (await nonceRes.json()) as { nonce?: string; error?: string };
      if (!nonceRes.ok || !nonceBody.nonce) throw new Error(nonceBody.error ?? "Couldn't start sign-in.");

      const now = Date.now();
      const message = createSiweMessage({
        address: addr,
        chainId,
        domain: window.location.host,
        uri: window.location.origin,
        version: "1",
        nonce: nonceBody.nonce,
        statement: SIWE_STATEMENT,
        issuedAt: new Date(now),
        expirationTime: new Date(now + SIWE_TTL_MS - 60_000),
      });

      setStep("signing");
      const signature = await w.provider.request({ method: "personal_sign", params: [stringToHex(message), addr] });

      setStep("verifying");
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature, next }),
      });
      const body = (await res.json()) as { ok?: boolean; next?: string; error?: string };
      if (!res.ok || !body.ok || !body.next) throw new Error(body.error ?? "Sign-in failed.");
      window.location.assign(body.next);
    } catch (e) {
      setError(errorText(e));
      setStep("idle");
      setActive(null);
    }
  }

  if (!enabled) {
    return (
      <div className="card" style={{ padding: "18px 20px" }}>
        <div className="demo-note">
          <Info size={14} />
          <span>Wallet sign-in isn&apos;t switched on for this deployment yet (it needs a session secret). Use a demo account below.</span>
        </div>
      </div>
    );
  }

  const busy = step !== "idle";
  return (
    <div className="card" style={{ padding: "22px 22px 20px" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 18, margin: 0 }}>Sign in with your wallet</h2>
          <p className="dim" style={{ fontSize: 13, margin: "4px 0 0" }}>Ethereum or Base. Signing is free and sends no transaction.</p>
        </div>
      </div>

      <div className="wallet-list" style={{ marginTop: 16 }}>
        {wallets.map((w) => (
          <button key={w.info.uuid} type="button" className="wallet-btn" disabled={busy} onClick={() => signIn(w)} aria-busy={active === w.info.uuid}>
            {w.info.icon.startsWith("data:image/") ? (
              // Wallet-provided icon (EIP-6963 data URI); rendered as an image, never as markup.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={w.info.icon} alt="" width={26} height={26} />
            ) : (
              <span className="wallet-fallback" aria-hidden="true"><Shield size={15} /></span>
            )}
            <span style={{ flex: 1, textAlign: "left" }}>{w.info.name}</span>
            {active === w.info.uuid && busy ? <span className="spinner" aria-hidden="true" /> : <ArrowRight size={15} style={{ color: "var(--text-dim)" }} />}
          </button>
        ))}
        {ready && wallets.length === 0 && (
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
            No browser wallet found. Install MetaMask, Rabby or Coinbase Wallet, or open this page in your wallet app:
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <a className="btn btn-ghost btn-sm" href={`https://metamask.app.link/dapp/${pageUrl.replace(/^https?:\/\//, "")}`}>Open in MetaMask</a>
              <a className="btn btn-ghost btn-sm" href={`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(pageUrl)}`}>Open in Coinbase Wallet</a>
            </div>
          </div>
        )}
        {!ready && wallets.length === 0 && <div className="dim" style={{ fontSize: 13 }}>Looking for wallets…</div>}
      </div>

      {step !== "idle" && (
        <div className="action-note" role="status" style={{ maxWidth: "none" }}>
          {address && <span className="mono" style={{ color: "var(--text)" }}>{shortAddress(address)} · </span>}
          {STEP_TEXT[step]}
        </div>
      )}
      {error && (
        <div role="alert" style={{ marginTop: 12, fontSize: 13, color: "var(--neg)" }}>{error}</div>
      )}

      <div className="demo-note" style={{ marginTop: 16, alignItems: "flex-start" }}>
        <Info size={14} style={{ marginTop: 2 }} />
        <span style={{ lineHeight: 1.55 }}>
          Use a wallet you don&apos;t trade from. Signing in tells us this address is yours; your
          quoting wallets are never sent to us and stay private.
        </span>
      </div>
    </div>
  );
}
