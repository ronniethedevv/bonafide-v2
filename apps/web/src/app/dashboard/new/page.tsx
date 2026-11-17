"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

// Register-engagement wizard. The MM sets the deal, the measurable KPI terms, their
// private wallet set and the bond, reviews the exact commitment that will go on-chain,
// and registers. The privacy model is front-and-centre: the wallets and terms are
// committed (hashed with a fresh salt) — the chain only ever sees that commitment,
// never these values. No backend here: "Register" shows what would be committed.

const POOLS = [
  { id: "weth-usdc-base", pair: "WETH / USDC", chain: "Base", addr: "0xd0b53d9277642d899df5c87a3966a349a798f224" },
  { id: "cbbtc-usdc-base", pair: "cbBTC / USDC", chain: "Base", addr: "0xfbb6eed8e7aa03b138556eedaf5d271a5e1e43ef" },
  { id: "degen-weth-base", pair: "DEGEN / WETH", chain: "Base", addr: "0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801" },
  { id: "weth-usdc-eth", pair: "WETH / USDC", chain: "Ethereum", addr: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640" },
] as const;

const BANDS = [50, 100, 200, 500];
const STEPS = ["Deal", "KPI terms", "Wallets", "Bond", "Review"] as const;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

interface Form {
  poolId: string;
  label: string;
  loan: string;
  depthTarget: string;
  bandBps: number;
  minUptime: string;
  epochs: string;
  roundtrip: string;
  wallets: string[];
  bond: string;
}

const EMPTY: Form = {
  poolId: POOLS[0].id,
  label: "",
  loan: "",
  depthTarget: "",
  bandBps: 100,
  minUptime: "90",
  epochs: "30",
  roundtrip: "60",
  wallets: [""],
  bond: "",
};

export default function NewEngagementPage() {
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(EMPTY);
  const [registered, setRegistered] = useState<{ id: string; commitment: string } | null>(null);

  const set = (k: keyof Form, v: string | number | string[]) => setF((p) => ({ ...p, [k]: v }));
  const pool = POOLS.find((p) => p.id === f.poolId)!;
  const cleanWallets = f.wallets.map((w) => w.trim()).filter(Boolean);

  const errors = useMemo(() => validate(f, cleanWallets), [f, cleanWallets]);
  const stepValid = (s: number): boolean => {
    if (s === 0) return !errors.label && !errors.loan;
    if (s === 1) return !errors.depthTarget && !errors.minUptime && !errors.epochs && !errors.roundtrip;
    if (s === 2) return !errors.wallets;
    if (s === 3) return !errors.bond;
    return Object.keys(errors).length === 0;
  };

  if (registered) return <Success id={registered.id} commitment={registered.commitment} />;

  return (
    <main className="container" style={{ maxWidth: 820 }}>
      <Link href="/dashboard" className="muted" style={{ fontSize: 13 }}>← Workspace</Link>
      <div className="eyebrow" style={{ margin: "14px 0 4px" }}>New engagement</div>
      <h1 style={{ margin: 0, fontSize: "clamp(28px, 4vw, 40px)" }}>Register an engagement</h1>

      <Steps step={step} />

      <div className="card" style={{ marginTop: 18, padding: 28 }}>
        {step === 0 && (
          <Section title="The deal" hint="A client engagement over a specific pool. Your private label never leaves your workspace.">
            <Field label="Pool">
              <select className="inp" value={f.poolId} onChange={(e) => set("poolId", e.target.value)}>
                {POOLS.map((p) => (
                  <option key={p.id} value={p.id}>{p.pair} — {p.chain}</option>
                ))}
              </select>
              <div className="dim mono" style={{ fontSize: 11, marginTop: 6 }}>{pool.addr}</div>
            </Field>
            <Field label="Private label" err={errors.label}>
              <input className="inp" placeholder="e.g. Orion desk — WETH pair" value={f.label} onChange={(e) => set("label", e.target.value)} />
            </Field>
            <Field label="Loan" err={errors.loan} suffix="USDM">
              <input className="inp" inputMode="decimal" placeholder="2000000" value={f.loan} onChange={(e) => set("loan", e.target.value)} />
            </Field>
          </Section>
        )}

        {step === 1 && (
          <Section title="KPI terms" hint="The measurable targets you'll prove each epoch. These are committed, never revealed.">
            <div className="row2">
              <Field label="Depth target (per side)" err={errors.depthTarget} suffix="USDM">
                <input className="inp" inputMode="decimal" placeholder="250000" value={f.depthTarget} onChange={(e) => set("depthTarget", e.target.value)} />
              </Field>
              <Field label="Depth band">
                <select className="inp" value={f.bandBps} onChange={(e) => set("bandBps", Number(e.target.value))}>
                  {BANDS.map((b) => <option key={b} value={b}>±{b} bps</option>)}
                </select>
              </Field>
            </div>
            <div className="row2">
              <Field label="Min uptime" err={errors.minUptime} suffix="% of buckets">
                <input className="inp" inputMode="numeric" placeholder="90" value={f.minUptime} onChange={(e) => set("minUptime", e.target.value)} />
              </Field>
              <Field label="Contract length" err={errors.epochs} suffix="epochs (1–90)">
                <input className="inp" inputMode="numeric" placeholder="30" value={f.epochs} onChange={(e) => set("epochs", e.target.value)} />
              </Field>
            </div>
            <Field label="Round-trip cap" err={errors.roundtrip} suffix="% of volume">
              <input className="inp" inputMode="numeric" placeholder="60" value={f.roundtrip} onChange={(e) => set("roundtrip", e.target.value)} />
            </Field>
          </Section>
        )}

        {step === 2 && (
          <Section title="Your wallets" hint="The addresses you'll quote from (up to 16). These are committed privately — the chain never sees them.">
            {f.wallets.map((w, i) => {
              const bad = w.trim() !== "" && !ADDR_RE.test(w.trim());
              return (
                <div key={i} className="row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input
                    className="inp mono"
                    style={{ borderColor: bad ? "var(--neg)" : undefined, fontSize: 13 }}
                    placeholder="0x…"
                    value={w}
                    onChange={(e) => set("wallets", f.wallets.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  {f.wallets.length > 1 && (
                    <button className="btn btn-ghost" style={{ height: 40, padding: "0 12px" }} onClick={() => set("wallets", f.wallets.filter((_, j) => j !== i))}>Remove</button>
                  )}
                </div>
              );
            })}
            {f.wallets.length < 16 && (
              <button className="btn btn-ghost" style={{ height: 38, marginTop: 4 }} onClick={() => set("wallets", [...f.wallets, ""])}>+ Add wallet</button>
            )}
            {errors.wallets && <div style={{ color: "var(--neg)", fontSize: 12, marginTop: 8 }}>{errors.wallets}</div>}
          </Section>
        )}

        {step === 3 && (
          <Section title="Bond" hint="The bond you post against the engagement — released in tranches as epochs settle, slashed on default.">
            <Field label="Bond amount" err={errors.bond} suffix="USDM">
              <input className="inp" inputMode="decimal" placeholder="120000" value={f.bond} onChange={(e) => set("bond", e.target.value)} />
            </Field>
          </Section>
        )}

        {step === 4 && <Review f={f} pool={pool} wallets={cleanWallets} onRegister={(commitment) => setRegistered({ id: nextId(), commitment })} />}
      </div>

      {step < 4 && (
        <div className="row" style={{ justifyContent: "space-between", marginTop: 18 }}>
          <button className="btn btn-ghost" disabled={step === 0} style={{ opacity: step === 0 ? 0.4 : 1 }} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</button>
          <button className="btn btn-primary" disabled={!stepValid(step)} style={{ opacity: stepValid(step) ? 1 : 0.4 }} onClick={() => setStep((s) => s + 1)}>Continue</button>
        </div>
      )}

      <StyleTag />
    </main>
  );
}

function validate(f: Form, wallets: string[]): Record<string, string> {
  const e: Record<string, string> = {};
  const pos = (v: string) => v.trim() !== "" && Number(v) > 0 && Number.isFinite(Number(v));
  const pct = (v: string) => pos(v) && Number(v) <= 100;
  if (!f.label.trim()) e.label = "Give the deal a private label.";
  if (!pos(f.loan)) e.loan = "Enter a loan amount.";
  if (!pos(f.depthTarget)) e.depthTarget = "Enter a depth target.";
  if (!pct(f.minUptime)) e.minUptime = "0–100.";
  if (!(Number.isInteger(Number(f.epochs)) && Number(f.epochs) >= 1 && Number(f.epochs) <= 90)) e.epochs = "1–90 epochs.";
  if (!pct(f.roundtrip)) e.roundtrip = "0–100.";
  if (!pos(f.bond)) e.bond = "Enter a bond amount.";
  if (wallets.length === 0) e.wallets = "Add at least one wallet.";
  else if (wallets.some((w) => !ADDR_RE.test(w))) e.wallets = "Every wallet must be a 0x address (40 hex chars).";
  else if (new Set(wallets.map((w) => w.toLowerCase())).size !== wallets.length) e.wallets = "Duplicate wallet.";
  else if (wallets.length > 16) e.wallets = "At most 16 wallets.";
  return e;
}

function Review({ f, pool, wallets, onRegister }: { f: Form; pool: (typeof POOLS)[number]; wallets: string[]; onRegister: (c: string) => void }) {
  const [commitment, setCommitment] = useState<string>("computing…");
  useEffect(() => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const body = JSON.stringify({
      pool: pool.addr, loan: f.loan, depthTarget: f.depthTarget, bandBps: f.bandBps,
      minUptime: f.minUptime, epochs: f.epochs, roundtrip: f.roundtrip,
      wallets: [...wallets].map((w) => w.toLowerCase()).sort(), bond: f.bond,
      salt: Array.from(salt),
    });
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)).then((d) => {
      setCommitment("0x" + Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join(""));
    });
  }, [f, pool, wallets]);

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 12 }}>Review & register</div>
      <dl className="rev">
        <Row k="Pool" v={`${pool.pair} — ${pool.chain}`} />
        <Row k="Label (private)" v={f.label} />
        <Row k="Depth target" v={`${fmt(f.depthTarget)} USDM / side @ ±${f.bandBps}bps`} />
        <Row k="Min uptime" v={`${f.minUptime}% of buckets`} />
        <Row k="Contract" v={`${f.epochs} epochs`} />
        <Row k="Loan" v={`${fmt(f.loan)} USDM`} />
        <Row k="Round-trip cap" v={`${f.roundtrip}% of volume`} />
        <Row k="Wallets (private)" v={`${wallets.length} committed`} />
        <Row k="Bond" v={`${fmt(f.bond)} USDM`} />
      </dl>

      <div style={{ marginTop: 16, padding: "14px 16px", background: "var(--accent-soft)", border: "1px solid color-mix(in srgb, var(--accent) 24%, transparent)", borderRadius: "var(--radius-sm)" }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Goes on-chain — the commitment only</div>
        <code className="mono" style={{ fontSize: 12, color: "var(--text-muted)", wordBreak: "break-all" }}>{commitment}</code>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: "10px 0 0" }}>
          Your wallets and KPI terms are hashed with a fresh salt into this commitment.
          The chain records only the commitment — never the addresses, targets or loan above.
        </p>
      </div>

      <button className="btn btn-primary" style={{ marginTop: 18, width: "100%" }} disabled={commitment.startsWith("computing")} onClick={() => onRegister(commitment)}>
        Register engagement
      </button>
    </div>
  );
}

function Success({ id, commitment }: { id: string; commitment: string }) {
  return (
    <main className="container" style={{ maxWidth: 640 }}>
      <div className="card" style={{ marginTop: 40, padding: 32, textAlign: "center" }}>
        <div style={{ width: 48, height: 48, borderRadius: 999, background: "color-mix(in srgb, var(--pos) 18%, transparent)", color: "var(--pos)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 14 }}>✓</div>
        <h2 style={{ margin: 0, fontSize: 24 }}>Engagement registered</h2>
        <p className="muted" style={{ fontSize: 14, margin: "10px auto 0", maxWidth: 440, lineHeight: 1.6 }}>
          Committed privately as <span className="mono" style={{ color: "var(--text)" }}>{id}</span>. The chain holds only the
          commitment below — your wallets and terms never left this session. Capture begins at epoch 1.
        </p>
        <code className="mono" style={{ display: "block", marginTop: 14, padding: "10px 12px", background: "var(--code)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 11.5, color: "var(--text-muted)", wordBreak: "break-all" }}>{commitment}</code>
        <div className="row" style={{ justifyContent: "center", gap: 10, marginTop: 20 }}>
          <Link href="/dashboard" className="btn btn-primary">Back to workspace</Link>
          <Link href="/dashboard/new" className="btn btn-ghost">Register another</Link>
        </div>
        <p className="dim" style={{ fontSize: 11, marginTop: 16 }}>Demo: the engagement isn&apos;t persisted in this preview.</p>
      </div>
      <StyleTag />
    </main>
  );
}

// --- small bits ----------------------------------------------------------------------
function Steps({ step }: { step: number }) {
  return (
    <div className="row" style={{ gap: 0, alignItems: "center", marginTop: 20, flexWrap: "nowrap", overflowX: "auto" }}>
      {STEPS.map((s, i) => (
        <div key={s} className="row" style={{ gap: 0, alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}>
          <span className="row" style={{ gap: 8, alignItems: "center", flexShrink: 0 }}>
            <span style={{ width: 22, height: 22, borderRadius: 999, flexShrink: 0, background: i < step ? "var(--pos)" : i === step ? "var(--accent)" : "transparent", border: `1.5px solid ${i < step ? "var(--pos)" : i === step ? "var(--accent)" : "var(--border-strong)"}`, color: i <= step ? "#06281c" : "var(--text-dim)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>
              {i < step ? "✓" : i + 1}
            </span>
            <span className="step-label" style={{ fontSize: 13, fontWeight: i === step ? 600 : 500, color: i === step ? "var(--text-high)" : "var(--text-dim)", whiteSpace: "nowrap" }}>{s}</span>
          </span>
          {i < STEPS.length - 1 && <span style={{ flex: 1, height: 1.5, minWidth: 14, margin: "0 10px", background: i < step ? "var(--pos)" : "var(--border)" }} />}
        </div>
      ))}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ margin: "0 0 4px", fontSize: 18 }}>{title}</h3>
      <p className="muted" style={{ fontSize: 13, margin: "0 0 20px", lineHeight: 1.55 }}>{hint}</p>
      <div style={{ display: "grid", gap: 16 }}>{children}</div>
    </div>
  );
}

function Field({ label, err, suffix, children }: { label: string; err?: string | undefined; suffix?: string | undefined; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{label}</span>
        {suffix && <span className="dim" style={{ fontSize: 12 }}>{suffix}</span>}
      </div>
      {children}
      {err && <div style={{ color: "var(--neg)", fontSize: 12, marginTop: 5 }}>{err}</div>}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--border)", gap: 16 }}>
      <span className="dim" style={{ fontSize: 13 }}>{k}</span>
      <span className="mono" style={{ fontSize: 13, color: "var(--text)", textAlign: "right" }}>{v}</span>
    </div>
  );
}

function fmt(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : v;
}
let idCounter = 9;
function nextId(): string {
  return `rec_${String(++idCounter).padStart(2, "0")}`;
}

function StyleTag() {
  return (
    <style>{`
      .inp { width:100%; height:40px; padding:0 12px; background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text); font-family:var(--font-body); font-size:14px; }
      .inp:focus { outline:none; border-color:var(--accent); }
      select.inp { appearance:none; cursor:pointer; }
      .row2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
      @media (max-width:560px){ .row2 { grid-template-columns:1fr; } }
      .rev { margin:0; }
    `}</style>
  );
}
