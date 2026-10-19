import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfile } from "@/lib/fixtures";
import { totalCompleted, overallKpiHitRate } from "@/lib/read-model";
import { TierBadge } from "@/components/tier-badge";

// A compact, shareable/printable summary of the public record. In production
// this view is rendered to PDF/PNG in a background worker and stored in Blob;
// here it is the on-screen source layout.
export default async function TearSheetPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const profile = getProfile(handle);
  if (!profile) notFound();

  const all = [...profile.engagements, ...profile.sandbox];

  return (
    <main className="container" style={{ maxWidth: 760 }}>
      <Link href={`/mm/${profile.handle}`} className="muted" style={{ fontSize: 13 }}>
        ← Back to profile
      </Link>

      <div className="card" style={{ marginTop: 16 }}>
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "baseline" }}
        >
          <div>
            <h1 style={{ margin: 0 }}>{profile.displayName}</h1>
            <span className="muted mono" style={{ fontSize: 13 }}>
              @{profile.handle} · tear sheet
            </span>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mono" style={{ fontSize: 28 }}>
              {profile.headlineUptime}%
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              headline uptime
            </div>
          </div>
        </div>

        <div
          className="row"
          style={{
            gap: 24,
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--border)",
          }}
        >
          <Fact label="Completed" value={String(totalCompleted(profile))} />
          <Fact label="Tier A" value={String(profile.tierCounts.A)} />
          <Fact label="Tier B" value={String(profile.tierCounts.B)} />
          <Fact label="Sandbox" value={String(profile.tierCounts.C)} />
        </div>
      </div>

      <table
        className="card"
        style={{ width: "100%", marginTop: 16, borderCollapse: "collapse" }}
      >
        <thead>
          <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 12 }}>
            <th style={{ padding: "6px 8px" }}>Engagement</th>
            <th style={{ padding: "6px 8px" }}>Tier</th>
            <th style={{ padding: "6px 8px" }}>Epochs</th>
            <th style={{ padding: "6px 8px" }}>KPI</th>
            <th style={{ padding: "6px 8px" }}>Custody</th>
            <th style={{ padding: "6px 8px" }}>Bond</th>
            <th style={{ padding: "6px 8px" }}>Completed</th>
          </tr>
        </thead>
        <tbody>
          {all.map((e) => (
            <tr key={e.id} style={{ borderTop: "1px solid var(--border)", fontSize: 13 }}>
              <td className="mono" style={{ padding: "8px" }}>
                {e.id}
              </td>
              <td style={{ padding: "8px" }}>
                <TierBadge tier={e.tier} />
              </td>
              <td className="mono" style={{ padding: "8px" }}>
                {e.epochsPassed}/{e.epochsTotal}
              </td>
              <td className="mono" style={{ padding: "8px" }}>
                {overallKpiHitRate(e)}%
              </td>
              <td style={{ padding: "8px", color: e.custodyIntact ? "var(--pos)" : "var(--neg)" }}>
                {e.custodyIntact ? "intact" : "breached"}
              </td>
              <td className="mono" style={{ padding: "8px" }}>
                {e.bond.status}
              </td>
              <td className="mono muted" style={{ padding: "8px" }}>
                {e.completedAt}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        Verified against a deterministic Base indexer and settled attester roots.
        No account access or private books were shared to produce this record.
      </p>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 18 }}>
        {value}
      </div>
    </div>
  );
}
