import Link from "next/link";
import { fetchProfiles, isSampleProfile } from "@/lib/data";
import { SampleDataBanner } from "@/components/sample-banner";
import { getSession } from "@/lib/session";
import { ChevronRight, Globe } from "@/components/icons";

export const metadata = { title: "Explore market makers · MM Reputation" };

// The public directory: every market maker with a public record. This is what anyone —
// a project shopping for an MM, a fund doing diligence — can see without an account.
export default async function ExplorePage() {
  const [profiles, session] = await Promise.all([fetchProfiles(), getSession()]);

  return (
    <main className="container">
      {profiles.some((p) => isSampleProfile(p.handle)) && <SampleDataBanner kind="directory" />}
      <div className="eyebrow" style={{ marginBottom: 6 }}>Explore</div>
      <h1 style={{ margin: 0, fontSize: "clamp(30px, 4.5vw, 44px)" }}>Market makers with a public record</h1>
      <p className="muted" style={{ fontSize: 14, margin: "10px 0 0", maxWidth: 620, lineHeight: 1.6 }}>
        Each record shows completed engagements and how reliably the market maker met
        its targets, verified against on-chain data. Clients, tokens, wallets and terms
        are never shown.
      </p>

      <div className="demo-note" style={{ marginTop: 14 }}>
        <Globe size={14} />
        <span>Public view: anyone can see this page without an account.</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr", marginTop: 24 }}>
        {profiles.map((p) => {
          const mine = session?.kind === "mm" && session.handle === p.handle;
          return (
            <Link key={p.handle} href={`/mm/${p.handle}`} className="card interactive">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <strong style={{ fontSize: 16, color: "var(--text-high)" }}>{p.displayName}</strong>
                    {mine && <span className="pill" style={{ fontSize: 11, background: "var(--accent-soft)", color: "var(--accent-2)", borderColor: "transparent" }}>You</span>}
                  </div>
                  <div className="dim mono" style={{ fontSize: 13, marginTop: 2 }}>@{p.handle}</div>
                </div>
                <div className="row" style={{ alignItems: "center", gap: 24 }}>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontSize: 18, color: "var(--text-high)" }}>{p.headlineUptime}%</div>
                    <div className="eyebrow">Uptime</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontSize: 18, color: "var(--text-high)" }}>{p.completed}</div>
                    <div className="eyebrow">Completed</div>
                  </div>
                  <ChevronRight size={18} style={{ color: "var(--text-dim)" }} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {!session && (
        <div className="card" style={{ marginTop: 24, padding: "16px 20px" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 14 }}>
            <span className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
              Are you one of these market makers, or one of their clients? Sign in to see
              your private engagements in full.
            </span>
            <Link href="/signin" className="btn btn-ghost btn-sm">Sign in</Link>
          </div>
        </div>
      )}
    </main>
  );
}
