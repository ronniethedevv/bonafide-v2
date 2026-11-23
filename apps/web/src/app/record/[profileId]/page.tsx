import type { Metadata } from "next";
import { BackLink } from "@/components/icons";
import { CONTRACT_ADDRESS, NETWORK } from "@/lib/chain/engagement";
import { readProfileRecord } from "@/lib/chain/profile";

// Read from the chain on request, at most once a minute.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Track record on Midnight · mm-reputation",
  description: "A market maker's claimed engagements, per tier, read from the epoch_proof contract on Midnight Preview.",
};

const pct = (met: number, total: number) => (total > 0 ? `${((100 * met) / total).toFixed(1)}%` : "—");

export default async function RecordPage({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  let record: Awaited<ReturnType<typeof readProfileRecord>> = null;
  let error: string | null = null;
  try {
    record = await readProfileRecord(profileId);
  } catch (err) {
    error = err instanceof Error ? err.message : "the chain could not be read";
  }
  const claimed = record?.tiers.reduce((n, t) => n + t.engagements, 0) ?? 0;

  return (
    <main className="container" style={{ maxWidth: 1000 }}>
      <BackLink href="/">Home</BackLink>
      <section className="hero" style={{ marginTop: 14, padding: "32px 32px" }}>
        <div className="eyebrow">Live on {NETWORK}</div>
        <h1 style={{ margin: "6px 0 0", fontSize: "clamp(26px, 4vw, 38px)" }}>Track record</h1>
        <div className="dim mono" style={{ fontSize: 12, marginTop: 8, wordBreak: "break-all" }}>profile {profileId}</div>
        <p className="dim" style={{ fontSize: 13.5, marginTop: 14, maxWidth: 720 }}>
          Read from the <span className="mono">epoch_proof</span> contract
          (<span className="mono">{CONTRACT_ADDRESS.slice(0, 8)}…{CONTRACT_ADDRESS.slice(-4)}</span>) on every visit. When an
          engagement ends, its market maker claims it here: a proof over the engagement&apos;s credited days adds one
          engagement and its days met to this profile&apos;s counters for that tier. Each engagement counts once, and nothing
          on chain says which engagement a claim came from.
        </p>
      </section>

      {error && <div className="card" style={{ marginTop: 16, padding: 18, color: "var(--neg)" }}>Could not read the contract: {error}</div>}
      {!error && !record && <div className="card" style={{ marginTop: 16, padding: 18 }}>A profile id is 64 hex characters.</div>}

      {record && (
        <>
          <section className="card" style={{ marginTop: 16, padding: 0 }}>
            <div className="scroll-x">
              <table className="figures-table">
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>Engagements claimed</th>
                    <th>Days that met the terms</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {record.tiers.map((t) => (
                    <tr key={t.tier}>
                      <td>{t.name}</td>
                      <td className="mono">{t.engagements}</td>
                      <td className="mono">{t.daysTotal > 0 ? `${t.daysMet.toLocaleString("en-US")} of ${t.daysTotal.toLocaleString("en-US")}` : "—"}</td>
                      <td className="mono">{pct(t.daysMet, t.daysTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {claimed === 0 && (
            <div className="card" style={{ marginTop: 12, padding: 18 }}>
              <div style={{ fontWeight: 600 }}>No claimed engagements yet</div>
              <p className="dim" style={{ fontSize: 13, margin: "6px 0 0", lineHeight: 1.55 }}>
                An engagement runs 30 days, and each day&apos;s share of the bond is released, and the day credited, 66 hours
                after it ends. The live engagement&apos;s day 30 is 23 December 2026, so its full claim is possible from
                26 December, 18:00 UTC.
              </p>
            </div>
          )}
          <p className="dim" style={{ fontSize: 12.5, marginTop: 14 }}>
            Read {record.readAt.slice(0, 19).replace("T", " ")} UTC. Claims on the contract, by any market maker: {record.claimsOnContract}.
          </p>
        </>
      )}
    </main>
  );
}
