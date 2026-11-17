// Turn what a market maker types (dollar amounts, percentages) into the protocol's exact
// integer terms (packages/prover EngagementTerms / the contract's `Terms` struct).
//
// Units: amounts are USDM with 6 decimals ("micro-USDM"), matching the quote token. A
// percentage of buckets becomes a bucket count out of the 48 half-hour buckets in a 24h
// epoch (DEFAULT_CONFIG), rounded up so "90%" never means less than 90%.

import type { EngagementOpening, Terms } from "@mmr/engagement-file";

export const BUCKETS_PER_EPOCH = 48;
const AMOUNT_RE = /^\d{1,18}(\.\d{1,6})?$/;

/** "1234.5" → 1_234_500_000n (micro-USDM). null when not a valid amount. */
export function toMicro(s: string): bigint | null {
  const v = s.trim().replace(/,/g, "");
  if (!AMOUNT_RE.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
}

export interface TermsInput {
  loan: string;
  depthTarget: string;
  bandBps: number;
  minUptime: string; // % of buckets
  epochs: string;
  roundtrip: string; // % of volume
  outflowCap: string; // blank = same as loan
  netSellCap: string; // blank = 0
  floorPrice: string; // blank = 0
  bond: string;
}

export function buildTerms(i: TermsInput): { terms: Terms; human: Record<string, string> } {
  const loan = toMicro(i.loan);
  const depth = toMicro(i.depthTarget);
  if (loan === null || depth === null) throw new Error("loan and depth target must be amounts");
  const disposal = i.outflowCap.trim() ? toMicro(i.outflowCap) : loan;
  const netSell = i.netSellCap.trim() ? toMicro(i.netSellCap) : 0n;
  const floor = i.floorPrice.trim() ? toMicro(i.floorPrice) : 0n;
  if (disposal === null || netSell === null || floor === null) throw new Error("caps and floor price must be amounts");
  const uptimePct = Number(i.minUptime);
  const rtPct = Number(i.roundtrip);
  const terms: Terms = {
    floorPriceP: floor,
    loanL0: loan,
    quoteStartQ0: 0n,
    disposalD: disposal,
    netSellS: netSell,
    depthTarget: depth,
    roundtripSharePpm: BigInt(Math.round(rtPct * 10_000)),
    bandBps: i.bandBps,
    minUptimeBuckets: Math.ceil((uptimePct / 100) * BUCKETS_PER_EPOCH),
    epochsTotal: Number(i.epochs),
  };
  const human: Record<string, string> = {
    units: "USDM, 6 decimals",
    loan: i.loan.trim(),
    depthTarget: i.depthTarget.trim(),
    minUptimePct: i.minUptime.trim(),
    roundtripPct: i.roundtrip.trim(),
    outflowCap: i.outflowCap.trim() || i.loan.trim(),
    netSellCap: i.netSellCap.trim() || "0",
    floorPrice: i.floorPrice.trim() || "0",
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

export function formatMicro(v: string | bigint): string {
  const n = typeof v === "bigint" ? v : BigInt(v);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  const w = whole.toLocaleString("en-US");
  return frac === 0n ? w : `${w}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}
