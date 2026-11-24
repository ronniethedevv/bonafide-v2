"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AgentTokenInfo } from "@/lib/db/agent-store";
import { Check, Info, Plus } from "@/components/icons";

// "Connect agent": the market maker's agent (software on their own server) needs a token
// to report progress and send clients their sealed figures. Shown once, stored hashed.
export function AgentCard({ tokens, server }: { tokens: AgentTokenInfo[]; server: string }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = tokens.filter((t) => !t.revokedAt);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agent-tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: "Agent" }) });
      const body = (await res.json()) as { ok?: boolean; token?: string; error?: string };
      if (!res.ok || !body.token) throw new Error(body.error ?? "Couldn't create a token.");
      setToken(body.token);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create a token.");
    }
    setBusy(false);
  }

  async function revoke(id: string) {
    setError(null);
    const res = await fetch(`/api/agent-tokens/${id}`, { method: "DELETE" });
    if (!res.ok) setError("Couldn't revoke the token.");
    router.refresh();
  }

  const command = token ? `pnpm --filter @mmr/agent agent connect --server ${server} --token ${token}` : "";

  return (
    <section className="card" style={{ marginTop: 24, padding: "18px 20px" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600, color: "var(--text-high)" }}>Your agent</div>
          <div className="dim" style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.5 }}>
            Software you run on your own server. It captures each day from public chain data, reports progress here and
            sends your clients their encrypted figures. Your wallets and terms never leave it.
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm link-arrow" onClick={create} disabled={busy}>
          <Plus size={14} />
          <span>{busy ? "Creating…" : active.length ? "New token" : "Connect agent"}</span>
        </button>
      </div>

      {token && (
        <div className="agent-token" role="status">
          <div style={{ fontSize: 13, color: "var(--text-high)", fontWeight: 600 }}>Copy this now: it won&apos;t be shown again.</div>
          <code className="mono">{command}</code>
          <button
            type="button"
            className="btn btn-primary btn-sm link-arrow"
            onClick={() => {
              void navigator.clipboard?.writeText(command);
              setCopied(true);
            }}
          >
            {copied ? <Check size={14} /> : null}
            <span>{copied ? "Copied" : "Copy command"}</span>
          </button>
        </div>
      )}

      {active.length > 0 && (
        <ul className="token-list">
          {active.map((t) => (
            <li key={t.id}>
              <span className="mono">{t.label}</span>
              <span className="dim">
                created {new Date(t.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ·{" "}
                {t.lastUsedAt ? `last seen ${new Date(t.lastUsedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "not used yet"}
              </span>
              <button type="button" className="link-btn" onClick={() => revoke(t.id)}>Revoke</button>
            </li>
          ))}
        </ul>
      )}
      {error && <div role="alert" className="field-err">{error}</div>}
      <div className="demo-note" style={{ marginTop: 12, alignItems: "flex-start" }}>
        <Info size={14} style={{ marginTop: 2 }} />
        <span style={{ lineHeight: 1.5 }}>Preview: the agent runs from the repository for now; a Docker image comes next. Proofs on Midnight run with your own <code>mm</code> commands, so days the agent reports show as &quot;proof pending&quot; here.</span>
      </div>
    </section>
  );
}
