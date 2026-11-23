import Link from "next/link";
import { getSession, homeOf } from "@/lib/session";
import { ArrowRight, Check, Eye, Globe, Lock, Shield } from "@/components/icons";
import { LIVE_ENGAGEMENT_ID, LIVE_PROFILE_ID } from "@/lib/chain/live";

// Landing page: what the product is, who it's for, and where each kind of visitor goes
// next. The public directory lives at /explore; private views sit behind sign-in.
export default async function HomePage() {
  const session = await getSession();

  return (
    <main className="container">
      {/* Hero */}
      <section className="hero">
        <span className="badge-new">Private by design</span>
        <h1 style={{ margin: "16px 0 14px", maxWidth: 720 }}>
          Prove your track record.{" "}
          <span className="gradient-text">Keep your books private.</span>
        </h1>
        <p className="lead" style={{ margin: 0, maxWidth: 620 }}>
          A verified reputation record for crypto market makers. Market makers prove they
          met their liquidity commitments; clients see exactly how they performed; the
          public sees a trustworthy track record. Nobody hands over their wallets or
          strategy.
        </p>
        <div className="row" style={{ marginTop: 30, gap: 12 }}>
          {session ? (
            <Link href={homeOf(session)} className="btn btn-primary link-arrow">
              <span>{session.kind === "mm" ? "Open my workspace" : "Open my engagements"}</span>
              <ArrowRight size={16} />
            </Link>
          ) : (
            <Link href="/signin" className="btn btn-primary link-arrow">
              <span>Get started</span>
              <ArrowRight size={16} />
            </Link>
          )}
          <Link href="/explore" className="btn btn-ghost">Browse market makers</Link>
        </div>
      </section>

      {/* The live demonstration, read from the contract */}
      <section className="card" style={{ marginTop: 24, padding: "20px 24px" }}>
        <div className="row" style={{ gap: 18, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <div style={{ maxWidth: 620 }}>
            <div className="eyebrow">Live on Midnight Preview</div>
            <p className="dim" style={{ fontSize: 13.5, margin: "6px 0 0", lineHeight: 1.55 }}>
              A 30-day engagement on the VIRTUAL/USDC pool on Base from 24 November: each day is proven against the daily
              index once it closes. Both pages read the contract on every visit.
            </p>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <Link href={`/engagement/${LIVE_ENGAGEMENT_ID}`} className="btn btn-ghost link-arrow">
              <span>The live engagement</span>
              <ArrowRight size={15} />
            </Link>
            <Link href={`/record/${LIVE_PROFILE_ID}`} className="btn btn-ghost link-arrow">
              <span>Track record on chain</span>
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* Two audiences */}
      <section className="cols-2" style={{ marginTop: 24 }}>
        <RoleCard
          eyebrow="For market makers"
          title="Win mandates on proof, not promises"
          points={[
            "Register each client engagement and its targets privately",
            "Prove every day's depth and uptime with zero-knowledge proofs",
            "Build a public record that never exposes a client or a wallet",
          ]}
          cta={session?.kind === "mm" ? { href: "/dashboard", label: "Open my workspace" } : { href: "/signin?as=mm", label: "Sign in as a market maker" }}
        />
        <RoleCard
          eyebrow="For projects and funds"
          title="Know your market maker is delivering"
          points={[
            "Check any market maker's verified record before you hire",
            "See the real per-day figures for your own engagement",
            "Verify any result yourself, and dispute it if it's wrong",
          ]}
          cta={session?.kind === "client" ? { href: "/client", label: "Open my engagements" } : { href: "/signin?as=client", label: "Sign in as a client" }}
        />
      </section>

      {/* How it works */}
      <section id="how" style={{ marginTop: "var(--section-gap)", scrollMarginTop: 90 }}>
        <div className="eyebrow">How it works</div>
        <h2 style={{ margin: "8px 0 0" }}>From a signed deal to a public record</h2>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 20 }}>
          <Step n="1" title="Register the engagement" body="The market maker commits the deal's targets and wallets. Only a fingerprint of them goes on-chain." />
          <Step n="2" title="Prove each day" body="Every day's trading activity is read from the public chain and turned into a private proof that the targets were met." />
          <Step n="3" title="Independent check" body="A committee of attesters re-computes the same figures from public data and signs off. The client can dispute." />
          <Step n="4" title="Earn the record" body="When the engagement ends, the verified result joins the market maker's public reputation." />
        </div>
      </section>

      {/* Who sees what */}
      <section id="who-sees-what" style={{ marginTop: "var(--section-gap)", scrollMarginTop: 90 }}>
        <div className="eyebrow">Who sees what</div>
        <h2 style={{ margin: "8px 0 0" }}>Three views of the same verified data</h2>
        <p className="muted" style={{ fontSize: 14, maxWidth: 640, margin: "10px 0 0", lineHeight: 1.6 }}>
          Every view is computed from the same proofs. What changes is how much each party
          is entitled to see.
        </p>
        <div className="cols-3" style={{ marginTop: 20 }}>
          <ViewCard
            icon={<Globe size={18} />}
            who="The public"
            where="Explore"
            href="/explore"
            sees={["Completed engagements", "Verified hit-rates and uptime", "Reliability tier"]}
            never="Clients, tokens, wallets, targets"
          />
          <ViewCard
            icon={<Eye size={18} />}
            who="The client"
            where="Client portal"
            href="/client"
            sees={["Per-day figures for their own deals", "Depth, uptime, custody and flow checks", "Verify and dispute tools"]}
            never="The market maker's other clients"
          />
          <ViewCard
            icon={<Lock size={18} />}
            who="The market maker"
            where="Workspace"
            href="/dashboard"
            sees={["All their engagements and terms", "Daily pipeline and next steps", "Outflow budget and bond"]}
            never="Other market makers' data"
          />
        </div>
      </section>

      {/* Trust */}
      <section className="card" style={{ marginTop: "var(--section-gap)", padding: "24px 26px" }}>
        <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
          <span className="gate-icon" aria-hidden="true" style={{ flexShrink: 0 }}><Shield size={20} /></span>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>Nothing to take on trust</h3>
            <p className="muted" style={{ fontSize: 14, margin: "8px 0 0", lineHeight: 1.6, maxWidth: 720 }}>
              Every figure is recomputed from public Base and Ethereum data by a deterministic
              indexer, and proven with zero-knowledge proofs on Midnight. Anyone with an archive
              node can re-derive every result.
            </p>
          </div>
        </div>
      </section>

      <footer className="muted" style={{ marginTop: 64, paddingTop: 24, borderTop: "1px solid var(--border)", fontSize: 13 }}>
        Built on Midnight. Results are verified against public on-chain data, and no
        private information is ever revealed.
      </footer>
    </main>
  );
}

function RoleCard({ eyebrow, title, points, cta }: { eyebrow: string; title: string; points: string[]; cta: { href: string; label: string } }) {
  return (
    <div className="card" style={{ padding: "24px 24px 22px", display: "flex", flexDirection: "column" }}>
      <div className="eyebrow">{eyebrow}</div>
      <h3 style={{ margin: "8px 0 14px", fontSize: 20 }}>{title}</h3>
      <ul className="check-list">
        {points.map((p) => (
          <li key={p}>
            <Check size={14} style={{ color: "var(--pos)", marginTop: 3 }} />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: "auto", paddingTop: 18 }}>
        <Link href={cta.href} className="btn btn-ghost link-arrow">
          <span>{cta.label}</span>
          <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="card">
      <div className="step-num mono">{n}</div>
      <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{title}</h3>
      <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>{body}</p>
    </div>
  );
}

function ViewCard({ icon, who, where, href, sees, never }: { icon: React.ReactNode; who: string; where: string; href: string; sees: string[]; never: string }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <span className="view-icon" aria-hidden="true">{icon}</span>
        <div>
          <div style={{ fontWeight: 600, color: "var(--text-high)" }}>{who}</div>
          <Link href={href} className="dim" style={{ fontSize: 12 }}>{where}</Link>
        </div>
      </div>
      <ul className="check-list" style={{ marginTop: 14 }}>
        {sees.map((s) => (
          <li key={s}>
            <Check size={13} style={{ color: "var(--pos)", marginTop: 3 }} />
            <span>{s}</span>
          </li>
        ))}
      </ul>
      <div className="dim" style={{ fontSize: 12, marginTop: "auto", paddingTop: 14, lineHeight: 1.5 }}>
        <span style={{ color: "var(--text-muted)" }}>Never sees:</span> {never}
      </div>
    </div>
  );
}
