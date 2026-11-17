import type { Registration } from "@/lib/db/store";
import { Lock } from "@/components/icons";

const STATUS: Record<string, string> = {
  registered: "Registered · starts at epoch 1",
  active: "Active",
  completed: "Finished",
  claimed: "Claimed",
  defaulted: "Defaulted",
  void: "Void",
};

function shortHash(h: string): string {
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

/**
 * Engagements saved in the registry. Shows only what the server holds: the parties, the
 * on-chain commitment and the status. The pair and terms are known to the two parties, not to us.
 */
export function RegistrationList({ items, viewer }: { items: Registration[]; viewer: "mm" | "client" }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 12 }}>
      {items.map((r) => (
        <div key={r.id} className="card" style={{ padding: "16px 20px" }}>
          <div className="reg-row">
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <strong className="mono" style={{ fontSize: 15, color: "var(--text-high)" }}>{r.id}</strong>
                <span className="pill" style={{ fontSize: 11, background: "var(--accent-soft)", color: "var(--accent-2)", borderColor: "transparent" }}>
                  {STATUS[r.status] ?? r.status}
                </span>
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
              <div className="eyebrow">On-chain commitment</div>
              <div className="mono dim" style={{ fontSize: 12, marginTop: 3 }}>{shortHash(r.commitment)}</div>
            </div>
          </div>
          <div className="demo-note" style={{ marginTop: 12 }}>
            <Lock size={13} />
            <span>
              {viewer === "mm"
                ? "Terms and wallets stay with you; the server holds only this commitment."
                : "The pair and terms are shared with you by the market maker; the server holds only this commitment."}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
