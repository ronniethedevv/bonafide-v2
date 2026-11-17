import Link from "next/link";
import type { CSSProperties } from "react";
import { fetchClientEngagement, clientSummary, type ClientEngagement, type ClientEpoch } from "@/lib/client-portal";
import { getSession } from "@/lib/session";
import { StateBadge } from "@/components/mm/state-badge";
import { ChallengePanel } from "@/components/client/challenge-panel";
import { PrivacyNote } from "@/components/privacy-note";
import { NotYours, SignInGate } from "@/components/signin-gate";
import { BackLink } from "@/components/icons";
import { SampleDataBanner } from "@/components/sample-banner";

export default async function ClientEngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (session?.kind !== "client") return <SignInGate need="client" next={`/client/${id}`} current={session} />;
  // Scoped to the signed-in client: engagements they aren't party to aren't found here.
  const e = fetchClientEngagement(session.clientId, id);
  if (!e) return <NotYours backHref="/client" backLabel="Back to my engagements" />;
  const s = clientSummary(e);

  return (
    <main className="container" style={{ maxWidth: 1000 }}>
      <BackLink href="/client">My engagements</BackLink>
      <SampleDataBanner kind="account" />

      <section className="hero" style={{ marginTop: 14, padding: "32px 28px" }}>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <h1 style={{ margin: 0, fontSize: "clamp(28px, 4vw, 40px)" }}>{e.pair}</h1>
          <StateBadge state={e.state} />
        </div>
        <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>
          with <Link href={`/mm/${e.mmHandle}`} style={{ color: "var(--accent-2)" }}>{e.mmName}</Link> · <span className="mono">{e.id}</span> · you are the client
        </div>
        <div style={{ marginTop: 18 }}>
          <PrivacyNote open>
            You see the <span style={{ color: "var(--text-high)" }}>actual per-epoch figures</span> the
            market maker proved, opened to your key. The public record shows only pass/fail.
          </PrivacyNote>
        </div>
      </section>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 16 }}>
        <Stat label="Epochs met" value={`${s.met}/${s.total}`} sub={`${s.settled} settled so far`} big />
        <Stat
          label="Avg uptime"
          value={e.epochs.length ? `${s.avgUptime}%` : "—"}
          sub={`target ${e.uptimeTargetPct}% (${e.minUptimeBuckets} of 48 half-hours)`}
          {...(e.epochs.length ? { good: s.avgUptime >= e.uptimeTargetPct } : {})}
        />
        <Stat label="Depth target" value={e.depthTargetLabel} sub={`within ±${e.bandBps / 100}% of mid`} />
        <Stat label="MM bond at stake" value={e.bondAtStakeLabel} sub="slashed if they default" />
      </div>

      <section style={{ marginTop: 24 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h2 style={{ fontSize: 20, margin: 0 }}>Per-epoch figures</h2>
          <span className="dim" style={{ fontSize: 12 }}>{e.epochs.length} of {e.epochsTotal} epochs so far · newest first</span>
        </div>
        {e.epochs.length === 0 ? (
          <div className="card" style={{ marginTop: 12 }}>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              The engagement is registered and starts with epoch 1. Figures appear here as soon as the first epoch is captured.
            </p>
          </div>
        ) : (
          <div className="card scroll-x" style={{ marginTop: 12, padding: 0 }}>
            <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)" }}>
                  {["Epoch", "Status", "Depth at target", "Uptime", "Round-trips", "Custody", "Outflow", "Result"].map((h) => (
                    <th key={h} className="eyebrow" style={{ textAlign: h === "Epoch" ? "left" : "right", padding: "11px 14px", fontWeight: 500, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {e.epochs.slice().reverse().map((ep) => <EpochRow key={ep.epoch} ep={ep} e={e} />)}
              </tbody>
            </table>
          </div>
        )}
        <p className="dim" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>
          Depth at target counts the half-hour windows in which the market maker&apos;s quotes met the
          agreed depth. Round-trips is the share of their volume that bought and sold back to
          themselves (cap {e.roundtripCapPct}%). Every figure is recomputable from public on-chain data.
        </p>
      </section>

      <section className="cols-2" style={{ marginTop: 24 }}>
        <div className="card" style={{ padding: "18px 20px" }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Verify independently</div>
          <p className="muted" style={{ fontSize: 13, margin: "0 0 12px", lineHeight: 1.6 }}>
            Your technical team can re-derive these figures from public data. The verifier
            rejects anything that doesn&apos;t match the attested result. (A one-click check in
            the portal is on the roadmap.)
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

const PHASE: Record<string, string> = { settled: "settled", attested: "attested", proven: "proven", captured: "in progress", pending: "pending" };

function EpochRow({ ep, e }: { ep: ClientEpoch; e: ClientEngagement }) {
  const td: CSSProperties = { padding: "11px 14px", textAlign: "right", whiteSpace: "nowrap" };
  const ok = (v: boolean): CSSProperties => ({ ...td, color: v ? "var(--pos)" : "var(--neg)" });
  return (
    <tr style={{ borderTop: "1px solid var(--border)" }}>
      <td className="mono" style={{ padding: "11px 14px", color: "var(--text)" }}>{ep.epoch}</td>
      <td className="mono dim" style={td}>{PHASE[ep.phase]}</td>
      <td className="mono" style={ok(ep.uptimeOk)}>{ep.bucketsAtTarget}/{ep.totalBuckets}</td>
      <td className="mono" style={ok(ep.uptimeOk)}>{ep.uptimePct}%</td>
      <td className="mono" style={ok(ep.roundTripOk)} title={`cap ${e.roundtripCapPct}%`}>{ep.roundTripPct}%</td>
      <td className="mono" style={ok(ep.custodyIntact)}>{ep.custodyIntact ? "intact" : "breach"}</td>
      <td className="mono" style={ok(ep.outflowOk)}>{ep.outflowOk ? "within cap" : "over cap"}</td>
      <td style={td}>
        {ep.pass === undefined ? (
          <span className="pill" style={{ fontSize: 11, color: "var(--text-muted)" }}>pending</span>
        ) : (
          <span className="pill" style={{ fontSize: 11, background: ep.pass ? "color-mix(in srgb, var(--pos) 16%, transparent)" : "color-mix(in srgb, var(--neg) 16%, transparent)", color: ep.pass ? "var(--pos)" : "var(--neg)", borderColor: "transparent" }}>
            {ep.pass ? "met" : "missed"}
          </span>
        )}
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
