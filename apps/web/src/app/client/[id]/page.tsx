import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchClientEngagement, clientSummary, type ClientEpoch } from "@/lib/client-portal";
import { StateBadge } from "@/components/mm/state-badge";
import { ChallengePanel } from "@/components/client/challenge-panel";

const PHASE_LABEL: Record<string, string> = {
  settled: "settled", attested: "attested", proven: "proven", captured: "captured", pending: "pending",
};

export default async function ClientEngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = fetchClientEngagement(id);
  if (!e) notFound();
  const s = clientSummary(e);
  const reached = e.epochs.filter((x) => x.phase !== "pending");

  return (
    <main className="container" style={{ maxWidth: 1000 }}>
      <Link href="/client" className="muted" style={{ fontSize: 13 }}>← Client portal</Link>

      <section className="hero" style={{ marginTop: 14, padding: "32px 32px" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <h1 style={{ margin: 0, fontSize: "clamp(28px, 4vw, 40px)" }}>{e.pair}</h1>
              <StateBadge state={e.state} />
            </div>
            <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>
              with <Link href={`/mm/${e.mmHandle}`} style={{ color: "var(--accent-2)" }}>{e.mmName}</Link> · <span className="mono">{e.id}</span> · you are the counterparty
            </div>
          </div>
        </div>
        <div style={{ marginTop: 18, padding: "12px 16px", background: "var(--accent-soft)", border: "1px solid color-mix(in srgb, var(--accent) 24%, transparent)", borderRadius: "var(--radius-sm)", fontSize: 13 }} className="muted">
          🔓 You see the <span style={{ color: "var(--text-high)" }}>actual per-epoch figures</span> the MM proved, opened to your key. The public reputation record shows only pass/fail.
        </div>
      </section>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 16 }}>
        <Stat label="Epochs met" value={`${s.met}/${s.total}`} sub={`${Math.round((s.met / s.total) * 100)}% of contract`} big />
        <Stat label="Avg uptime" value={`${s.avgUptime}%`} sub={`target ${e.uptimeTargetPct}%`} good={s.avgUptime >= e.uptimeTargetPct} />
        <Stat label="Depth target" value={e.depthTargetLabel.split(" @ ")[0]!} sub={e.depthTargetLabel.split(" @ ")[1] ?? ""} />
        <Stat label="MM bond at stake" value={e.bondAtStakeLabel} sub="protects you" />
      </div>

      {/* Per-epoch figures (privileged view) */}
      <section style={{ marginTop: 24 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ fontSize: 20, margin: 0 }}>Per-epoch figures</h2>
          <span className="dim" style={{ fontSize: 12 }}>{reached.length} of {e.epochsTotal} epochs so far</span>
        </div>
        <div className="card" style={{ marginTop: 12, padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)" }}>
                {["Epoch", "Status", "Depth", "Uptime", "Util.", "Custody", "No round-trips", "Result"].map((h) => (
                  <th key={h} className="eyebrow" style={{ textAlign: h === "Epoch" ? "left" : "right", padding: "11px 14px", fontWeight: 500, color: "var(--text-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reached.slice().reverse().map((ep) => <EpochRow key={ep.epoch} ep={ep} uptimeTarget={e.uptimeTargetPct} />)}
            </tbody>
          </table>
        </div>
        <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
          Figures are opened from the MM&apos;s published commitments to your key — recomputable
          against public on-chain data, so you don&apos;t take them on trust.
        </p>
      </section>

      {/* Verify + challenge */}
      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 24 }}>
        <div className="card" style={{ padding: "18px 20px" }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Verify independently</div>
          <p className="muted" style={{ fontSize: 13, margin: "0 0 12px", lineHeight: 1.6 }}>
            Re-derive these figures yourself from the published data — the verifier rejects
            anything that doesn&apos;t match the attested root.
          </p>
          <code className="mono" style={{ display: "block", padding: "8px 10px", background: "var(--code)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--text-muted)", overflowX: "auto" }}>
            npx @mmr/attest verify {e.id}
          </code>
        </div>
        <ChallengePanel challengeableEpoch={e.challengeableEpoch} windowHours={e.challengeWindowHours} mmBond={e.bondAtStakeLabel} />
      </section>
    </main>
  );
}

function EpochRow({ ep, uptimeTarget }: { ep: ClientEpoch; uptimeTarget: number }) {
  const td: React.CSSProperties = { padding: "11px 14px", textAlign: "right" };
  return (
    <tr style={{ borderTop: "1px solid var(--border)" }}>
      <td className="mono" style={{ padding: "11px 14px", color: "var(--text)" }}>{ep.epoch}</td>
      <td className="mono dim" style={td}>{PHASE_LABEL[ep.phase]}</td>
      <td className="mono" style={{ ...td, color: ep.depthMet ? "var(--pos)" : "var(--neg)" }}>{ep.depthAchievedLabel}</td>
      <td className="mono" style={{ ...td, color: ep.uptimePct >= uptimeTarget ? "var(--pos)" : "var(--neg)" }}>{ep.uptimePct}%</td>
      <td className="mono" style={td}>{ep.utilizationPct}%</td>
      <td className="mono" style={{ ...td, color: ep.custodyIntact ? "var(--pos)" : "var(--neg)" }}>{ep.custodyIntact ? "intact" : "breach"}</td>
      <td className="mono" style={{ ...td, color: ep.noRoundTrips ? "var(--pos)" : "var(--neg)" }}>{ep.noRoundTrips ? "ok" : "flagged"}</td>
      <td style={{ ...td }}>
        <span className="pill" style={{ fontSize: 11, background: ep.pass ? "color-mix(in srgb, var(--pos) 16%, transparent)" : "color-mix(in srgb, var(--neg) 16%, transparent)", color: ep.pass ? "var(--pos)" : "var(--neg)", borderColor: "transparent" }}>
          {ep.pass ? "met" : "missed"}
        </span>
      </td>
    </tr>
  );
}

function Stat({ label, value, sub, big, good }: { label: string; value: string; sub?: string; big?: boolean; good?: boolean }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ fontSize: big ? 26 : 20, marginTop: 6, color: good === undefined ? "var(--text-high)" : good ? "var(--pos)" : "var(--warn)" }}>{value}</div>
      {sub && <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
