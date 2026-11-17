import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchPortal, clientSummary, type ClientEngagement } from "@/lib/client-portal";
import { getSession } from "@/lib/session";
import { StateBadge } from "@/components/mm/state-badge";
import { SignInGate } from "@/components/signin-gate";
import { ChevronRight } from "@/components/icons";

export const metadata = { title: "My engagements · MM Reputation" };

// The signed-in client's portal: the engagements they're the counterparty to, and how
// each market maker is performing against the agreed terms — seen through the client's
// privileged view (actual figures, not just the public pass/fail outcome).
export default async function ClientPage() {
  const session = await getSession();
  if (session?.kind !== "client") return <SignInGate need="client" next="/client" current={session} />;
  const p = fetchPortal(session.clientId);
  if (!p) notFound();

  return (
    <main className="container">
      <div className="eyebrow" style={{ marginBottom: 6 }}>Client portal</div>
      <h1 style={{ margin: 0, fontSize: "clamp(30px, 4.5vw, 44px)" }}>{p.clientName}</h1>
      <div className="muted" style={{ fontSize: 14, marginTop: 8, maxWidth: 580, lineHeight: 1.6 }}>
        Your engagements with market makers. As the counterparty you see the actual
        per-epoch figures each market maker proved; the public record shows only pass/fail.
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
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <strong style={{ fontSize: 16, color: "var(--text-high)" }}>{e.pair}</strong>
            <StateBadge state={e.state} />
            {e.challengeableEpoch !== null && (
              <span className="pill" style={{ background: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)", borderColor: "transparent", fontSize: 11 }}>
                epoch {e.challengeableEpoch} open to dispute
              </span>
            )}
          </div>
          <div className="dim" style={{ fontSize: 13, marginTop: 3 }}>
            with {e.mmName} · <span className="mono">{e.id}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div className="mono" style={{ fontSize: 18, color: "var(--text-high)" }}>{s.met}/{s.total}</div>
          <div className="eyebrow">epochs met</div>
        </div>
      </div>

      <div className="row" style={{ gap: 28, marginTop: 16, alignItems: "flex-end" }}>
        {e.epochs.length > 0 ? (
          <Mini label="Avg uptime" value={`${s.avgUptime}%`} sub={`target ${e.uptimeTargetPct}%`} good={s.avgUptime >= e.uptimeTargetPct} />
        ) : (
          <Mini label="Status" value="Starts soon" sub="no epochs yet" />
        )}
        <Mini label="Depth target" value={e.depthTargetLabel} />
        <Mini label="MM bond at stake" value={e.bondAtStakeLabel} />
        <span className="muted link-arrow" style={{ marginLeft: "auto", fontSize: 13 }}>
          <span>Monitor</span>
          <ChevronRight size={16} />
        </span>
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
