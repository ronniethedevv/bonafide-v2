import Link from "next/link";
import { fetchProfiles } from "@/lib/data";

export default async function HomePage() {
  const profiles = await fetchProfiles();
  const sampleHandle = profiles[0]?.handle;

  return (
    <main className="container">
      {/* Hero */}
      <section className="hero">
        <span className="badge-new">Private by design</span>
        <h1 style={{ margin: "16px 0 14px", maxWidth: 680 }}>
          Prove your track record.{" "}
          <span className="gradient-text">Keep your books private.</span>
        </h1>
        <p className="lead" style={{ margin: 0, maxWidth: 600 }}>
          A public reputation record for crypto market makers. Show clients and
          partners that you met your commitments, without handing over your wallets,
          balances, or strategy.
        </p>
        <div className="row" style={{ marginTop: 32 }}>
          {sampleHandle && (
            <Link href={`/mm/${sampleHandle}`} className="btn btn-primary">
              See a sample profile
            </Link>
          )}
          <a href="#how" className="btn btn-ghost">
            How it works
          </a>
        </div>
      </section>

      {/* Value props */}
      <div
        className="feature-grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", marginTop: 24 }}
      >
        <ValueCard
          title="Private by default"
          body="Your wallets, balances, and trades stay with you. All anyone sees is the outcome: whether you met the terms, and how consistent you were."
        />
        <ValueCard
          title="Nothing to take on trust"
          body="Every result is checked against public, on-chain activity and recomputed independently. No one has to take your word for it."
        />
        <ValueCard
          title="A reputation you own"
          body="Build a track record that proves you're reliable, one that can't be traced back to any single client or deal."
        />
      </div>

      {/* How it works */}
      <section id="how" style={{ marginTop: "var(--section-gap)", scrollMarginTop: 80 }}>
        <div className="eyebrow">How it works</div>
        <h2 style={{ margin: "8px 0 0" }}>Three simple steps</h2>
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginTop: 20 }}
        >
          <Step
            n="1"
            title="Agree on the terms"
            body="You take on a market-making engagement with clear, measurable targets."
          />
          <Step
            n="2"
            title="Prove it privately"
            body="At the end of each period, you create a proof that you hit those targets, using only your own private data."
          />
          <Step
            n="3"
            title="Earn a public record"
            body="The proof is checked and added to your reputation. The result is public; the details never are."
          />
        </div>
      </section>

      {/* Profiles */}
      <section style={{ marginTop: "var(--section-gap)" }}>
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "baseline" }}
        >
          <h2 style={{ margin: 0 }}>Market makers with a public record</h2>
          <span className="dim mono" style={{ fontSize: 12 }}>
            {profiles.length} shown
          </span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "1fr", marginTop: 16 }}>
          {profiles.map((p) => (
            <Link key={p.handle} href={`/mm/${p.handle}`} className="card">
              <div
                className="row"
                style={{ justifyContent: "space-between", alignItems: "center" }}
              >
                <div>
                  <strong style={{ fontSize: 16, color: "var(--text)" }}>
                    {p.displayName}
                  </strong>
                  <div className="dim mono" style={{ fontSize: 13, marginTop: 2 }}>
                    @{p.handle}
                  </div>
                </div>
                <div className="row" style={{ alignItems: "center", gap: 24 }}>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontSize: 18, color: "var(--text)" }}>
                      {p.headlineUptime}%
                    </div>
                    <div className="eyebrow">Uptime</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontSize: 18, color: "var(--text)" }}>
                      {p.completed}
                    </div>
                    <div className="eyebrow">Completed</div>
                  </div>
                  <span className="muted" aria-hidden="true">→</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <footer
        className="muted"
        style={{
          marginTop: 64,
          paddingTop: 24,
          borderTop: "1px solid var(--border)",
          fontSize: 13,
        }}
      >
        Built on Midnight. Results are verified against public on-chain data, and no
        private information is ever revealed.
      </footer>
    </main>
  );
}

function ValueCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="feature-cell">
      <h4 style={{ margin: "0 0 10px" }}>{title}</h4>
      <p className="muted" style={{ margin: 0 }}>
        {body}
      </p>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="card">
      <div
        className="mono"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-strong)",
          color: "var(--accent-2)",
          fontSize: 14,
          marginBottom: 12,
        }}
      >
        {n}
      </div>
      <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{title}</h3>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {body}
      </p>
    </div>
  );
}
