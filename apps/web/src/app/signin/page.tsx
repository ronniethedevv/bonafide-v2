import { redirect } from "next/navigation";
import { PERSONAS, getAuth, safeNext, type Persona } from "@/lib/session";
import { WalletSignIn } from "@/components/wallet/wallet-signin";
import { ArrowRight, Info } from "@/components/icons";

export const metadata = { title: "Sign in · MM Reputation" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; as?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const auth = await getAuth();
  if (auth.pendingWallet) redirect(`/onboarding${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  const current = auth.session;
  const mms = PERSONAS.filter((p) => p.session.kind === "mm");
  const clients = PERSONAS.filter((p) => p.session.kind === "client");
  const groups =
    sp.as === "client"
      ? [{ title: "Clients", hint: "Projects and funds that hire market makers.", list: clients }, { title: "Market makers", hint: "Firms that provide liquidity and prove it.", list: mms }]
      : [{ title: "Market makers", hint: "Firms that provide liquidity and prove it.", list: mms }, { title: "Clients", hint: "Projects and funds that hire market makers.", list: clients }];

  return (
    <main className="container" style={{ maxWidth: 760 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Account</div>
      <h1 style={{ margin: 0, fontSize: "clamp(28px, 4vw, 40px)" }}>Sign in</h1>
      <p className="muted" style={{ fontSize: 14, margin: "10px 0 0", maxWidth: 560, lineHeight: 1.6 }}>
        Each account sees only its own private data: a market maker sees their own
        workspace, a client sees only the engagements they are party to. Everyone can
        browse the public records.
      </p>

      <div style={{ marginTop: 22 }}>
        <WalletSignIn next={next} enabled={auth.walletEnabled} />
      </div>

      <div className="divider-label" style={{ marginTop: 34 }}><span>or explore with a demo account</span></div>
      <div className="demo-note" style={{ marginTop: 12 }}>
        <Info size={14} />
        <span>Demo accounts come with sample engagements. No wallet or password needed.</span>
      </div>

      {current && (
        <div className="card" style={{ marginTop: 20, padding: "14px 18px" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Signed in as <strong style={{ color: "var(--text-high)" }}>{current.name}</strong>. Pick another account to switch.
          </span>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.title} style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>{g.title}</h2>
          <p className="dim" style={{ fontSize: 13, margin: "4px 0 12px" }}>{g.hint}</p>
          <div className="cols-2">
            {g.list.map((p) => (
              <PersonaCard key={p.session.id} p={p} next={next} active={current?.id === p.session.id} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

function PersonaCard({ p, next, active }: { p: Persona; next: string | undefined; active: boolean }) {
  const initials = p.session.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
  return (
    <form action="/api/session" method="post" style={{ margin: 0 }}>
      <input type="hidden" name="persona" value={p.session.id} />
      {next && <input type="hidden" name="next" value={next} />}
      <button type="submit" className="card interactive persona-card" style={active ? { borderColor: "var(--accent)" } : undefined}>
        <span className="persona-avatar" aria-hidden="true">{initials}</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--text-high)" }}>{p.session.name}</span>
          <span className="dim" style={{ display: "block", fontSize: 12, marginTop: 3, lineHeight: 1.45 }}>{p.blurb}</span>
        </span>
        <ArrowRight size={16} style={{ color: "var(--text-dim)" }} />
      </button>
    </form>
  );
}
