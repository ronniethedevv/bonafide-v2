"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  acceptanceMessage,
  contexts,
  isEpochFigures,
  type EpochFigures,
  hexToBytes,
  open,
  termsCommit,
  termsFromJson,
  walletCommit,
  type SealedEnvelope,
} from "@mmr/engagement-file";
import type { Registration } from "@/lib/db/store";
import { RegistrationCard } from "@/components/registrations";
import { unlockInbox } from "@/lib/wallet/inbox";
import { signMessage, walletErrorText } from "@/lib/wallet/browser";
import { BUCKETS_PER_EPOCH, formatUnits, pToPrice, toUnits, type ClientTermsPayload, type TokenInfo } from "@/lib/engagement/terms";
import { checkBeneficiary, type BeneficiaryCheck } from "@/lib/engagement/beneficiary";
import { fundingCheck, type FundingCheck, type OnChainEngagement } from "@/lib/engagement/funding-check";
import { Check, Info } from "@/components/icons";
import { shortAddress } from "@/lib/auth/shared";

// The client's registered engagements. A proposal must be opened (decrypted in this
// browser with the client's inbox key), checked against the two commitments on record,
// and only then accepted (signed by the client's wallet) or declined.
export function ClientRegistrations({ items, address, inboxKey, midnightKey }: {
  items: Registration[]; address: string; inboxKey: string | null; midnightKey: string | null;
}) {
  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 12 }}>
      {items.map((r) => (
        <RegistrationCard key={r.id} r={r} viewer="client">
          {r.status === "proposed" && r.walletCommit && r.termsCommit ? (
            <Proposal r={r} address={address} inboxKey={inboxKey} midnightKey={midnightKey} />
          ) : r.status === "accepted" || r.status === "active" ? (
            <>
              <BeforeFunding r={r} address={address} inboxKey={inboxKey} midnightKey={midnightKey} />
              <DailyFigures r={r} address={address} inboxKey={inboxKey} />
            </>
          ) : undefined}
        </RegistrationCard>
      ))}
    </div>
  );
}

type Checked = { payload: ClientTermsPayload; matches: boolean };

function Proposal({ r, address, inboxKey, midnightKey }: { r: Registration; address: string; inboxKey: string | null; midnightKey: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "opening" | "accepting" | "declining">("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wc = r.walletCommit!;
  const tc = r.termsCommit!;

  async function openTerms() {
    setBusy("opening");
    setError(null);
    try {
      if (!inboxKey) throw new Error("Set up your private inbox first.");
      const key = await unlockInbox(address, inboxKey);
      const res = await fetch(`/api/engagements/${encodeURIComponent(r.id)}`, { cache: "no-store" });
      const body = (await res.json()) as { termsEnvelope?: SealedEnvelope | null; error?: string };
      if (!res.ok || !body.termsEnvelope) throw new Error(body.error ?? "The terms aren't available.");
      const payload = JSON.parse(await open(body.termsEnvelope, key.privateKey, contexts.terms(wc, tc))) as ClientTermsPayload;
      // Recompute both commitments from what we were sent: the MM can't show us one set
      // of terms and commit to another.
      const wc2 = await walletCommit(payload.wallets, hexToBytes(payload.secrets.walletSalt, 32));
      const tc2 = await termsCommit(termsFromJson(payload.terms), hexToBytes(payload.secrets.termsSalt, 32));
      setChecked({ payload, matches: wc2 === wc && tc2 === tc });
    } catch (e) {
      setError(walletErrorText(e));
    }
    setBusy("");
  }

  async function respond(decision: "accept" | "decline") {
    setBusy(decision === "accept" ? "accepting" : "declining");
    setError(null);
    try {
      const signature = decision === "accept" ? await signMessage(address, acceptanceMessage({ registrationId: r.id, walletCommit: wc, termsCommit: tc })) : undefined;
      const res = await fetch(`/api/engagements/${encodeURIComponent(r.id)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, ...(signature ? { signature } : {}) }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Couldn't save your answer.");
      router.refresh();
    } catch (e) {
      setError(walletErrorText(e));
      setBusy("");
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      {!checked ? (
        <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={openTerms} disabled={!!busy || !inboxKey}>
            {busy === "opening" ? "Check your wallet…" : "Open the terms"}
          </button>
          <span className="dim" style={{ fontSize: 12.5 }}>
            {inboxKey ? "Decrypted here in your browser with your inbox key." : "Set up your private inbox above to read the terms."}
          </span>
        </div>
      ) : (
        <TermsView payload={checked.payload} matches={checked.matches} beneficiary={checkBeneficiary(checked.payload, midnightKey)} />
      )}

      {checked && (
        <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={!checked.matches || !checkBeneficiary(checked.payload, midnightKey).ok || !!busy} onClick={() => respond("accept")}>
            {busy === "accepting" ? "Sign in your wallet…" : "Accept and sign"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => respond("decline")}>
            {busy === "declining" ? "Declining…" : "Decline"}
          </button>
        </div>
      )}
      {error && <div role="alert" className="field-err">{error}</div>}
    </div>
  );
}

function bondText(raw: string | undefined): string {
  const m = raw ? toUnits(raw, 6) : null;
  return m !== null ? formatUnits(m, 6) : (raw ?? "?");
}

// Files from before token units were recorded fall back to 6-decimal "units".
const UNKNOWN: TokenInfo = { symbol: "units", decimals: 6 };

const TIER_NAME: Record<number, string> = { 1: "A", 2: "B", 3: "C" };

function TermsView({ payload, matches, beneficiary }: { payload: ClientTermsPayload; matches: boolean; beneficiary: BeneficiaryCheck }) {
  const reg = payload.registration;
  const t = payload.terms;
  const base = payload.pool.base ?? UNKNOWN;
  const quote = payload.pool.quote ?? UNKNOWN;
  const p = BigInt(t.floorPriceP);
  const rows: Array<[string, string]> = [
    ["Pool", `${payload.pool.pair} on ${payload.pool.chain} · ${shortAddress(payload.pool.address)}`],
    ["Depth target", `${formatUnits(t.depthTarget, quote.decimals)} ${quote.symbol} per side within ±${t.bandBps} bps`],
    ["Min uptime", `${t.minUptimeBuckets} of ${BUCKETS_PER_EPOCH} half-hours per epoch (${payload.human.minUptimePct ?? "?"}%)`],
    ["Contract length", `${t.epochsTotal} epochs`],
    ["Loan", `${formatUnits(t.loanL0, base.decimals)} ${base.symbol}`],
    ["Round-trip cap", `${Number(t.roundtripSharePpm) / 10_000}% of volume`],
    ["Outflow cap", `${formatUnits(t.disposalD, base.decimals)} ${base.symbol}`],
    ["Net-selling cap", `${formatUnits(t.netSellS, base.decimals)} ${base.symbol}`],
    ["Floor price", p === 0n ? "not set (sold tokens don't count as held)" : `≈ ${pToPrice(p, base, quote)} ${quote.symbol} per ${base.symbol}`],
    ...(reg
      ? ([
          ["Tier · bond (public)", `${TIER_NAME[reg.tier] ?? reg.tier} · ${Number(reg.bond).toLocaleString("en-US")}`],
          ["Bond goes to, on default (public)", reg.beneficiary],
        ] as Array<[string, string]>)
      : ([["Bond", `${bondText(payload.human.bond)} USDM`]] as Array<[string, string]>)),
    ["Quoting wallets", payload.wallets.map(shortAddress).join(", ")],
  ];
  return (
    <div className="terms-view">
      <div className={`verify-line${matches ? " is-ok" : " is-bad"}`} role="status">
        {matches ? <Check size={14} /> : <Info size={14} />}
        <span>
          {matches
            ? "These terms match the commitments on record. This is exactly what the market maker committed to."
            : "These terms do NOT match the commitments on record. Don't accept; contact the market maker."}
        </span>
      </div>
      <div className={`verify-line${beneficiary.ok ? " is-ok" : " is-bad"}`} role="status" style={{ marginTop: 6 }}>
        {beneficiary.ok ? <Check size={14} /> : <Info size={14} />}
        <span>{beneficiary.ok ? "The bond names your Midnight key: on a default it is paid to you." : beneficiary.reason}</span>
      </div>
      <dl className="rev" style={{ marginTop: 10 }}>
        {rows.map(([k, v]) => (
          <div key={k} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", gap: 16 }}>
            <dt className="dim" style={{ fontSize: 13 }}>{k}</dt>
            <dd className="mono" style={{ fontSize: 12.5, color: "var(--text)", textAlign: "right", margin: 0, wordBreak: "break-word" }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Before sending the loan: find the engagement on Midnight by the commitments this client
// accepted, open the accepted terms here (they state the registration's tier, chain, bond
// and beneficiary, which the commitments don't cover) and compare. Nothing is taken from
// the market maker's word.
function BeforeFunding({ r, address, inboxKey, midnightKey }: { r: Registration; address: string; inboxKey: string | null; midnightKey: string | null }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ check: FundingCheck; id: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (!inboxKey) throw new Error("Set up your private inbox first.");
      const wc = r.walletCommit!;
      const tc = r.termsCommit!;
      const key = await unlockInbox(address, inboxKey);
      const res = await fetch(`/api/engagements/${encodeURIComponent(r.id)}`, { cache: "no-store" });
      const body = (await res.json()) as { termsEnvelope?: SealedEnvelope | null; error?: string };
      if (!res.ok || !body.termsEnvelope) throw new Error(body.error ?? "The terms aren't available.");
      const payload = JSON.parse(await open(body.termsEnvelope, key.privateKey, contexts.terms(wc, tc))) as ClientTermsPayload;
      const same = (await walletCommit(payload.wallets, hexToBytes(payload.secrets.walletSalt, 32))) === wc
        && (await termsCommit(termsFromJson(payload.terms), hexToBytes(payload.secrets.termsSalt, 32))) === tc;
      if (!same) throw new Error("The terms you hold no longer match the commitments on record.");
      const chainRes = await fetch(`/api/engagements/${encodeURIComponent(r.id)}/onchain`, { cache: "no-store" });
      const chainBody = (await chainRes.json()) as { engagement?: OnChainEngagement | null; error?: string };
      if (!chainRes.ok) throw new Error(chainBody.error ?? "Couldn't read the contract.");
      const onChain = chainBody.engagement ?? null;
      setResult({ check: fundingCheck(payload.registration, midnightKey, onChain), id: onChain?.id ?? null });
    } catch (e) {
      setError(walletErrorText(e));
    }
    setBusy(false);
  }

  if (!r.walletCommit || !r.termsCommit) return null;
  return (
    <div className="card" style={{ marginTop: 14, padding: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Before you send the loan</div>
      {!result ? (
        <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={run} disabled={busy || !inboxKey}>
            {busy ? "Checking…" : "Check on Midnight"}
          </button>
          <span className="dim" style={{ fontSize: 12.5 }}>
            Compares the engagement on chain with the terms you accepted: the bond, its beneficiary and the clock.
          </span>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <div role="status" style={{ fontSize: 13.5, fontWeight: 600, color: result.check.safe ? "var(--pos)" : "var(--neg)" }}>
            {result.check.safe
              ? result.check.fundingProven
                ? "Safe, and funded: the market maker has proven the loan reached its wallets."
                : "Safe to fund: the engagement on chain is the one you accepted, and the bond is held."
              : "Don't send the loan yet."}
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
            {result.check.items.map((i) => (
              <li key={i.label} style={{ fontSize: 13, marginTop: 6 }}>
                <span style={{ color: i.ok ? "var(--pos)" : "var(--neg)", fontWeight: 600 }}>{i.ok ? "ok" : "no"}</span>{" "}
                {i.label}
                <div className="dim" style={{ fontSize: 12, marginLeft: 22 }}>{i.detail}</div>
              </li>
            ))}
          </ul>
          {result.id && (
            <a href={`/engagement/${result.id}`} style={{ display: "inline-block", fontSize: 12.5, marginTop: 10 }}>
              Follow it on Midnight
            </a>
          )}
        </div>
      )}
      {error && <div role="alert" className="field-err">{error}</div>}
    </div>
  );
}

// Each epoch's figures arrive sealed to this client's inbox key; they're opened here, in
// the browser. The server only ever relays ciphertext.
function DailyFigures({ r, address, inboxKey }: { r: Registration; address: string; inboxKey: string | null }) {
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<EpochFigures[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      if (!inboxKey) throw new Error("Set up your private inbox first.");
      const key = await unlockInbox(address, inboxKey);
      const res = await fetch(`/api/engagements/${encodeURIComponent(r.id)}/messages`, { cache: "no-store" });
      const body = (await res.json()) as { messages?: Array<{ epoch: number; envelope: SealedEnvelope }>; error?: string };
      if (!res.ok || !body.messages) throw new Error(body.error ?? "Couldn't load the figures.");
      const out: EpochFigures[] = [];
      for (const m of body.messages) {
        const f: unknown = JSON.parse(await open(m.envelope, key.privateKey, contexts.epoch(r.id, m.epoch)));
        // The envelope is bound to its epoch; the contents must say the same.
        if (isEpochFigures(f) && f.epoch === m.epoch) out.push(f);
      }
      setRows(out.sort((a, b) => b.epoch - a.epoch));
    } catch (e) {
      setError(walletErrorText(e));
    }
    setBusy(false);
  }

  if (!rows) {
    return (
      <div style={{ marginTop: 14 }}>
        <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={load} disabled={busy || !inboxKey}>
            {busy ? "Check your wallet…" : "Open daily figures"}
          </button>
          <span className="dim" style={{ fontSize: 12.5 }}>
            {r.lastEpoch ? `${r.lastEpoch} epoch${r.lastEpoch > 1 ? "s" : ""} reported so far.` : "No epochs reported yet."} Decrypted here with your inbox key.
          </span>
        </div>
        {error && <div role="alert" className="field-err">{error}</div>}
      </div>
    );
  }
  if (rows.length === 0) return <p className="dim" style={{ fontSize: 13, marginTop: 14 }}>No figures shared yet.</p>;
  const ok = (v: boolean) => <span style={{ color: v ? "var(--pos)" : "var(--neg)" }}>{v ? "ok" : "no"}</span>;
  return (
    <div className="scroll-x" style={{ marginTop: 14 }}>
      <table className="figures-table">
        <thead>
          <tr>
            <th>Epoch</th>
            <th>Day (UTC)</th>
            <th>Depth at target</th>
            <th>Round-trips</th>
            <th>Custody</th>
            <th>Net selling</th>
            <th>Outflow</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.epoch}>
              <td className="mono">{f.epoch}</td>
              <td className="mono dim">{new Date(f.range.startTs * 1000).toISOString().slice(0, 10)}</td>
              <td className="mono" style={{ color: f.checks.uptime ? "var(--pos)" : "var(--neg)" }}>{f.bucketsAtTarget}/{f.totalBuckets}</td>
              <td className="mono" style={{ color: f.checks.roundTrip ? "var(--pos)" : "var(--neg)" }}>{f.roundTripPct}%</td>
              <td className="mono">{ok(f.checks.custody)}</td>
              <td className="mono">{ok(f.checks.netSelling)}</td>
              <td className="mono">{ok(f.checks.outflow)}</td>
              <td>
                <span className="pill" style={{ fontSize: 11, borderColor: "transparent", background: f.met ? "color-mix(in srgb, var(--pos) 16%, transparent)" : "color-mix(in srgb, var(--neg) 16%, transparent)", color: f.met ? "var(--pos)" : "var(--neg)" }}>
                  {f.met ? "met" : "missed"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
