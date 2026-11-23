import type { Metadata } from "next";
import { BackLink } from "@/components/icons";
import { CONTRACT_ADDRESS, EPOCHS, NETWORK, readEngagement, type DayState } from "@/lib/chain/engagement";

// Read from the chain on request, at most once a minute.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Engagement on Midnight · mm-reputation",
  description: "An engagement's public state, read from the epoch_proof contract on Midnight Preview.",
};

const TIER = ["", "A", "B", "C"];
const CHAIN: Record<number, string> = { 8453: "Base", 1: "Ethereum" };
const REPO = "https://github.com/ronniethedevv/mm-reputation";

function dayStatus(d: DayState): { text: string; tone?: "pos" | "neg" | "warn" } {
  if (d.disputed) return { text: d.released ? "disputed: neutral, released to the market maker" : "root disputed: neutral", tone: "warn" };
  if (d.credited) return { text: "released, credited", tone: "pos" };
  if (d.settledAt) return { text: "settled; releases at the deadline", tone: "pos" };
  if (d.uptime !== undefined) return { text: "proven; settles inside its window" };
  if (!d.ended) return { text: "not over yet" };
  if (Date.parse(d.deadline) <= Date.now()) return { text: d.rootPublished ? "deadline passed unsettled: defaultable" : "no attested root: not defaultable", tone: "neg" };
  return { text: d.rootPublished ? "root attested; waiting for the proof" : "waiting for its attested root" };
}

export default async function LiveEngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let e: Awaited<ReturnType<typeof readEngagement>> = null;
  let error: string | null = null;
  try {
    e = await readEngagement(id);
  } catch (err) {
    error = err instanceof Error ? err.message : "the chain could not be read";
  }

  return (
    <main className="container" style={{ maxWidth: 1000 }}>
      <BackLink href="/">Home</BackLink>
      <section className="hero" style={{ marginTop: 14, padding: "32px 32px" }}>
        <div className="eyebrow">Live on {NETWORK}</div>
        <h1 style={{ margin: "6px 0 0", fontSize: "clamp(26px, 4vw, 38px)" }}>
          Engagement {e ? <span className="pill" style={{ fontSize: 14, verticalAlign: "middle" }}>{e.status}</span> : null}
        </h1>
        <div className="dim mono" style={{ fontSize: 12, marginTop: 8, wordBreak: "break-all" }}>{id}</div>
        <p className="dim" style={{ fontSize: 13.5, marginTop: 14, maxWidth: 720 }}>
          Everything on this page is read from the public state of the <span className="mono">epoch_proof</span> contract
          (<span className="mono">{CONTRACT_ADDRESS.slice(0, 8)}…{CONTRACT_ADDRESS.slice(-4)}</span>) through Midnight&apos;s
          public indexer. The market maker&apos;s wallets, the terms and the pool are not on chain, so they are not here.
        </p>
      </section>

      {error && <div className="card" style={{ marginTop: 16, padding: 18, color: "var(--neg)" }}>Could not read the contract: {error}</div>}
      {!error && !e && <div className="card" style={{ marginTop: 16, padding: 18 }}>No engagement with this id is registered on the contract.</div>}

      {e && (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 16 }}>
            <Stat label="Tier · chain" value={`${TIER[e.tier] ?? e.tier} · ${CHAIN[e.chain] ?? e.chain}`} />
            <Stat label="Bond" value={e.bondPosted ?? "not posted"} sub={`required ${e.bondRequired}, test bond token`} />
            <Stat label="Day 1" value={e.startDate ?? "not activated"} sub={e.activatedAt ? `activated ${e.activatedAt.slice(0, 16).replace("T", " ")} UTC` : undefined} />
            <Stat label="Funding" value={e.fundingProven ? "proven" : "not yet"} sub="against an attested day" />
            <Stat label="Released" value={`${e.releasedEpochs} of ${EPOCHS} days`} sub={`${e.releasedTotal} of the bond`} />
          </div>
          <div className="card" style={{ marginTop: 12, padding: 18 }}>
            <div className="eyebrow">Bond goes to, on default</div>
            <div className="mono" style={{ fontSize: 13, marginTop: 6, wordBreak: "break-all" }}>{e.beneficiary}</div>
            <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
              The client&apos;s Midnight coin key, fixed at registration. The client&apos;s portal checks it is their own key before they accept.
            </div>
          </div>

          {e.days.length > 0 && (
            <section className="card" style={{ marginTop: 16, padding: 0 }}>
              <div className="scroll-x">
                <table className="figures-table">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Date (UTC)</th>
                      <th>Attested root</th>
                      <th>Uptime</th>
                      <th>Settled</th>
                      <th style={{ textAlign: "left" }}>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.days.map((d) => {
                      const s = dayStatus(d);
                      return (
                        <tr key={d.epoch}>
                          <td>{d.epoch}</td>
                          <td className="mono">{d.date}</td>
                          <td className="mono" title={d.manifestCid}>{d.rootHex ? `${d.rootHex.slice(0, 10)}…` : "—"}</td>
                          <td className="mono">{d.uptime !== undefined ? `${d.uptime}/48` : "—"}</td>
                          <td className="mono">{d.settledAt ? d.settledAt.slice(5, 16).replace("T", " ") : "—"}</td>
                          <td style={{ textAlign: "left", color: s.tone ? `var(--${s.tone})` : undefined }}>{s.text}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="dim" style={{ fontSize: 12.5, marginTop: 14 }}>
            Read {e.readAt.slice(0, 19).replace("T", " ")} UTC. Each day&apos;s deadline is its end plus 66 hours: settlement and
            disputes close then, and its share of the bond is released. Transaction ids:{" "}
            <a href={`${REPO}/blob/main/packages/dapp/deployments/preview-lifecycle.json`}>the lifecycle record</a>. Check the
            contract&apos;s keys yourself: <span className="mono">pnpm --filter @mmr/dapp check-deployment</span>.
          </p>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | undefined }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ fontSize: 20, marginTop: 6, color: "var(--text-high)" }}>{value}</div>
      {sub && <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
