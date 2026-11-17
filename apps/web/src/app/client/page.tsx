import Link from "next/link";
import { fetchPortal, clientSummary, type ClientEngagement } from "@/lib/client-portal";
import { getSession } from "@/lib/session";
import { StateBadge } from "@/components/mm/state-badge";
import { SignInGate } from "@/components/signin-gate";
import { SampleDataBanner } from "@/components/sample-banner";
import { ChevronRight } from "@/components/icons";
import { ClientRegistrations } from "@/components/client/client-registrations";
import { InboxSetup } from "@/components/client/inbox-setup";
import { db } from "@/lib/db/pool";
import { getInboxKey, registrationsForClient, type Registration } from "@/lib/db/store";

export const metadata = { title: "My engagements · MM Reputation" };

// The signed-in client's portal: the engagements they're the counterparty to, and how
// each market maker is performing against the agreed terms — seen through the client's
// privileged view (actual figures, not just the public pass/fail outcome).
export default async function ClientPage() {
  const session = await getSession();
  if (session?.kind !== "client") return <SignInGate need="client" next="/client" current={session} />;
  // A new wallet account has no engagements yet: show its own empty portal.
  const demoPortal = fetchPortal(session.clientId);
  const p = demoPortal ?? { clientId: session.clientId, clientName: session.name, engagements: [] };

  // Engagements market makers have registered with this (database-backed) account.
  const pool = db();
  let registrations: Registration[] = [];
  let inboxKey: string | null = null;
  let registryError = false;
  const walletAccount = Boolean(pool && session.accountId && session.via === "wallet" && session.address);
  if (pool && session.accountId) {
    try {
      [registrations, inboxKey] = await Promise.all([registrationsForClient(pool, session.accountId), getInboxKey(pool, session.accountId)]);
    } catch {
      registryError = true;
    }
  }

  return (
    <main className="container">
      {demoPortal && <SampleDataBanner kind="account" />}
      <div className="eyebrow" style={{ marginBottom: 6 }}>Client portal</div>
      <h1 style={{ margin: 0, fontSize: "clamp(30px, 4.5vw, 44px)" }}>{p.clientName}</h1>
      <div className="muted" style={{ fontSize: 14, marginTop: 8, maxWidth: 580, lineHeight: 1.6 }}>
        Your engagements with market makers. As the counterparty you see the actual
        per-epoch figures each market maker proved; the public record shows only pass/fail.
      </div>

      {walletAccount && !registryError && !inboxKey && <InboxSetup address={session.address!} />}

      {registrations.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 20, margin: "0 0 4px" }}>Registered with you</h2>
          <p className="dim" style={{ fontSize: 13, margin: "0 0 14px" }}>
            Review each proposal&apos;s terms before accepting. Per-epoch figures appear here once capture starts.
          </p>
          <ClientRegistrations items={registrations} address={session.address ?? ""} inboxKey={inboxKey} />
        </section>
      )}
      {registryError && (
        <p className="muted" role="alert" style={{ marginTop: 24 }}>Couldn&apos;t load your registered engagements right now.</p>
      )}

      <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 14, marginTop: 28 }}>
        {p.engagements.length || registrations.length ? (
          p.engagements.map((e) => <Row key={e.id} e={e} />)
        ) : (
          <div className="card" style={{ padding: "26px 24px", textAlign: "center" }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>No engagements yet</h3>
            <p className="muted" style={{ fontSize: 14, margin: "8px auto 0", maxWidth: 460, lineHeight: 1.6 }}>
              When a market maker registers an engagement with you, it appears here with its
              real per-epoch figures. Meanwhile, compare market makers&apos; public records.
            </p>
            <Link href="/explore" className="btn btn-ghost" style={{ marginTop: 16 }}>Browse market makers</Link>
          </div>
        )}
      </div>
    </main>
  );
}

function Row({ e }: { e: ClientEngagement }) {
  const s = clientSummary(e);
  return (
    <Link href={`/client/${e.id}`} className="card interactive" style={{ display: "block" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <strong style={{ fontSize: 16, color: "var(--text-high)" }}>{e.pair}</strong>
            <StateBadge state={e.state} />
            {e.challengeableEpoch !== null && (
              <span className="pill" style={{ background: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)", borderColor: "transparent", fontSize: 11 }}>
                epoch {e.challengeableEpoch} open to dispute
              </span>
            )}
          </div>
          <div className="dim" style={{ fontSize: 13, marginTop: 3 }}>
            with {e.mmName} · <span className="mono">{e.id}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div className="mono" style={{ fontSize: 18, color: "var(--text-high)" }}>{s.met}/{s.total}</div>
          <div className="eyebrow">epochs met</div>
        </div>
      </div>

      <div className="row" style={{ gap: 28, marginTop: 16, alignItems: "flex-end" }}>
        {e.epochs.length > 0 ? (
          <Mini label="Avg uptime" value={`${s.avgUptime}%`} sub={`target ${e.uptimeTargetPct}%`} good={s.avgUptime >= e.uptimeTargetPct} />
        ) : (
          <Mini label="Status" value="Starts soon" sub="no epochs yet" />
        )}
        <Mini label="Depth target" value={e.depthTargetLabel} />
        <Mini label="MM bond at stake" value={e.bondAtStakeLabel} />
        <span className="muted link-arrow" style={{ marginLeft: "auto", fontSize: 13 }}>
          <span>Monitor</span>
          <ChevronRight size={16} />
        </span>
      </div>
    </Link>
  );
}

function Mini({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ fontSize: 15, marginTop: 3, color: good === undefined ? "var(--text)" : good ? "var(--pos)" : "var(--warn)" }}>{value}</div>
      {sub && <div className="dim" style={{ fontSize: 11, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}
