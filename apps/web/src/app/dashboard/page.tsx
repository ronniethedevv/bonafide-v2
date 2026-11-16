import Link from "next/link";
import { notFound } from "next/navigation";
import {
  fetchWorkspace,
  claimProgress,
  nextAction,
  type MmEngagement,
} from "@/lib/mm-dashboard";
import { StateBadge } from "@/components/mm/state-badge";

// The MM's private workspace: every engagement they're running, its state, how far it
// is through its contract, and the single next action. The demo workspace is "vega-mm";
// in production this is the signed-in MM's own data (fed by their local witness store).
export default function DashboardPage() {
  const ws = fetchWorkspace("vega-mm");
  if (!ws) notFound();

  const active = ws.engagements.filter((e) => e.state === "active" || e.state === "at_risk" || e.state === "registered");
  const done = ws.engagements.filter((e) => e.state === "completed" || e.state === "claimed" || e.state === "defaulted");

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Market-maker workspace</div>
          <h1 style={{ margin: 0, fontSize: "clamp(30px, 4.5vw, 44px)" }}>{ws.displayName}</h1>
          <div className="muted mono" style={{ fontSize: 13, marginTop: 6 }}>@{ws.handle} · private to you</div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Link href={`/mm/${ws.handle}`} className="btn btn-ghost">View public profile →</Link>
          <button className="btn btn-primary">+ New engagement</button>
        </div>
      </div>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 22, margin: "0 0 14px" }}>In flight</h2>
        <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
          {active.map((e) => <EngagementRow key={e.id} e={e} />)}
        </div>
      </section>

      {done.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 22, margin: "0 0 14px" }}>Completed</h2>
          <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
            {done.map((e) => <EngagementRow key={e.id} e={e} />)}
          </div>
        </section>
      )}
    </main>
  );
}

function EngagementRow({ e }: { e: MmEngagement }) {
  const cp = claimProgress(e);
  const pct = Math.round((cp.captured / cp.total) * 100);
  return (
    <Link href={`/dashboard/${e.id}`} className="card interactive" style={{ display: "block" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <strong style={{ fontSize: 16, color: "var(--text-high)" }}>{e.terms.pair}</strong>
            <StateBadge state={e.state} />
          </div>
          <div className="dim" style={{ fontSize: 13, marginTop: 3 }}>
            {e.privateLabel} · <span className="mono">{e.id}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="mono" style={{ fontSize: 18, color: "var(--text-high)" }}>{cp.passed}/{cp.total}</div>
          <div className="eyebrow">epochs passed</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
          <span className="dim" style={{ fontSize: 12 }}>
            {e.state === "registered" ? "Not started" : `Epoch ${e.currentEpoch} of ${e.terms.epochsTotal}`}
          </span>
          <span className="dim mono" style={{ fontSize: 12 }}>{pct}%</span>
        </div>
        <div className="meter"><span style={{ width: `${pct}%`, background: "var(--grad)" }} /></div>
      </div>

      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <span className="pill" style={{ background: "var(--accent-soft)", color: "var(--accent-2)", borderColor: "transparent" }}>
          Next: {nextAction(e)}
        </span>
        <span className="dim" style={{ fontSize: 12 }}>
          bond {e.bond.postedLabel} · {e.bond.status}
        </span>
      </div>
    </Link>
  );
}
