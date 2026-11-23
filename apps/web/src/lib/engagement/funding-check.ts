// Before the client sends the loan: does the engagement on chain match what the client
// accepted, and is the bond actually held? The wallet and terms commitments find the
// engagement (lib/chain/engagement.ts); tier, chain, bond and the beneficiary are public
// arguments of `register` that the commitments do not cover, so they are compared with the
// registration the client accepted (its sealed terms, opened in the browser).

import { normalizeMidnightKey } from "./beneficiary";
import type { ClientTermsPayload } from "./terms";

/** The on-chain fields the check reads (a subset of the chain reader's EngagementState). */
export interface OnChainEngagement {
  id: string;
  status: string;
  tier: number;
  chain: number;
  bondRequired: string;
  bondPosted?: string;
  beneficiary: string;
  startDate?: string;
  fundingProven: boolean;
  slashed: boolean;
}

export interface FundingCheckItem {
  label: string;
  ok: boolean;
  detail: string;
}

export interface FundingCheck {
  /** Every gating item passed: the loan can be sent. */
  safe: boolean;
  items: FundingCheckItem[];
  /** After funding: whether the market maker has proven the loan reached its wallets. */
  fundingProven: boolean;
}

const TIER = ["", "A", "B", "C"];
const big = (v: string | number | undefined): bigint | null => {
  try {
    return v === undefined ? null : BigInt(String(v).replace(/,/g, "").trim());
  } catch {
    return null;
  }
};
const fmt = (v: bigint | null) => (v === null ? "?" : v.toLocaleString("en-US"));

export function fundingCheck(
  accepted: ClientTermsPayload["registration"] | undefined,
  clientKey: string | null,
  onChain: OnChainEngagement | null,
): FundingCheck {
  if (!onChain) {
    return {
      safe: false,
      fundingProven: false,
      items: [{
        label: "Registered on Midnight with the terms you accepted",
        ok: false,
        detail: "No engagement on the contract has the wallet and terms commitments you accepted. Don't send the loan yet.",
      }],
    };
  }
  const items: FundingCheckItem[] = [{
    label: "Registered on Midnight with the terms you accepted",
    ok: true,
    detail: "The wallet and terms commitments on chain are the ones you accepted.",
  }];

  const mine = normalizeMidnightKey(clientKey);
  const named = normalizeMidnightKey(onChain.beneficiary);
  items.push({
    label: "On a default, the bond goes to your Midnight key",
    ok: mine !== null && named === mine,
    detail: mine === null ? "Save your Midnight key first." : named === mine ? "The beneficiary on chain is your key." : "The beneficiary on chain is a different key.",
  });

  const want = { tier: accepted?.tier, chain: accepted?.chainId, bond: big(accepted?.bond) };
  const required = big(onChain.bondRequired);
  const agreed = accepted !== undefined && want.tier === onChain.tier && want.chain === onChain.chain && want.bond !== null && want.bond === required;
  items.push({
    label: "Tier, chain and bond as agreed",
    ok: agreed,
    detail: accepted === undefined
      ? "Your accepted terms do not state the registration (tier, chain, bond)."
      : `On chain: tier ${TIER[onChain.tier] ?? onChain.tier}, chain ${onChain.chain}, bond ${fmt(required)}. Agreed: tier ${TIER[want.tier ?? 0] ?? want.tier}, chain ${want.chain}, bond ${fmt(want.bond)}.`,
  });

  const posted = big(onChain.bondPosted);
  items.push({
    label: "The bond is held by the contract",
    ok: posted !== null && required !== null && posted >= required && !onChain.slashed,
    detail: posted === null ? "No bond has been posted." : `${fmt(posted)} posted, ${fmt(required)} required.`,
  });

  items.push({
    label: "The market maker has started the clock",
    ok: onChain.status === "Running" && onChain.startDate !== undefined,
    detail: onChain.startDate ? `Day 1 is ${onChain.startDate} (UTC).` : `Status: ${onChain.status}.`,
  });

  return { safe: items.every((i) => i.ok), items, fundingProven: onChain.fundingProven };
}
