import type { ReactNode } from "react";
import type { Registration } from "@/lib/db/store";
import { Lock } from "@/components/icons";

type Viewer = "mm" | "client";

function statusOf(r: Registration, viewer: Viewer): { text: string; tone: "warn" | "pos" | "neg" | "accent" } {
  switch (r.status) {
    case "proposed":
      return viewer === "mm" ? { text: `Waiting for ${r.counterparty} to accept`, tone: "warn" } : { text: "Waiting for your answer", tone: "warn" };
    case "accepted":
      return { text: "Accepted · starts at epoch 1", tone: "pos" };
    case "active":
      return { text: "Active", tone: "pos" };
    case "declined":
      return { text: "Declined", tone: "neg" };
    default:
      return { text: r.status, tone: "accent" };
  }
}

const TONE: Record<string, { bg: string; fg: string }> = {
  warn: { bg: "color-mix(in srgb, var(--warn) 16%, transparent)", fg: "var(--warn)" },
  pos: { bg: "color-mix(in srgb, var(--pos) 16%, transparent)", fg: "var(--pos)" },
  neg: { bg: "color-mix(in srgb, var(--neg) 16%, transparent)", fg: "var(--neg)" },
  accent: { bg: "var(--accent-soft)", fg: "var(--accent-2)" },
};

function shortHash(h: string): string {
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

/**
 * One saved engagement. Shows only what the server holds: the parties, the on-chain
 * commitments and the status. The pair and terms are known to the two parties, not to us.
 */
export function RegistrationCard({ r, viewer, children }: { r: Registration; viewer: Viewer; children?: ReactNode }) {
  const st = statusOf(r, viewer);
  const tone = TONE[st.tone]!;
  return (
    <div className="card" style={{ padding: "16px 20px" }} data-registration={r.id}>
      <div className="reg-row">
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <strong className="mono" style={{ fontSize: 15, color: "var(--text-high)" }}>{r.id}</strong>
            <span className="pill" style={{ fontSize: 11, background: tone.bg, color: tone.fg, borderColor: "transparent" }}>{st.text}</span>
          </div>
          <div className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            {viewer === "mm" ? "with " : "market maker "}
            {/* Plain text: a new market maker has no public record page until a claim settles. */}
            <span style={{ color: "var(--text)" }}>{r.counterparty}</span>
            {viewer === "client" && r.mmHandle ? <span className="mono"> (@{r.mmHandle})</span> : null}
            {" · registered "}
            {new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="eyebrow">Registration fingerprint</div>
          <div className="mono dim" style={{ fontSize: 12, marginTop: 3 }}>{shortHash(r.commitment)}</div>
        </div>
      </div>
      {r.lastEpoch ? (
        <div className="progress-line">
          Epoch {r.lastEpoch} {r.lastPhase}
          {r.lastPhase === "captured" ? " · proof pending (Midnight)" : ""}
        </div>
      ) : null}
      {children ?? (
        <div className="demo-note" style={{ marginTop: 12 }}>
          <Lock size={13} />
          <span>
            {viewer === "mm"
              ? "Terms and wallets stay with you and your client; the server holds only the commitments."
              : "The pair and terms were sent to you encrypted; the server holds only the commitments."}
          </span>
        </div>
      )}
    </div>
  );
}

export function RegistrationList({ items, viewer }: { items: Registration[]; viewer: Viewer }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 12 }}>
      {items.map((r) => (
        <RegistrationCard key={r.id} r={r} viewer={viewer} />
      ))}
    </div>
  );
}
