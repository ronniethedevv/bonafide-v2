"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { unlockInbox } from "@/lib/wallet/inbox";
import { walletErrorText } from "@/lib/wallet/browser";
import { Lock } from "@/components/icons";

// One-time setup of the client's private inbox: a wallet signature derives the key in
// this browser; only its public half is sent to the server, so market makers can seal
// terms and figures that only this client can read.
export function InboxSetup({ address }: { address: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setup() {
    setBusy(true);
    setError(null);
    try {
      const { publicKey } = await unlockInbox(address, null);
      const res = await fetch("/api/account/inbox-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Couldn't set up your inbox.");
      router.refresh();
    } catch (e) {
      setError(walletErrorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="card inbox-card" style={{ marginTop: 22 }}>
      <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
        <span className="view-icon" aria-hidden="true"><Lock size={17} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "var(--text-high)" }}>Set up your private inbox</div>
          <p className="muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.55 }}>
            Market makers send you their terms and daily figures encrypted, so only you can read them. One free
            signature creates your key on this device; your wallet recreates the same key anywhere.
          </p>
          {error && <div role="alert" className="field-err">{error}</div>}
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={setup} disabled={busy}>
          {busy ? "Check your wallet…" : "Set up inbox"}
        </button>
      </div>
    </div>
  );
}
