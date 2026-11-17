import Link from "next/link";
import { homeOf, type Session } from "@/lib/session";
import { ArrowRight, Lock } from "@/components/icons";

const COPY = {
  mm: {
    title: "Your workspace is private",
    body: "The workspace shows a market maker's own engagements: their terms, wallets, per-epoch results and next steps. Each market maker sees only their own.",
    cta: "Sign in as a market maker",
    wrong: "Workspaces belong to market makers.",
  },
  client: {
    title: "The client portal is private",
    body: "The portal shows a client the full per-epoch figures for the engagements they are party to, and lets them verify or dispute a result. Each client sees only their own.",
    cta: "Sign in as a client",
    wrong: "The client portal is for the clients who hire market makers.",
  },
} as const;

/** Shown in place of a private page when the visitor isn't signed in as the right kind of account. */
export function SignInGate({ need, next, current }: { need: "mm" | "client"; next: string; current: Session | undefined }) {
  const c = COPY[need];
  const href = `/signin?as=${need}&next=${encodeURIComponent(next)}`;
  return (
    <main className="container" style={{ maxWidth: 620 }}>
      <div className="card" style={{ marginTop: 40, padding: "32px 28px", textAlign: "center" }}>
        <span className="gate-icon" aria-hidden="true"><Lock size={22} /></span>
        <h1 style={{ margin: "14px 0 0", fontSize: 26 }}>{c.title}</h1>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, margin: "10px auto 0", maxWidth: 460 }}>{c.body}</p>
        {current && (
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: "12px auto 0", maxWidth: 460 }}>
            You&apos;re signed in as <strong style={{ color: "var(--text-high)" }}>{current.name}</strong>. {c.wrong}
          </p>
        )}
        <div className="row" style={{ justifyContent: "center", gap: 10, marginTop: 22 }}>
          <Link href={href} className="btn btn-primary link-arrow">
            <span>{current ? "Switch account" : c.cta}</span>
            <ArrowRight size={16} />
          </Link>
          {current ? (
            <Link href={homeOf(current)} className="btn btn-ghost">Go to my {current.kind === "mm" ? "workspace" : "portal"}</Link>
          ) : (
            <Link href="/explore" className="btn btn-ghost">Browse public records</Link>
          )}
        </div>
      </div>
    </main>
  );
}

/** Shown when a signed-in account opens an engagement that isn't theirs. Never reveals whose it is. */
export function NotYours({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <main className="container" style={{ maxWidth: 620 }}>
      <div className="card" style={{ marginTop: 40, padding: "32px 28px", textAlign: "center" }}>
        <span className="gate-icon" aria-hidden="true"><Lock size={22} /></span>
        <h1 style={{ margin: "14px 0 0", fontSize: 24 }}>Not part of your account</h1>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, margin: "10px auto 0", maxWidth: 440 }}>
          This engagement either doesn&apos;t exist or belongs to someone else. Private engagement
          data is only visible to the market maker and client who are party to it.
        </p>
        <div className="row" style={{ justifyContent: "center", marginTop: 22 }}>
          <Link href={backHref} className="btn btn-primary">{backLabel}</Link>
        </div>
      </div>
    </main>
  );
}
