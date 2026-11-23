import { describe, expect, it } from "vitest";
import { checkBeneficiary, normalizeMidnightKey } from "./beneficiary";

const MINE = "ab".repeat(32);
const reg = (beneficiary: string) => ({ registration: { tier: 1, chainId: 8453, bond: "10000", beneficiary } });

describe("the bond's beneficiary", () => {
  it("normalizes a Midnight coin key and refuses malformed or zero keys", () => {
    expect(normalizeMidnightKey(`0x${MINE.toUpperCase()}`)).toBe(MINE);
    expect(normalizeMidnightKey("ab".repeat(31))).toBeNull();
    expect(normalizeMidnightKey("00".repeat(32))).toBeNull();
    expect(normalizeMidnightKey(42)).toBeNull();
  });

  it("accepts only a registration that names the client's own key", () => {
    expect(checkBeneficiary(reg(MINE), MINE)).toEqual({ ok: true });
    expect(checkBeneficiary(reg(`0x${MINE.toUpperCase()}`), MINE)).toEqual({ ok: true });
    expect(checkBeneficiary(reg("cd".repeat(32)), MINE)).toMatchObject({ ok: false, reason: expect.stringMatching(/different Midnight key/) });
  });

  it("refuses when the client has no key saved or the proposal states no registration", () => {
    expect(checkBeneficiary(reg(MINE), null)).toMatchObject({ ok: false, reason: expect.stringMatching(/Save your Midnight key/) });
    expect(checkBeneficiary({}, MINE)).toMatchObject({ ok: false, reason: expect.stringMatching(/does not state its on-chain registration/) });
  });
});
