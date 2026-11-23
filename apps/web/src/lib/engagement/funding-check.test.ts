import { describe, expect, it } from "vitest";
import { fundingCheck, type OnChainEngagement } from "./funding-check";

const KEY = "f7".repeat(32);
const ACCEPTED = { tier: 1, chainId: 8453, bond: "10000", beneficiary: KEY };
const ON_CHAIN: OnChainEngagement = {
  id: "7e".repeat(32), status: "Running", tier: 1, chain: 8453, bondRequired: "10000", bondPosted: "10000",
  beneficiary: KEY, startDate: "2026-11-24", fundingProven: false, slashed: false,
};

describe("the client's check before sending the loan", () => {
  it("is safe when the engagement on chain is the one accepted, bonded and running", () => {
    const c = fundingCheck(ACCEPTED, KEY, ON_CHAIN);
    expect(c.safe).toBe(true);
    expect(c.items.map((i) => i.ok)).toEqual([true, true, true, true, true]);
    expect(c.fundingProven).toBe(false);
  });

  it("is not safe when no engagement has the accepted commitments", () => {
    const c = fundingCheck(ACCEPTED, KEY, null);
    expect(c.safe).toBe(false);
    expect(c.items[0]!.ok).toBe(false);
  });

  it("catches a bond that goes elsewhere, a smaller bond, another tier or chain", () => {
    expect(fundingCheck(ACCEPTED, KEY, { ...ON_CHAIN, beneficiary: "ab".repeat(32) }).safe).toBe(false);
    expect(fundingCheck(ACCEPTED, KEY, { ...ON_CHAIN, bondRequired: "2500", bondPosted: "2500" }).safe).toBe(false);
    expect(fundingCheck(ACCEPTED, KEY, { ...ON_CHAIN, tier: 3 }).safe).toBe(false);
    expect(fundingCheck(ACCEPTED, KEY, { ...ON_CHAIN, chain: 1 }).safe).toBe(false);
    expect(fundingCheck(undefined, KEY, ON_CHAIN).safe).toBe(false);
  });

  it("waits for the bond and the clock", () => {
    const { bondPosted: _b, startDate: _d, ...unbonded } = ON_CHAIN;
    expect(fundingCheck(ACCEPTED, KEY, { ...unbonded, status: "Registered" }).items.map((i) => i.ok)).toEqual([true, true, true, false, false]);
    expect(fundingCheck(ACCEPTED, KEY, { ...ON_CHAIN, slashed: true }).safe).toBe(false);
  });

  it("needs the client's own key saved", () => {
    expect(fundingCheck(ACCEPTED, null, ON_CHAIN).items[1]!.ok).toBe(false);
  });
});
