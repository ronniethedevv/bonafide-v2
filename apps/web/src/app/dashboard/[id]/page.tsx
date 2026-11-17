import {
  fetchEngagement,
  claimProgress,
  nextAction,
  pipelineStage,
} from "@/lib/mm-dashboard";
import { getSession } from "@/lib/session";
import { StateBadge } from "@/components/mm/state-badge";
import { PipelineStepper } from "@/components/mm/pipeline-stepper";
import { EpochGrid } from "@/components/mm/epoch-grid";
import { ActionButton } from "@/components/mm/action-button";
import { NotYours, SignInGate } from "@/components/signin-gate";
import { BackLink, Flow } from "@/components/icons";

export default async function EngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (session?.kind !== "mm") return <SignInGate need="mm" next={`/dashboard/${id}`} current={session} />;
  // Scoped to the signed-in MM: another MM's engagement id simply isn't found here.
  const found = fetchEngagement(session.handle, id);
  if (!found) return <NotYours backHref="/dashboard" backLabel="Back to my workspace" />;
  const { engagement: e } = found;
  const cp = claimProgress(e);
  const action = nextAction(e);
  const actionable = (e.state === "active" || e.state === "at_risk" || e.state === "completed" || e.state === "registered") && !action.startsWith("Awaiting");

  return (
    <main className="container" style={{ maxWidth: 1000 }}>
      <BackLink href="/dashboard">Workspace</BackLink>

      {/* Header */}
      <section className="hero" style={{ marginTop: 14, padding: "32px 32px" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <h1 style={{ margin: 0, fontSize: "clamp(28px, 4vw, 40px)" }}>{e.terms.pair}</h1>
              <StateBadge state={e.state} />
            </div>
            <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>
              {e.privateLabel} · <span className="mono">{e.id}</span> · <span className="dim">private to you and {e.clientName}</span>
            </div>
          </div>
          {actionable && <ActionButton action={action} />}
        </div>

        <div style={{ marginTop: 26 }}>
          <PipelineStepper stage={pipelineStage(e)} />
        </div>
      </section>

      {/* Stat row */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", marginTop: 16 }}>
        <Stat label="Epochs passed" value={`${cp.passed}/${cp.total}`} sub={`${cp.ratePct}% pass-rate`} big />
        <Stat label="Captured" value={`${cp.captured}/${cp.total}`} sub={e.state === "registered" ? "not started" : `epoch ${e.currentEpoch}`} />
        <Stat label="Outflow budget" value={e.carry.usedLabel} sub={`of ${e.carry.capLabel} · ${e.carry.usedPct}%`} warn={e.carry.usedPct >= 90} />
        <Stat label="Bond" value={e.bond.postedLabel} sub={e.bond.status === "releasing" ? `releasing ${e.bond.releasedEpochs}/${e.bond.totalEpochs}` : e.bond.status} />
      </div>

      {/* Epoch grid */}
      <section style={{ marginTop: 24 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h2 style={{ fontSize: 20, margin: 0 }}>Epoch pipeline</h2>
          <span className="dim" style={{ fontSize: 12 }}>
            <Flow steps={["Capture", "Prove", "Attest", "Settle"]} />
          </span>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <EpochGrid epochs={e.epochs} />
        </div>
      </section>

      {/* Terms + budget */}
      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>Contract terms</h2>
        <div className="card">
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 18, margin: 0 }}>
            <Term k="Depth target" v={`${e.terms.depthTargetLabel} @ ±${e.terms.bandBps}bps`} />
            <Term k="Min uptime" v={`${e.terms.minUptimePct}% of buckets`} />
            <Term k="Contract length" v={`${e.terms.epochsTotal} epochs`} />
            <Term k="Loan" v={e.terms.loanLabel} />
            <Term k="Round-trip cap" v={`${e.terms.roundtripCapPct}% of volume`} />
            <Term k="Budget cap holds" v={e.carry.capHolds ? "yes" : "NO — over cap"} neg={!e.carry.capHolds} />
          </dl>
        </div>
        <p className="dim" style={{ fontSize: 12, marginTop: 10, maxWidth: 680, lineHeight: 1.6 }}>
          Terms, wallets and KPI targets are committed privately at registration — the chain
          sees only a commitment, never these values. They are shown here because this is your
          own workspace.
        </p>
      </section>
    </main>
  );
}

function Stat({ label, value, sub, big, warn }: { label: string; value: string; sub?: string; big?: boolean; warn?: boolean }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ fontSize: big ? 26 : 20, marginTop: 6, color: warn ? "var(--warn)" : "var(--text-high)" }}>{value}</div>
      {sub && <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Term({ k, v, neg }: { k: string; v: string; neg?: boolean }) {
  return (
    <div>
      <dt className="dim" style={{ fontSize: 12 }}>{k}</dt>
      <dd className="mono" style={{ margin: "3px 0 0", fontSize: 14, color: neg ? "var(--neg)" : "var(--text)" }}>{v}</dd>
    </div>
  );
}
