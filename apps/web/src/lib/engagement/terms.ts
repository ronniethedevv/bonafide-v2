// Turn what a market maker types into the protocol's exact integer terms, in the units
// the contract's checks compare them in (packages/contracts/src/epoch_proof.compact):
//
//   I3 custody:  Σ(base_end + lp_base) + Σ(quote_end + lp_quote)·P + D  ≥  L0 + Q0·P
//   I4 net sell: Σ swap_base_out ≤ Σ swap_base_in + S
//   I5 outflow:  Σ xfer_out + Σ from_treasury ≤ Σ xfer_in + D        (cumulative too)
//   I6 uptime:   per bucket, Σ min-depth (both sides) ≥ depth_target  (quote-denominated, DD-23)
//   DD-27:       Σ from_treasury ≥ L0                                 (the loan landed)
//
// So, with base = the client's token and quote = the token it trades against, all in
// raw on-chain units (amount × 10^decimals):
//   loan L0, outflow cap D, net-selling cap S  → base token
//   depth target, starting quote Q0            → quote token
//   P converts raw quote into raw base:  P = 10^(baseDec − quoteDec) / price, where price
//   is "quote per base" as a person writes it (e.g. 1,850 USDC per WETH). P is an
//   integer, rounded DOWN: held quote counts slightly less, never more (the client's way).
// A percentage of buckets becomes a bucket count out of the 48 half-hours in a 24h epoch,
// rounded up so "90%" never means less than 90%. The bond is posted in USDM.

import type { EngagementOpening, Terms, TokenInfo } from "@mmr/engagement-file";

export type { TokenInfo };
export const BUCKETS_PER_EPOCH = 48;
const U64 = 1n << 64n;

function parseDecimal(s: string): { digits: bigint; scale: number } | null {
  const v = s.trim().replace(/,/g, "");
  const m = /^(\d{1,30})(?:\.(\d{1,30}))?$/.exec(v);
  if (!m) return null;
  const frac = m[2] ?? "";
  return { digits: BigInt(m[1]! + frac), scale: frac.length };
}

/** "1,234.5" with 6 decimals → 1_234_500_000n. null if malformed or too precise. */
export function toUnits(s: string, decimals: number): bigint | null {
  const d = parseDecimal(s);
  if (!d || d.scale > decimals) return null;
  return d.digits * 10n ** BigInt(decimals - d.scale);
}

export function formatUnits(v: string | bigint, decimals: number): string {
  const n = typeof v === "bigint" ? v : BigInt(v);
  const base = 10n ** BigInt(decimals);
  const whole = (n / base).toLocaleString("en-US");
  const frac = decimals ? (n % base).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return frac ? `${whole}.${frac}` : whole;
}

/** Floor price "quote per base" → the contract's P (raw base per raw quote), rounded down. */
export function floorPriceToP(price: string, base: TokenInfo, quote: TokenInfo): { ok: true; p: bigint } | { ok: false; error: string } {
  const d = parseDecimal(price);
  if (!d || d.digits === 0n) return { ok: false, error: "Enter a price above zero." };
  // price = digits / 10^scale ⇒ P = 10^(bd − qd) · 10^scale / digits
  const shift = base.decimals - quote.decimals;
  const num = 10n ** BigInt(Math.max(shift, 0) + d.scale);
  const den = d.digits * 10n ** BigInt(Math.max(-shift, 0));
  const p = num / den;
  if (p === 0n) {
    return {
      ok: false,
      error: `At this price one smallest unit of ${quote.symbol} is worth less than one of ${base.symbol}, which the contract's whole-number floor price can't express. Leave it blank (quote holdings then don't count toward custody).`,
    };
  }
  if (p >= U64) return { ok: false, error: "That price is too small for the contract to express." };
  return { ok: true, p };
}

/** P back to "quote per base" for display (approximate; P is rounded down). */
export function pToPrice(p: bigint, base: TokenInfo, quote: TokenInfo): string {
  if (p === 0n) return "";
  // price = 10^(bd − qd) / P, shown with 6 significant fraction digits
  const SCALE = 6;
  const shift = base.decimals - quote.decimals;
  const num = 10n ** BigInt(Math.max(shift, 0) + SCALE);
  const den = p * 10n ** BigInt(Math.max(-shift, 0));
  return formatUnits(num / den, SCALE);
}

export interface TermsInput {
  base: TokenInfo;
  quote: TokenInfo;
  loan: string; // base
  depthTarget: string; // quote, per side
  bandBps: number;
  minUptime: string; // % of buckets
  epochs: string;
  roundtrip: string; // % of volume
  outflowCap: string; // base; blank = same as loan
  netSellCap: string; // base; blank = 0
  floorPrice: string; // quote per base; blank = quote holdings don't count (P = 0)
  bond: string; // USDM
}

export function buildTerms(i: TermsInput): { terms: Terms; human: Record<string, string> } {
  const loan = toUnits(i.loan, i.base.decimals);
  const depth = toUnits(i.depthTarget, i.quote.decimals);
  if (loan === null || depth === null) throw new Error("loan and depth target must be amounts");
  const disposal = i.outflowCap.trim() ? toUnits(i.outflowCap, i.base.decimals) : loan;
  const netSell = i.netSellCap.trim() ? toUnits(i.netSellCap, i.base.decimals) : 0n;
  if (disposal === null || netSell === null) throw new Error("caps must be amounts");
  let floorP = 0n;
  if (i.floorPrice.trim()) {
    const r = floorPriceToP(i.floorPrice, i.base, i.quote);
    if (!r.ok) throw new Error(r.error);
    floorP = r.p;
  }
  const terms: Terms = {
    floorPriceP: floorP,
    loanL0: loan,
    quoteStartQ0: 0n,
    disposalD: disposal,
    netSellS: netSell,
    depthTarget: depth,
    roundtripSharePpm: BigInt(Math.round(Number(i.roundtrip) * 10_000)),
    bandBps: i.bandBps,
    minUptimeBuckets: Math.ceil((Number(i.minUptime) / 100) * BUCKETS_PER_EPOCH),
    epochsTotal: Number(i.epochs),
  };
  const human: Record<string, string> = {
    base: i.base.symbol,
    quote: i.quote.symbol,
    loan: i.loan.trim(),
    depthTarget: i.depthTarget.trim(),
    minUptimePct: i.minUptime.trim(),
    roundtripPct: i.roundtrip.trim(),
    outflowCap: i.outflowCap.trim() || i.loan.trim(),
    netSellCap: i.netSellCap.trim() || "0",
    floorPrice: i.floorPrice.trim(),
    bond: i.bond.trim(),
  };
  return { terms, human };
}

/**
 * What the client receives, sealed to their inbox: everything needed to check the
 * commitments, minus what only the MM should hold — the engagement secret (it controls
 * the on-chain engagement id) and the MM's private label.
 */
export type ClientTermsPayload = Omit<EngagementOpening, "label" | "secrets"> & {
  secrets: Pick<EngagementOpening["secrets"], "walletSalt" | "termsSalt">;
};

export function clientPayload(o: EngagementOpening): ClientTermsPayload {
  const { label: _label, secrets, ...rest } = o;
  return { ...rest, secrets: { walletSalt: secrets.walletSalt, termsSalt: secrets.termsSalt } };
}
