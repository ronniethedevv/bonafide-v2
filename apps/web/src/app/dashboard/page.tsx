import Link from "next/link";
import { fetchWorkspace, claimProgress, nextAction, type MmEngagement } from "@/lib/mm-dashboard";
import { fetchProfile } from "@/lib/data";
import { totalCompleted } from "@/lib/read-model";
import { getSession } from "@/lib/session";
import { StateBadge } from "@/components/mm/state-badge";
import { SignInGate } from "@/components/signin-gate";
import { ArrowRight, ChevronRight, Globe, Plus } from "@/components/icons";
import { RegistrationList } from "@/components/registrations";
import { db } from "@/lib/db/pool";
import { registrationsForMm, type Registration } from "@/lib/db/store";

export const metadata = { title: "Workspace · MM Reputation" };

// The signed-in MM's private workspace: every engagement they're running, its state, how
// far it is through its contract, and the single next action. Each MM sees only their own.
export default async function DashboardPage() {
  const session = await getSession();
  if (session?.kind !== "mm") return <SignInGate need="mm" next="/dashboard" current={session} />;
  // A new wallet account has no engagements yet: show its own empty workspace.
  const ws = fetchWorkspace(session.handle) ?? { handle: session.handle, displayName: session.name, engagements: [] };
  const profile = await fetchProfile(ws.handle);

  // Engagements registered from this (database-backed) account.
  const pool = db();
  let registrations: Registration[] = [];
  let registryError = false;
  if (pool && session.accountId) {
    try {
      registrations = await registrationsForMm(pool, session.accountId);
    } catch {
      registryError = true;
    }
  }

  const active = ws.engagements.filter((e) => e.state === "active" || e.state === "at_risk" || e.state === "registered");
  const done = ws.engagements.filter((e) => e.state === "completed" || e.state === "claimed" || e.state === "defaulted");

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Your workspace</div>
          <h1 style={{ margin: 0, fontSize: "clamp(30px, 4.5vw, 44px)" }}>{ws.displayName}</h1>
          <div className="muted mono" style={{ fontSize: 13, marginTop: 6 }}>
            @{ws.handle} · only you can see this page{session.preview ? " · preview account (this browser only)" : ""}
          </div>
        </div>
        <Link href="/dashboard/new" className="btn btn-primary link-arrow">
          <Plus size={16} />
          <span>New engagement</span>
        </Link>
      </div>

      {profile && (
        <Link href={`/mm/${ws.handle}`} className="card interactive" style={{ display: "block", marginTop: 24, padding: "16px 20px" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 16 }}>
            <div className="row" style={{ gap: 12, alignItems: "center", minWidth: 0 }}>
              <span className="view-icon" aria-hidden="true"><Globe size={17} /></span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--text-high)", fontSize: 14 }}>Your public record</div>
                <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
                  {totalCompleted(profile)} completed engagements · {profile.headlineUptime}% headline uptime · what clients see on Explore
                </div>
              </div>
            </div>
            <ChevronRight size={18} style={{ color: "var(--text-dim)" }} />
          </div>
        </Link>
      )}

      {registrations.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 22, margin: "0 0 4px" }}>Registered</h2>
          <p className="dim" style={{ fontSize: 13, margin: "0 0 14px" }}>
            Saved and shared with each client. Epoch capture starts once the engagement is funded.
          </p>
          <RegistrationList items={registrations} viewer="mm" />
        </section>
      )}
      {registryError && (
        <p className="muted" role="alert" style={{ marginTop: 24 }}>Couldn&apos;t load your registered engagements right now.</p>
      )}

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 22, margin: "0 0 14px" }}>In flight</h2>
        <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
          {active.length ? (
            active.map((e) => <EngagementRow key={e.id} e={e} />)
          ) : ws.engagements.length === 0 && registrations.length === 0 ? (
            <div className="card" style={{ padding: "26px 24px", textAlign: "center" }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>No engagements yet</h3>
              <p className="muted" style={{ fontSize: 14, margin: "8px auto 0", maxWidth: 440, lineHeight: 1.6 }}>
                Register your first client engagement. Its terms and wallets are committed
                privately; only a fingerprint goes on-chain.
              </p>
              <Link href="/dashboard/new" className="btn btn-primary link-arrow" style={{ marginTop: 16 }}>
                <Plus size={16} />
                <span>Register an engagement</span>
              </Link>
            </div>
          ) : (
            <p className="muted">Nothing running right now.</p>
          )}
        </div>
      </section>

      {done.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 22, margin: "0 0 4px" }}>Finished</h2>
          <p className="dim" style={{ fontSize: 13, margin: "0 0 14px" }}>
            Claim a finished engagement to add its verified result to your public record.
          </p>
          <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
            {done.map((e) => <EngagementRow key={e.id} e={e} />)}
          </div>
        </section>
      )}
    </main>
  );
}

function EngagementRow({ e }: { e: MmEngagement }) {
  const cp = claimProgress(e);
  const pct = Math.round((cp.captured / cp.total) * 100);
  return (
    <Link href={`/dashboard/${e.id}`} className="card interactive" style={{ display: "block" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <strong style={{ fontSize: 16, color: "var(--text-high)" }}>{e.terms.pair}</strong>
            <StateBadge state={e.state} />
          </div>
          <div className="dim" style={{ fontSize: 13, marginTop: 3 }}>
            {e.privateLabel} · <span className="mono">{e.id}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div className="mono" style={{ fontSize: 18, color: "var(--text-high)" }}>{cp.passed}/{cp.total}</div>
          <div className="eyebrow">epochs met</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
          <span className="dim" style={{ fontSize: 12 }}>
            {e.state === "registered" ? "Not started" : `Epoch ${e.currentEpoch} of ${e.terms.epochsTotal}`}
          </span>
          <span className="dim mono" style={{ fontSize: 12 }}>{pct}%</span>
        </div>
        <div className="meter"><span style={{ width: `${pct}%`, background: "var(--grad)" }} /></div>
      </div>

      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 10 }}>
        <span className="pill link-arrow" style={{ background: "var(--accent-soft)", color: "var(--accent-2)", borderColor: "transparent" }}>
          <span>Next: {nextAction(e)}</span>
          <ArrowRight size={13} />
        </span>
        <span className="dim" style={{ fontSize: 12 }}>
          bond {e.bond.postedLabel} · {e.bond.status}
        </span>
      </div>
    </Link>
  );
}
