import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchProfile } from "@/lib/data";
import {
  totalCompleted,
  liveEngagements,
  coverageOf,
  profileFreshness,
  lastActivityAt,
  type Freshness,
} from "@/lib/read-model";
import { TierBadge } from "@/components/tier-badge";
import { EngagementCard } from "@/components/engagement-card";
import { EpochChart } from "@/components/epoch-chart";
import { PrivacyNote } from "@/components/privacy-note";
import { FreshnessChip } from "@/components/freshness-chip";
import { CoverageNote } from "@/components/coverage-note";
import { TrustPanel } from "@/components/trust-panel";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const profile = await fetchProfile(handle);
  if (!profile) notFound();

  const now = Date.now();
  const freshness: Freshness | null = profileFreshness(profile, now);
  const lastAt = lastActivityAt(profile);
  const coverage = coverageOf(profile);
  const engagements = liveEngagements(profile.engagements);
  const sandbox = liveEngagements(profile.sandbox);
  const revoked = [...profile.engagements, ...profile.sandbox].filter((e) => e.revoked);

  return (
    <main className="container">
      <Link href="/" className="muted" style={{ fontSize: 13 }}>
        ← All market makers
      </Link>

      <section className="hero" style={{ marginTop: 14 }}>
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "flex-start" }}
        >
          <div>
            <h1 style={{ margin: 0 }}>{profile.displayName}</h1>
            <div className="row" style={{ alignItems: "center", gap: 10, marginTop: 8 }}>
              <span className="muted mono" style={{ fontSize: 13 }}>
                @{profile.handle}
              </span>
              {freshness && lastAt && <FreshnessChip freshness={freshness} lastAt={lastAt} />}
            </div>
          </div>
          <Link href={`/mm/${profile.handle}/tear-sheet`} className="btn btn-ghost">
            Export tear sheet →
          </Link>
        </div>

        <div className="row" style={{ gap: 40, marginTop: 24 }}>
          <Headline label="Headline uptime" value={`${profile.headlineUptime}%`} big />
          <Headline label="Completed" value={String(totalCompleted(profile))} />
          <Headline
            label="Tiers"
            value={`A${profile.tierCounts.A} · B${profile.tierCounts.B} · C${profile.tierCounts.C}`}
          />
        </div>
      </section>

      <div style={{ marginTop: 18 }}>
        <PrivacyNote>
          Clients, tokens, wallets, KPI targets and live results are private by
          design. This record shows only completed engagements and their verified
          hit-rates.
        </PrivacyNote>
      </div>

      <div style={{ marginTop: 14 }}>
        <CoverageNote coverage={coverage} />
      </div>

      <div style={{ marginTop: 14 }}>
        <TrustPanel />
      </div>

      {profile.epochSeries.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <EpochChart series={profile.epochSeries} />
        </div>
      )}

      <h2 style={{ marginTop: 32 }}>Completed engagements</h2>
      <div className="grid" style={{ gridTemplateColumns: "1fr", marginTop: 14 }}>
        {engagements.map((e) => (
          <EngagementCard key={e.id} e={e} />
        ))}
      </div>

      {sandbox.length > 0 && (
        <>
          <div className="row" style={{ alignItems: "center", gap: 12, marginTop: 32 }}>
            <h2 style={{ margin: 0 }}>Sandbox</h2>
            <TierBadge tier="C" />
          </div>
          <p className="muted" style={{ marginTop: 6, marginBottom: 0, fontSize: 13 }}>
            Shown separately from the headline record.
          </p>
          <div className="grid" style={{ gridTemplateColumns: "1fr", marginTop: 14 }}>
            {sandbox.map((e) => (
              <EngagementCard key={e.id} e={e} />
            ))}
          </div>
        </>
      )}

      {revoked.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>Revoked</h2>
          <p className="muted" style={{ marginTop: 6, marginBottom: 0, fontSize: 13 }}>
            These attestations were revoked and are excluded from the headline record.
          </p>
          <div className="grid" style={{ gridTemplateColumns: "1fr", marginTop: 14 }}>
            {revoked.map((e) => (
              <div key={e.id} style={{ opacity: 0.6 }}>
                <EngagementCard e={e} />
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function Headline({
  label,
  value,
  big,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <div
        className={big ? "mono gradient-text" : "mono"}
        style={{ fontSize: big ? 38 : 24, fontWeight: big ? 700 : 500, lineHeight: 1 }}
      >
        {value}
      </div>
    </div>
  );
}
