import Link from "next/link";
import { fetchProfiles } from "@/lib/data";

export default async function HomePage() {
  const profiles = await fetchProfiles();
  return (
    <main className="container">
      <section className="hero">
        <span className="badge-new">New</span>
        <h1 style={{ margin: "14px 0 10px", maxWidth: 640 }}>
          Verified market-maker performance,{" "}
          <span className="gradient-text">proven with zero-knowledge.</span>
        </h1>
        <p className="muted" style={{ margin: 0, maxWidth: 560, fontSize: 15 }}>
          A privacy-preserving reputation record for crypto market makers. No account
          access, no books handed over — just proofs on Midnight, verified against a
          deterministic on-chain indexer.
        </p>
      </section>

      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "baseline", marginTop: 36 }}
      >
        <h2 style={{ margin: 0 }}>Market makers</h2>
        <span className="muted" style={{ fontSize: 13 }}>
          {profiles.length} with a public record
        </span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr", marginTop: 16 }}>
        {profiles.map((p) => (
          <Link key={p.handle} href={`/mm/${p.handle}`} className="card">
            <div
              className="row"
              style={{ justifyContent: "space-between", alignItems: "center" }}
            >
              <strong style={{ fontSize: 16 }}>{p.displayName}</strong>
              <span className="muted mono" style={{ fontSize: 13 }}>
                @{p.handle}
              </span>
            </div>
            <div className="row" style={{ gap: 28, marginTop: 14 }}>
              <Stat label="Headline uptime" value={`${p.headlineUptime}%`} />
              <Stat label="Completed" value={String(p.completed)} />
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 2 }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 20 }}>
        {value}
      </div>
    </div>
  );
}
