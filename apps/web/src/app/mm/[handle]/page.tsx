import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchProfile } from "@/lib/data";
import { totalCompleted } from "@/lib/read-model";
import { TierBadge } from "@/components/tier-badge";
import { EngagementCard } from "@/components/engagement-card";
import { EpochChart } from "@/components/epoch-chart";
import { PrivacyNote } from "@/components/privacy-note";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const profile = await fetchProfile(handle);
  if (!profile) notFound();

  return (
    <main className="container">
      <Link href="/" className="muted" style={{ fontSize: 13 }}>
        ← All market makers
      </Link>

      <header style={{ marginTop: 16, marginBottom: 20 }}>
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "baseline" }}
        >
          <h1 style={{ margin: 0 }}>{profile.displayName}</h1>
          <Link href={`/mm/${profile.handle}/tear-sheet`} className="mono" style={{ fontSize: 13 }}>
            Export tear sheet →
          </Link>
        </div>
        <div className="muted mono" style={{ fontSize: 13 }}>
          @{profile.handle}
        </div>
      </header>

      <div className="row" style={{ gap: 24, marginBottom: 20 }}>
        <Headline label="Headline uptime" value={`${profile.headlineUptime}%`} />
        <Headline label="Completed" value={String(totalCompleted(profile))} />
        <Headline
          label="Tiers"
          value={`A${profile.tierCounts.A} · B${profile.tierCounts.B} · C${profile.tierCounts.C}`}
        />
      </div>

      <PrivacyNote>
        Clients, tokens, wallets, KPI targets and live results are private by
        design. This record shows only completed engagements and their verified
        hit-rates.
      </PrivacyNote>

      {profile.epochSeries.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <EpochChart series={profile.epochSeries} />
        </div>
      )}

      <h2 style={{ marginTop: 28 }}>Completed engagements</h2>
      <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
        {profile.engagements.map((e) => (
          <EngagementCard key={e.id} e={e} />
        ))}
      </div>

      {profile.sandbox.length > 0 && (
        <>
          <h2 style={{ marginTop: 28 }}>
            Sandbox <TierBadge tier="C" />
          </h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Shown separately from the headline record.
          </p>
          <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
            {profile.sandbox.map((e) => (
              <EngagementCard key={e.id} e={e} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function Headline({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 24 }}>
        {value}
      </div>
    </div>
  );
}
