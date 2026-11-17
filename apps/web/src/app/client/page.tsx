import Link from "next/link";
import { fetchPortal, clientSummary, type ClientEngagement } from "@/lib/client-portal";
import { StateBadge } from "@/components/mm/state-badge";

// The client's portal: the engagements they're the counterparty to, and how the market
// maker is performing against the agreed terms — seen through the client's privileged
// view (actual figures, not just the public pass/fail outcome).
export default function ClientPage() {
  const p = fetchPortal();
  return (
    <main className="container">
      <div className="eyebrow" style={{ marginBottom: 6 }}>Client portal</div>
      <h1 style={{ margin: 0, fontSize: "clamp(30px, 4.5vw, 44px)" }}>{p.clientName}</h1>
      <div className="muted" style={{ fontSize: 14, marginTop: 8, maxWidth: 560 }}>
        Your engagements with market makers. As the counterparty you see the actual
        per-epoch figures the MM proved — the public record shows only pass/fail.
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 14, marginTop: 28 }}>
        {p.engagements.map((e) => <Row key={e.id} e={e} />)}
      </div>
    </main>
  );
}

function Row({ e }: { e: ClientEngagement }) {
  const s = clientSummary(e);
  return (
    <Link href={`/client/${e.id}`} className="card interactive" style={{ display: "block" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <strong style={{ fontSize: 16, color: "var(--text-high)" }}>{e.pair}</strong>
            <StateBadge state={e.state} />
            {e.challengeableEpoch !== null && (
              <span className="pill" style={{ background: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)", borderColor: "transparent", fontSize: 11 }}>
                epoch {e.challengeableEpoch} challengeable
              </span>
            )}
          </div>
          <div className="dim" style={{ fontSize: 13, marginTop: 3 }}>
            with <Link href={`/mm/${e.mmHandle}`} style={{ color: "var(--accent-2)" }}>{e.mmName}</Link> · <span className="mono">{e.id}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="mono" style={{ fontSize: 18, color: "var(--text-high)" }}>{s.met}/{s.total}</div>
          <div className="eyebrow">epochs met</div>
        </div>
      </div>

      <div className="row" style={{ gap: 28, marginTop: 16 }}>
        <Mini label="Avg uptime" value={`${s.avgUptime}%`} sub={`target ${e.uptimeTargetPct}%`} good={s.avgUptime >= e.uptimeTargetPct} />
        <Mini label="Depth target" value={e.depthTargetLabel.split(" @ ")[0]!} />
        <Mini label="MM bond at stake" value={e.bondAtStakeLabel} />
        <div style={{ marginLeft: "auto", alignSelf: "center" }}>
          <span className="muted" aria-hidden="true">Monitor →</span>
        </div>
      </div>
    </Link>
  );
}

function Mini({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ fontSize: 15, marginTop: 3, color: good === undefined ? "var(--text)" : good ? "var(--pos)" : "var(--warn)" }}>{value}</div>
      {sub && <div className="dim" style={{ fontSize: 11, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}
