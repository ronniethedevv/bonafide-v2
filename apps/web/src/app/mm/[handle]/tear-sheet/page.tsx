import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchProfile } from "@/lib/data";
import {
  totalCompleted,
  overallKpiHitRate,
  liveEngagements,
  coverageOf,
  profileFreshness,
  lastActivityAt,
} from "@/lib/read-model";
import { TierBadge } from "@/components/tier-badge";
import { TrustPanel } from "@/components/trust-panel";

// A compact, shareable/printable summary of the public record. In production
// this view is rendered to PDF/PNG in a background worker and stored in Blob;
// here it is the on-screen source layout.
export default async function TearSheetPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const profile = await fetchProfile(handle);
  if (!profile) notFound();

  const all = [...liveEngagements(profile.engagements), ...liveEngagements(profile.sandbox)];
  const coverage = coverageOf(profile);
  const freshness = profileFreshness(profile);
  const lastAt = lastActivityAt(profile);

  return (
    <main className="container" style={{ maxWidth: 820 }}>
      <Link href={`/mm/${profile.handle}`} className="muted" style={{ fontSize: 13 }}>
        ← Back to profile
      </Link>

      {/* Letterhead */}
      <div className="card" style={{ marginTop: 16, padding: 32 }}>
        <div
          className="row"
          style={{ alignItems: "center", gap: 10, marginBottom: 20 }}
        >
          <span className="brand-mark" aria-hidden="true" />
          <span className="eyebrow" style={{ letterSpacing: "0.04em" }}>
            Reputation tear sheet
          </span>
        </div>

        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(30px, 5vw, 44px)",
                lineHeight: 1.05,
                letterSpacing: "-0.03em",
              }}
            >
              {profile.displayName}
            </h1>
            <span className="muted mono" style={{ fontSize: 13 }}>
              @{profile.handle}
              {freshness && lastAt ? ` · updated ${lastAt} · ${freshness}` : ""}
            </span>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mono gradient-text" style={{ fontSize: 40, fontWeight: 600, lineHeight: 1 }}>
              {profile.headlineUptime}%
            </div>
            <div className="eyebrow" style={{ marginTop: 4 }}>
              Headline uptime
            </div>
          </div>
        </div>

        <div
          className="row"
          style={{
            gap: 40,
            marginTop: 24,
            paddingTop: 24,
            borderTop: "1px solid var(--border)",
          }}
        >
          <Fact label="Completed" value={String(totalCompleted(profile))} />
          <Fact label="Tier A" value={String(profile.tierCounts.A)} />
          <Fact label="Tier B" value={String(profile.tierCounts.B)} />
          <Fact label="Sandbox" value={String(profile.tierCounts.C)} />
        </div>
      </div>

      {/* Record table */}
      <div className="card scroll-x" style={{ marginTop: 16, padding: 0 }}>
        <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              {["Engagement", "Tier", "Epochs", "KPI", "Custody", "Bond", "Completed"].map(
                (h) => (
                  <th
                    key={h}
                    className="eyebrow"
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                      color: "var(--text-muted)",
                      fontWeight: 500,
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {all.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid var(--border)", fontSize: 14 }}>
                <td className="mono" style={{ padding: "12px 16px", color: "var(--text)" }}>
                  {e.id}
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <TierBadge tier={e.tier} />
                </td>
                <td className="mono" style={{ padding: "12px 16px" }}>
                  {e.epochsPassed}/{e.epochsTotal}
                </td>
                <td className="mono" style={{ padding: "12px 16px" }}>
                  {overallKpiHitRate(e)}%
                </td>
                <td
                  className="mono"
                  style={{ padding: "12px 16px", color: e.custodyIntact ? "var(--pos)" : "var(--neg)" }}
                >
                  {e.custodyIntact ? "intact" : "breached"}
                </td>
                <td className="mono" style={{ padding: "12px 16px" }}>
                  {e.bond.status}
                </td>
                <td className="mono muted" style={{ padding: "12px 16px" }}>
                  {e.completedAt}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20 }}>
        <TrustPanel compact />
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: 20, maxWidth: 640 }}>
        Every result here is checked against public on-chain activity. No account
        access and no private books were shared to produce this record.
      </p>
      <p className="dim" style={{ fontSize: 12, marginTop: 8, maxWidth: 640, lineHeight: 1.6 }}>
        Scope: {coverage.venues.join(", ")} on{" "}
        {coverage.chains.map((c) => (c === 1 ? "Ethereum" : c === 8453 ? "Base" : `chain ${c}`)).join(" · ")}.{" "}
        {coverage.note}
      </p>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ fontSize: 22, marginTop: 4, color: "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}
