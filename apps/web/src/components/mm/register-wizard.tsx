"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { contexts, newOpening, ownershipMessage, registrationFingerprint, seal, sealFile, MIN_PASSPHRASE, type EngagementOpening, type WalletOwnership } from "@mmr/engagement-file";
import { verifyWalletOwnership, type OwnershipStatus } from "@/lib/engagement/ownership";
import { signMessage, walletErrorText } from "@/lib/wallet/browser";
import { BackLink, Check, Info, Lock, Plus } from "@/components/icons";
import { shortAddress } from "@/lib/auth/shared";
import { buildTerms, clientPayload, floorPriceToP, toUnits, type TokenInfo } from "@/lib/engagement/terms";

// Register-engagement wizard. The MM sets the deal, the measurable KPI terms, their
// private wallet set and the bond, then:
//  1. the browser generates the engagement's secrets and computes the protocol's real
//     commitments (walletCommit, termsCommit — what the contract's register records);
//  2. the MM must save a passphrase-encrypted engagement file holding those secrets —
//     without it the engagement could never be proven — before Register unlocks;
//  3. the full terms are sealed to the client's private inbox key, and the server stores
//     only the parties, the commitments and that sealed envelope. The client then
//     reviews the terms, checks them against the commitments, and accepts or declines.

// base = the client's token (the loan, caps and custody are in it); quote = what it trades
// against (depth is measured in it). Decimals set the raw on-chain units.
const WETH: TokenInfo = { symbol: "WETH", decimals: 18 };
const USDC: TokenInfo = { symbol: "USDC", decimals: 6 };
const POOLS = [
  { id: "weth-usdc-base", pair: "WETH / USDC", chain: "Base", addr: "0xd0b53d9277642d899df5c87a3966a349a798f224", base: WETH, quote: USDC },
  { id: "cbbtc-usdc-base", pair: "cbBTC / USDC", chain: "Base", addr: "0xfbb6eed8e7aa03b138556eedaf5d271a5e1e43ef", base: { symbol: "cbBTC", decimals: 8 }, quote: USDC },
  { id: "degen-weth-base", pair: "DEGEN / WETH", chain: "Base", addr: "0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801", base: { symbol: "DEGEN", decimals: 18 }, quote: WETH },
  { id: "weth-usdc-eth", pair: "WETH / USDC", chain: "Ethereum", addr: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640", base: WETH, quote: USDC },
] as const;
type Pool = (typeof POOLS)[number];

const BANDS = [50, 100, 200, 500];
const STEPS = ["Deal", "KPI terms", "Wallets", "Bond", "Review"] as const;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export interface ClientOption {
  id: string;
  name: string;
}

interface Form {
  poolId: string;
  clientId: string;
  clientAddress: string;
  label: string;
  loan: string;
  depthTarget: string;
  bandBps: number;
  minUptime: string;
  epochs: string;
  roundtrip: string;
  outflowCap: string;
  netSellCap: string;
  floorPrice: string;
  wallets: string[];
  bond: string;
  /** 1 = A, 2 = B, 3 = C: sets the minimum bond (the contract's tierMinBond). */
  tier: number;
  /** The client's Midnight coin public key (32-byte hex): receives the bond on default. */
  beneficiary: string;
}

/** The contract's minimum bond per tier, in the bond token's smallest unit (DD-35). */
const TIER_MIN_BOND: Record<number, number> = { 1: 10_000, 2: 5_000, 3: 2_500 };
const TIER_NAME: Record<number, string> = { 1: "A", 2: "B", 3: "C" };
const CHAIN_ID: Record<string, number> = { Base: 8453, Ethereum: 1 };
const KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/;

const EMPTY: Form = {
  poolId: POOLS[0].id,
  clientId: "",
  clientAddress: "",
  label: "",
  loan: "",
  depthTarget: "",
  bandBps: 100,
  minUptime: "90",
  epochs: "30",
  roundtrip: "60",
  outflowCap: "",
  netSellCap: "",
  floorPrice: "",
  wallets: [""],
  bond: "",
  tier: 1,
  beneficiary: "",
};

/**
 * `persist`: the MM's account is stored in the database, so registering saves the
 * engagement (parties + commitment) and the client, found by their sign-in wallet, sees
 * it in their portal. Otherwise (demo / browser-only accounts) nothing is saved.
 */
export function RegisterWizard({ clients, persist }: { clients: ClientOption[]; persist: boolean }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>({ ...EMPTY, clientId: clients[0]?.id ?? "" });
  const [registered, setRegistered] = useState<Registered | null>(null);

  const set = (k: keyof Form, v: string | number | string[]) => setF((p) => ({ ...p, [k]: v }));
  const pool = POOLS.find((p) => p.id === f.poolId)!;

  // A stored engagement names the client's own Midnight key (saved on their account) as the
  // bond's beneficiary; the market maker cannot type another. The client's acceptance
  // checks it again before they sign.
  const [beneficiaryNote, setBeneficiaryNote] = useState<string | null>(null);
  useEffect(() => {
    if (!persist) return;
    const address = f.clientAddress.trim();
    if (!ADDR_RE.test(address)) {
      setBeneficiaryNote(null);
      return;
    }
    let live = true;
    fetch(`/api/clients/inbox-key?address=${encodeURIComponent(address)}`, { cache: "no-store" })
      .then(async (r) => {
        const b = (await r.json()) as { midnightCoinKey?: string | null; error?: string };
        if (!live) return;
        set("beneficiary", r.ok && b.midnightCoinKey ? b.midnightCoinKey : "");
        setBeneficiaryNote(r.ok ? (b.midnightCoinKey ? null : "Your client hasn't saved their Midnight key yet. Ask them to add it in their client portal.") : (b.error ?? "Couldn't look up your client."));
      })
      .catch(() => live && setBeneficiaryNote("Couldn't look up your client. Check your connection."));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist, f.clientAddress]);
  const client = clients.find((c) => c.id === f.clientId);
  const cleanWallets = f.wallets.map((w) => w.trim()).filter(Boolean);
  const clientLabel = persist ? (ADDR_RE.test(f.clientAddress.trim()) ? shortAddress(f.clientAddress.trim()) : "—") : (client?.name ?? "—");

  const errors = useMemo(() => validate(f, cleanWallets, persist, pool), [f, cleanWallets, persist, pool]);
  const stepValid = (s: number): boolean => {
    if (s === 0) return !errors.label && !errors.loan && !errors.clientAddress;
    if (s === 1) return !errors.depthTarget && !errors.minUptime && !errors.epochs && !errors.roundtrip && !errors.outflowCap && !errors.netSellCap && !errors.floorPrice;
    if (s === 2) return !errors.wallets;
    if (s === 3) return !errors.bond && !errors.beneficiary;
    return Object.keys(errors).length === 0;
  };

  if (registered) return <Success {...registered} />;

  return (
    <main className="container" style={{ maxWidth: 820 }}>
      <BackLink href="/dashboard">Workspace</BackLink>
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
              <div className="dim mono" style={{ fontSize: 11, marginTop: 6, wordBreak: "break-all" }}>{pool.addr}</div>
            </Field>
            {persist ? (
              <Field label="Client's sign-in wallet" err={f.clientAddress.trim() ? errors.clientAddress : undefined}>
                <input className="inp mono" style={{ fontSize: 13 }} placeholder="0x…" value={f.clientAddress} onChange={(e) => set("clientAddress", e.target.value)} />
                <div className="dim" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
                  The wallet your client signs in to BonaFide v2 with (not a trading wallet). They need to have
                  signed in once. Only this client sees your per-epoch figures; the public never learns who they are.
                </div>
              </Field>
            ) : (
              <Field label="Client">
                <select className="inp" value={f.clientId} onChange={(e) => set("clientId", e.target.value)}>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
                  Only this client sees your per-epoch figures. The public sees pass/fail, never who the client is.
                </div>
              </Field>
            )}
            <Field label="Private label" err={errors.label}>
              <input className="inp" placeholder="e.g. Orion desk — WETH pair" value={f.label} onChange={(e) => set("label", e.target.value)} />
            </Field>
            <Field label={`Loan of ${pool.base.symbol}`} err={errors.loan} suffix={pool.base.symbol}>
              <input className="inp" inputMode="decimal" placeholder="2000000" value={f.loan} onChange={(e) => set("loan", e.target.value)} />
              <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>The client&apos;s tokens lent to you for market making.</div>
            </Field>
          </Section>
        )}

        {step === 1 && (
          <Section title="KPI terms" hint="The measurable targets you'll prove each epoch. These are committed, never revealed.">
            <div className="row2">
              <Field label="Depth target (per side)" err={errors.depthTarget} suffix={pool.quote.symbol}>
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
              <Field label="Contract length" err={errors.epochs} suffix="epochs (fixed)">
                <input className="inp" value="30" readOnly aria-readonly="true" title="Every engagement runs 30 daily epochs" />
              </Field>
            </div>
            <Field label="Round-trip cap" err={errors.roundtrip} suffix="% of volume">
              <input className="inp" inputMode="numeric" placeholder="60" value={f.roundtrip} onChange={(e) => set("roundtrip", e.target.value)} />
            </Field>
            <details className="adv">
              <summary>Advanced terms (optional)</summary>
              <div style={{ display: "grid", gap: 16, marginTop: 14 }}>
                <div className="row2">
                  <Field label="Outflow cap" err={errors.outflowCap} suffix={pool.base.symbol}>
                    <input className="inp" inputMode="decimal" placeholder="same as loan" value={f.outflowCap} onChange={(e) => set("outflowCap", e.target.value)} />
                  </Field>
                  <Field label="Net-selling cap" err={errors.netSellCap} suffix={pool.base.symbol}>
                    <input className="inp" inputMode="decimal" placeholder="0" value={f.netSellCap} onChange={(e) => set("netSellCap", e.target.value)} />
                  </Field>
                </div>
                <Field label="Floor price" err={errors.floorPrice} suffix={`${pool.quote.symbol} per ${pool.base.symbol}`}>
                  <input className="inp" inputMode="decimal" placeholder="blank: quote holdings don't count" value={f.floorPrice} onChange={(e) => set("floorPrice", e.target.value)} />
                </Field>
                <p className="dim" style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                  Outflow cap: how much of the client&apos;s token may leave your wallets over the contract (blank = the loan).
                  Net-selling cap: how much of it you may net-sell. Floor price: the agreed price at which tokens you sold
                  for {pool.quote.symbol} still count as held; leave blank if sold tokens shouldn&apos;t count.
                </p>
              </div>
            </details>
          </Section>
        )}

        {step === 2 && (
          <Section title="Your wallets" hint="The addresses you'll quote from (up to 16). They are committed privately: the chain never sees them, and this page sends them only to your client, sealed.">
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
              <button className="btn btn-ghost link-arrow" style={{ height: 38, marginTop: 4 }} onClick={() => set("wallets", [...f.wallets, ""])}><Plus size={15} /><span>Add wallet</span></button>
            )}
            {errors.wallets && <div style={{ color: "var(--neg)", fontSize: 12, marginTop: 8 }}>{errors.wallets}</div>}
            <div className="demo-note" style={{ marginTop: 14, alignItems: "flex-start" }}>
              <Info size={14} style={{ marginTop: 2 }} />
              <span style={{ lineHeight: 1.5 }}>
                Recommended: keep your wallet addresses off any web page. Your agent creates the engagement file on your own
                machine, collects each wallet&apos;s ownership signature and proposes it; this site then only ever sees the
                commitments and the terms sealed to your client:{" "}
                <code className="mono" style={{ fontSize: 12 }}>mmr-agent create</code> then{" "}
                <code className="mono" style={{ fontSize: 12 }}>mmr-agent propose</code>.
              </span>
            </div>
          </Section>
        )}

        {step === 3 && (
          <Section title="Bond" hint="The bond you post against the engagement: released in tranches as days settle, and paid to the client if the engagement defaults. Tier, chain, bond and the client's key are public on chain; nothing else is.">
            <Field label="Tier" suffix={`minimum bond ${TIER_MIN_BOND[f.tier]!.toLocaleString("en-US")}`}>
              <select className="inp" value={f.tier} onChange={(e) => set("tier", Number(e.target.value))}>
                {[1, 2, 3].map((t) => (
                  <option key={t} value={t}>{`Tier ${TIER_NAME[t]} (minimum ${TIER_MIN_BOND[t]!.toLocaleString("en-US")})`}</option>
                ))}
              </select>
            </Field>
            <div style={{ height: 14 }} />
            <Field label="Bond amount" err={errors.bond} suffix="bond token units">
              <input className="inp" inputMode="numeric" placeholder={String(TIER_MIN_BOND[f.tier])} value={f.bond} onChange={(e) => set("bond", e.target.value)} />
            </Field>
            <div style={{ height: 14 }} />
            <Field
              label="Client's Midnight coin public key"
              err={persist ? (beneficiaryNote ?? undefined) : f.beneficiary.trim() ? errors.beneficiary : undefined}
              suffix={persist ? "from your client's account" : "receives the bond on default"}
            >
              <input
                className="inp mono"
                style={{ fontSize: 13 }}
                placeholder={persist ? "filled from your client's account" : "64 hex characters"}
                value={f.beneficiary}
                readOnly={persist}
                onChange={(e) => set("beneficiary", e.target.value)}
              />
            </Field>
          </Section>
        )}

        {step === 4 && (
          <Review
            f={f}
            pool={pool}
            clientLabel={clientLabel}
            demoClientName={client?.name}
            wallets={cleanWallets}
            persist={persist}
            onRegistered={setRegistered}
            onEditClient={() => setStep(0)}
          />
        )}
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

function validate(f: Form, wallets: string[], persist: boolean, pool: Pool): Record<string, string> {
  const e: Record<string, string> = {};
  if (persist && !ADDR_RE.test(f.clientAddress.trim())) e.clientAddress = "Enter your client's 0x wallet address.";
  const pos = (v: string) => v.trim() !== "" && Number(v.replace(/,/g, "")) > 0 && Number.isFinite(Number(v.replace(/,/g, "")));
  const pct = (v: string) => pos(v) && Number(v) <= 100;
  const amount = (v: string, t: TokenInfo) => toUnits(v, t.decimals) !== null;
  if (!f.label.trim()) e.label = "Give the deal a private label.";
  if (!pos(f.loan) || !amount(f.loan, pool.base)) e.loan = `Enter an amount of ${pool.base.symbol} (up to ${pool.base.decimals} decimals).`;
  if (!pos(f.depthTarget) || !amount(f.depthTarget, pool.quote)) e.depthTarget = `Enter an amount of ${pool.quote.symbol} (up to ${pool.quote.decimals} decimals).`;
  if (!pct(f.minUptime)) e.minUptime = "0–100.";
  // Every engagement runs 30 daily epochs (the contract enforces it), so length can't
  // link a profile claim back to its engagement.
  if (f.epochs !== "30") e.epochs = "Engagements run 30 epochs.";
  if (!pct(f.roundtrip)) e.roundtrip = "0–100.";
  const minBond = TIER_MIN_BOND[f.tier] ?? 0;
  const bond = f.bond.replace(/,/g, "").trim();
  if (!/^\d+$/.test(bond) || Number(bond) < minBond) e.bond = `Enter a whole number, at least ${minBond.toLocaleString("en-US")} for tier ${TIER_NAME[f.tier]}.`;
  if (!KEY_RE.test(f.beneficiary.trim()) || /^(0x)?0+$/.test(f.beneficiary.trim())) e.beneficiary = "Enter your client's Midnight coin public key (64 hex characters).";
  for (const k of ["outflowCap", "netSellCap"] as const) {
    if (f[k].trim() && !amount(f[k], pool.base)) e[k] = `Enter an amount of ${pool.base.symbol}, or leave blank.`;
  }
  if (f.floorPrice.trim()) {
    const r = floorPriceToP(f.floorPrice, pool.base, pool.quote);
    if (!r.ok) e.floorPrice = r.error;
  }
  if (wallets.length === 0) e.wallets = "Add at least one wallet.";
  else if (wallets.some((w) => !ADDR_RE.test(w))) e.wallets = "Every wallet must be a 0x address (40 hex chars).";
  else if (new Set(wallets.map((w) => w.toLowerCase())).size !== wallets.length) e.wallets = "Duplicate wallet.";
  else if (wallets.length > 16) e.wallets = "At most 16 wallets.";
  return e;
}

interface Registered {
  id: string;
  fingerprint: string;
  clientName: string | undefined;
  fileName: string;
  saved: boolean;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Review({
  f, pool, clientLabel, demoClientName, wallets, persist, onRegistered, onEditClient,
}: {
  f: Form; pool: Pool; clientLabel: string; demoClientName: string | undefined; wallets: string[]; persist: boolean;
  onRegistered: (r: Registered) => void; onEditClient: () => void;
}) {
  const [opening, setOpening] = useState<EngagementOpening | null>(null);
  const [clientKey, setClientKey] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "saving" | "registering">("");
  const [error, setError] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [owned, setOwned] = useState<Record<string, WalletOwnership & { status: OwnershipStatus }>>({});
  const proven = wallets.every((w) => owned[w.toLowerCase()]?.status.ok);
  // Real accounts must prove every wallet; demo accounts quote sample wallets nobody controls.
  const ownershipOk = proven || !persist;
  const sealed = (o: EngagementOpening): EngagementOpening => {
    const ownership = Object.values(owned).filter((x) => x.status.ok).map(({ wallet, signature }) => ({ wallet, signature }));
    return ownership.length ? { ...o, ownership } : o;
  };

  // Fresh secrets + the protocol's real commitments, once per visit to this step.
  useEffect(() => {
    const { terms, human } = buildTerms({ ...f, pool: pool.addr, base: pool.base, quote: pool.quote });
    newOpening({
      pool: { chain: pool.chain, address: pool.addr, pair: pool.pair, base: pool.base, quote: pool.quote },
      client: persist ? { address: f.clientAddress.trim().toLowerCase() } : demoClientName ? { name: demoClientName } : {},
      label: f.label.trim(),
      wallets,
      terms,
      human,
      registration: {
        tier: f.tier,
        chainId: CHAIN_ID[pool.chain] ?? 0,
        bond: f.bond.replace(/,/g, "").trim(),
        beneficiary: f.beneficiary.trim().replace(/^0x/, "").toLowerCase(),
      },
    })
      .then(setOpening)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't prepare the engagement."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The client's inbox key, to seal the terms to.
  useEffect(() => {
    if (!persist) return;
    fetch(`/api/clients/inbox-key?address=${encodeURIComponent(f.clientAddress.trim())}`, { cache: "no-store" })
      .then(async (r) => {
        const b = (await r.json()) as { encryptionKey?: string; error?: string };
        if (r.ok && b.encryptionKey) setClientKey(b.encryptionKey);
        else setClientError(b.error ?? "Couldn't find your client's inbox.");
      })
      .catch(() => setClientError("Couldn't look up your client. Check your connection."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const passErr = pass.length > 0 && pass.length < MIN_PASSPHRASE ? `At least ${MIN_PASSPHRASE} characters.` : pass2.length > 0 && pass !== pass2 ? "Passphrases don't match." : null;
  const canSave = !!opening && pass.length >= MIN_PASSPHRASE && pass === pass2 && !busy && ownershipOk;

  async function saveFile() {
    if (!opening) return;
    setBusy("saving");
    setError(null);
    try {
      const file = await sealFile(sealed(opening), pass);
      const name = `engagement-${opening.commitments.termsCommit.slice(2, 10)}.mmr.json`;
      download(name, JSON.stringify(file, null, 2));
      setFileName(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the file.");
    }
    setBusy("");
  }

  async function register() {
    if (!opening || !fileName) return;
    setBusy("registering");
    setError(null);
    try {
      if (!persist) {
        onRegistered({ id: nextId(), fingerprint: opening.commitments.termsCommit, clientName: demoClientName, fileName, saved: false });
        return;
      }
      if (!clientKey) throw new Error(clientError ?? "Your client's inbox isn't available.");
      const { walletCommit, termsCommit } = opening.commitments;
      const termsEnvelope = await seal(JSON.stringify(clientPayload(sealed(opening))), clientKey, contexts.terms(walletCommit, termsCommit));
      const res = await fetch("/api/engagements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientAddress: f.clientAddress.trim(), walletCommit, termsCommit, termsEnvelope }),
      });
      const body = (await res.json()) as { ok?: boolean; id?: string; clientName?: string; fingerprint?: string; error?: string; errors?: Record<string, string> };
      if (!res.ok || !body.ok || !body.id) throw new Error(body.errors?.clientAddress ?? body.error ?? "Couldn't register the engagement.");
      onRegistered({ id: body.id, fingerprint: body.fingerprint ?? "", clientName: body.clientName, fileName, saved: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't register the engagement.");
      setBusy("");
    }
  }

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 12 }}>Review & register</div>
      <dl className="rev">
        <Row k="Pool" v={`${pool.pair} — ${pool.chain}`} />
        <Row k="Client (private)" v={clientLabel} />
        <Row k="Label (private)" v={f.label} />
        <Row k="Depth target" v={`${fmt(f.depthTarget)} ${pool.quote.symbol} / side @ ±${f.bandBps}bps`} />
        <Row k="Min uptime" v={`${f.minUptime}% of buckets`} />
        <Row k="Contract" v={`${f.epochs} epochs`} />
        <Row k="Loan" v={`${fmt(f.loan)} ${pool.base.symbol}`} />
        <Row k="Round-trip cap" v={`${f.roundtrip}% of volume`} />
        <Row k="Outflow cap" v={`${fmt(f.outflowCap.trim() || f.loan)} ${pool.base.symbol}`} />
        <Row k="Net-selling cap" v={`${fmt(f.netSellCap.trim() || "0")} ${pool.base.symbol}`} />
        <Row k="Floor price" v={f.floorPrice.trim() ? `${fmt(f.floorPrice)} ${pool.quote.symbol} per ${pool.base.symbol}` : "not set"} />
        <Row k="Wallets (private)" v={`${wallets.length} committed`} />
        <Row k="Tier · bond (public)" v={`${TIER_NAME[f.tier]} · ${fmt(f.bond)}`} />
        <Row k="Client's Midnight key (public)" v={`${f.beneficiary.trim().replace(/^0x/, "").slice(0, 10)}…`} />
      </dl>

      {persist && clientError && (
        <div role="alert" style={{ marginTop: 14, fontSize: 13, color: "var(--neg)", lineHeight: 1.5 }}>
          {clientError}{" "}
          <button type="button" className="link-btn" onClick={onEditClient}>Edit client</button>
        </div>
      )}

      <div className="commit-box">
        <div className="eyebrow" style={{ marginBottom: 8 }}>Goes on-chain: the commitments only</div>
        <div className="commit-line"><span className="dim">Wallets</span><code className="mono">{opening?.commitments.walletCommit ?? "computing…"}</code></div>
        <div className="commit-line"><span className="dim">Terms</span><code className="mono">{opening?.commitments.termsCommit ?? "computing…"}</code></div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: "10px 0 0" }}>
          Your wallets and terms are each hashed with a fresh secret value. The chain records only these two
          fingerprints, never the addresses, targets or loan above.
        </p>
      </div>

      {opening && (
        <OwnershipBox
          wallets={wallets}
          chainId={CHAIN_ID[pool.chain] ?? 8453}
          commitments={opening.commitments}
          owned={owned}
          required={persist}
          locked={!!fileName}
          onProven={(o) => setOwned((m) => ({ ...m, [o.wallet]: o }))}
        />
      )}

      <div className={`save-box${fileName ? " is-done" : ""}`}>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <span className="view-icon" aria-hidden="true">{fileName ? <Check size={17} /> : <Lock size={17} />}</span>
          <div>
            <div style={{ fontWeight: 600, color: "var(--text-high)" }}>{fileName ? "Engagement file saved" : "Save your engagement file"}</div>
            <div className="dim" style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.5 }}>
              {fileName ? (
                <>Saved as <span className="mono">{fileName}</span>. Keep it and its passphrase safe: you need both to prove this engagement.</>
              ) : (
                <>It holds the secret values behind the commitments. Without it, this engagement can never be proven, and we can&apos;t recover it for you.</>
              )}
            </div>
          </div>
        </div>
        {!fileName && (
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <div className="row2">
              <input className="inp" type="password" autoComplete="new-password" placeholder={`Passphrase (${MIN_PASSPHRASE}+ characters)`} value={pass} onChange={(e) => setPass(e.target.value)} aria-label="Passphrase" />
              <input className="inp" type="password" autoComplete="new-password" placeholder="Repeat passphrase" value={pass2} onChange={(e) => setPass2(e.target.value)} aria-label="Repeat passphrase" />
            </div>
            {passErr && <div className="field-err" style={{ marginTop: 0 }}>{passErr}</div>}
            {!ownershipOk && <div className="field-err" style={{ marginTop: 0 }}>Prove each wallet above first: its signature goes into the file and to your client.</div>}
            <button type="button" className="btn btn-ghost" disabled={!canSave} style={{ opacity: canSave ? 1 : 0.5 }} onClick={saveFile}>
              {busy === "saving" ? "Encrypting…" : "Download encrypted file"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" style={{ marginTop: 14, fontSize: 13, color: "var(--neg)", lineHeight: 1.5 }}>
          {error}{" "}
          {persist && <button type="button" className="link-btn" onClick={onEditClient}>Edit client</button>}
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ marginTop: 18, width: "100%" }}
        disabled={!opening || !fileName || !!busy || (persist && !clientKey)}
        onClick={register}
      >
        {busy === "registering" ? "Registering…" : fileName ? "Register engagement" : "Save the file first to register"}
      </button>
      {persist && (
        <div className="demo-note" style={{ marginTop: 12, alignItems: "flex-start" }}>
          <Info size={14} style={{ marginTop: 2 }} />
          <span style={{ lineHeight: 1.5 }}>
            Registering sends your client the full terms, encrypted so only they can read them. They check the terms against
            the commitments and accept or decline.
          </span>
        </div>
      )}
    </div>
  );
}

// Each committed trading wallet signs a message naming itself, its chain and this
// registration's fingerprint: proof the market maker controls it, checked again by the
// client before Accept unlocks. Sign here with the connected wallet, or paste a signature
// made elsewhere (a custody platform's signing policy, a hardware wallet, the agent).
function OwnershipBox({ wallets, chainId, commitments, owned, required, locked, onProven }: {
  wallets: string[];
  chainId: number;
  commitments: { walletCommit: string; termsCommit: string };
  owned: Record<string, WalletOwnership & { status: OwnershipStatus }>;
  required: boolean;
  locked: boolean;
  onProven: (o: WalletOwnership & { status: OwnershipStatus }) => void;
}) {
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [pasted, setPasted] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    registrationFingerprint(commitments.walletCommit, commitments.termsCommit).then(setFingerprint).catch(() => setFingerprint(null));
  }, [commitments.walletCommit, commitments.termsCommit]);

  async function prove(wallet: string, signature: string) {
    if (!fingerprint) return;
    const status = await verifyWalletOwnership({ wallet, signature, chainId, fingerprint });
    if (status.ok) onProven({ wallet, signature: signature.trim(), status });
    setErrors((e) => ({ ...e, [wallet]: status.ok ? "" : status.detail }));
  }

  async function signHere(wallet: string) {
    if (!fingerprint) return;
    setBusy(wallet);
    try {
      await prove(wallet, await signMessage(wallet, ownershipMessage({ wallet, chainId, fingerprint })));
    } catch (e) {
      setErrors((x) => ({ ...x, [wallet]: walletErrorText(e) }));
    }
    setBusy(null);
  }

  return (
    <div className="commit-box">
      <div className="eyebrow" style={{ marginBottom: 8 }}>Prove you control each wallet</div>
      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: "0 0 10px" }}>
        Each wallet signs a message naming itself and this engagement. It is a signature, not a transaction: no funds move.
        Your client checks every signature before they can accept.{" "}
        {required ? "Required to register." : "Demo accounts quote sample wallets, so this is optional here."}
      </p>
      {wallets.map((raw) => {
        const wallet = raw.toLowerCase();
        const done = owned[wallet]?.status;
        return (
          <div key={wallet} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
            <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className="mono" style={{ fontSize: 12.5 }}>{shortAddress(wallet)}</span>
              {done?.ok ? (
                <span className="pill" style={{ fontSize: 11, color: "var(--pos)" }}><Check size={12} /> {done.detail}</span>
              ) : !locked && (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!fingerprint || busy === wallet} onClick={() => signHere(wallet)}>
                    {busy === wallet ? "Check your wallet…" : "Sign with this wallet"}
                  </button>
                  <input
                    className="inp mono"
                    style={{ fontSize: 12, flex: "1 1 220px" }}
                    placeholder="or paste its signature (0x…)"
                    value={pasted[wallet] ?? ""}
                    onChange={(e) => setPasted((p) => ({ ...p, [wallet]: e.target.value }))}
                    onBlur={() => pasted[wallet]?.trim() && prove(wallet, pasted[wallet]!)}
                    aria-label={`Signature for ${wallet}`}
                  />
                </>
              )}
            </div>
            {!done?.ok && fingerprint && (
              <details style={{ marginTop: 6 }}>
                <summary className="dim" style={{ fontSize: 12, cursor: "pointer" }}>Message to sign</summary>
                <pre className="mono" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{ownershipMessage({ wallet, chainId, fingerprint })}</pre>
              </details>
            )}
            {errors[wallet] && <div className="field-err">{errors[wallet]}</div>}
          </div>
        );
      })}
    </div>
  );
}

function Success({ id, fingerprint, clientName, fileName, saved }: Registered) {
  return (
    <main className="container" style={{ maxWidth: 640 }}>
      <div className="card" style={{ marginTop: 40, padding: 32, textAlign: "center" }}>
        <div style={{ width: 48, height: 48, borderRadius: 999, background: "color-mix(in srgb, var(--pos) 18%, transparent)", color: "var(--pos)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
          <Check size={24} style={{ verticalAlign: "middle" }} />
        </div>
        <h2 style={{ margin: 0, fontSize: 24 }}>{saved ? "Sent to your client" : "Engagement prepared"}</h2>
        <p className="muted" style={{ fontSize: 14, margin: "10px auto 0", maxWidth: 460, lineHeight: 1.6 }}>
          {saved ? (
            <>
              Registered as <span className="mono" style={{ color: "var(--text)" }}>{id}</span>.{" "}
              {clientName ?? "Your client"} now reviews the terms and accepts or declines; you&apos;ll see their answer in your workspace.
            </>
          ) : (
            <>Demo: this engagement isn&apos;t saved. Sign in with a wallet to register real ones.</>
          )}
        </p>
        {fingerprint && (
          <code className="mono" style={{ display: "block", marginTop: 14, padding: "10px 12px", background: "var(--code)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 11.5, color: "var(--text-muted)", wordBreak: "break-all" }}>{fingerprint}</code>
        )}
        <div className="demo-note" style={{ marginTop: 14, justifyContent: "center" }}>
          <Lock size={13} />
          <span>Keep <span className="mono">{fileName}</span> and its passphrase. You need both to prove this engagement.</span>
        </div>
        <div className="row" style={{ justifyContent: "center", gap: 10, marginTop: 20 }}>
          <Link href="/dashboard" className="btn btn-primary">Back to workspace</Link>
          <Link href="/dashboard/new" className="btn btn-ghost">Register another</Link>
        </div>
      </div>
      <StyleTag />
    </main>
  );
}

// --- small bits ----------------------------------------------------------------------
function Steps({ step }: { step: number }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div className="stepper" role="list" aria-label="Registration steps">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <div key={s} className="stepper-item" role="listitem" aria-current={active ? "step" : undefined}>
              <span className={`stepper-dot${done ? " is-done" : active ? " is-active" : ""}`}>
                {done ? <Check size={12} /> : i + 1}
              </span>
              <span className={`step-label${active ? " is-active" : ""}${done ? " is-done" : ""}`}>{s}</span>
              {i < STEPS.length - 1 && <span className={`stepper-line${done ? " is-done" : ""}`} />}
            </div>
          );
        })}
      </div>
      <div className="stepper-caption" aria-hidden="true">
        Step {step + 1} of {STEPS.length} · <strong>{STEPS[step]}</strong>
      </div>
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
      select.inp { appearance:none; cursor:pointer; }
      .row2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
      @media (max-width:560px){ .row2 { grid-template-columns:1fr; } }
      .rev { margin:0; }
    `}</style>
  );
}
