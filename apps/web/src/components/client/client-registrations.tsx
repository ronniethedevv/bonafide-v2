"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  acceptanceMessage,
  contexts,
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
import { Check, Info } from "@/components/icons";
import { shortAddress } from "@/lib/auth/shared";

// The client's registered engagements. A proposal must be opened (decrypted in this
// browser with the client's inbox key), checked against the two commitments on record,
// and only then accepted (signed by the client's wallet) or declined.
export function ClientRegistrations({ items, address, inboxKey }: { items: Registration[]; address: string; inboxKey: string | null }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 12 }}>
      {items.map((r) => (
        <RegistrationCard key={r.id} r={r} viewer="client">
          {r.status === "proposed" && r.walletCommit && r.termsCommit ? (
            <Proposal r={r} address={address} inboxKey={inboxKey} />
          ) : undefined}
        </RegistrationCard>
      ))}
    </div>
  );
}

type Checked = { payload: ClientTermsPayload; matches: boolean };

function Proposal({ r, address, inboxKey }: { r: Registration; address: string; inboxKey: string | null }) {
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
        <TermsView payload={checked.payload} matches={checked.matches} />
      )}

      {checked && (
        <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={!checked.matches || !!busy} onClick={() => respond("accept")}>
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

function TermsView({ payload, matches }: { payload: ClientTermsPayload; matches: boolean }) {
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
    ["Bond", `${bondText(payload.human.bond)} USDM`],
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
