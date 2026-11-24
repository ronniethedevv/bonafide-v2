"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock } from "@/components/icons";

// The client's Midnight coin public key: if an engagement defaults, the market maker's bond
// is paid to it. Market makers' registrations name it, and before accepting, the client's
// portal checks that each registration names this key and not another.
export function MidnightKeyCard({ current }: { current: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(!current);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/midnight-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: value }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Couldn't save your key.");
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your key.");
    }
    setBusy(false);
  }

  return (
    <div className="card inbox-card" style={{ marginTop: 16 }}>
      <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
        <span className="view-icon" aria-hidden="true"><Lock size={17} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>Your Midnight key for bonds</div>
          <p className="dim" style={{ fontSize: 13, margin: "4px 0 10px", lineHeight: 1.55 }}>
            If a market maker defaults, its bond is paid to this key. Market makers register with the key you save
            here, and before you accept an engagement we check it names this key. Paste the shielded address your
            Midnight wallet shows; we keep only its coin public key.
          </p>
          {!editing && current ? (
            <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className="mono" style={{ fontSize: 12.5, wordBreak: "break-all" }}>{current}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Change</button>
            </div>
          ) : (
            <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                className="inp mono"
                style={{ fontSize: 13, flex: "1 1 360px" }}
                placeholder="Your shielded address from Lace (mn_shield-addr_…) or coin public key"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || !value.trim()}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          )}
          {error && <div role="alert" className="field-err">{error}</div>}
        </div>
      </div>
    </div>
  );
}
