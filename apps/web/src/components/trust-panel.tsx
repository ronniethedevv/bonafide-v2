// "How to trust this record" — the single most consistent trust pattern across
// comparable products (EAScan, Credora, proof-of-reserves, fintech): don't ask for
// trust, show who stands behind the record and how anyone can check it themselves.
// Plain language, no ZK jargon — "trust by proof, not by exposure".

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          borderRadius: 7,
          background: "var(--accent-soft)",
          border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--accent-2)",
          fontSize: 12,
          marginTop: 1,
        }}
      >
        ✓
      </span>
      <div>
        <div style={{ color: "var(--text-high)", fontSize: 14, fontWeight: 500 }}>{title}</div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.55, marginTop: 2 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function TrustPanel({ compact = false }: { compact?: boolean }) {
  return (
    <div className="card" style={{ padding: compact ? "16px 20px" : "22px 24px" }}>
      <div className="row" style={{ alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span className="eyebrow">How to trust this record</span>
        <span className="pill" style={{ fontSize: 11 }}>
          trust by proof, not by exposure
        </span>
      </div>
      <div className={compact ? "grid" : "cols-2"} style={{ gap: 14, ...(compact ? { gridTemplateColumns: "1fr" } : {}) }}>
        <Point title="Attested by a 2-of-3 committee">
          Each epoch&apos;s result is signed by at least two of three independent attesters —
          no single party, including the market maker, can forge it.
        </Point>
        <Point title="Independently recomputable">
          The full data behind every result is published (IPFS); anyone can rebuild the
          committed root from public on-chain activity and confirm it matches.
        </Point>
        <Point title="Private, not opaque">
          The market maker&apos;s wallets, balances and strategy stay private — only the
          verified outcome is public. You see what was proven, never the books.
        </Point>
        <Point title="Verify it yourself">
          Run the open-source verifier on the published data — it re-derives the root and
          rejects anything revoked, expired or altered:
          <code
            className="mono"
            style={{
              display: "block",
              marginTop: 8,
              padding: "8px 10px",
              background: "var(--code)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: 12,
              color: "var(--text-muted)",
              overflowX: "auto",
            }}
          >
            npx @mmr/attest verify &lt;epoch-cid&gt;
          </code>
        </Point>
      </div>
    </div>
  );
}
