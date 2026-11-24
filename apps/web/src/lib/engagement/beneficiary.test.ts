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

  // Encoded with Midnight's wallet SDK (wallet-sdk-address-format 4.0.1) from this coin key.
  const COIN = "f79a27d94dc75eb3d3003524c0d118f1df56299dee42109e773cb5af13796133";
  const PREVIEW = "mn_shield-addr_preview177dz0k2dca0t85cqx5jvp5gc7804v2vaaeppp8nh8j667ymevyeswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpcpaexyn";
  const MAINNET = "mn_shield-addr177dz0k2dca0t85cqx5jvp5gc7804v2vaaeppp8nh8j667ymevyeswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpcn7wuqe";

  it("takes the coin key out of a shielded address, as a wallet shows it", () => {
    expect(normalizeMidnightKey(PREVIEW)).toBe(COIN);
    expect(normalizeMidnightKey(` ${MAINNET} `)).toBe(COIN);
  });

  it("refuses an unshielded address and a damaged shielded one", () => {
    expect(normalizeMidnightKey("mn_addr_preview1pyysjzgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfpyys5adj9d")).toBeNull();
    expect(normalizeMidnightKey(PREVIEW.slice(0, -1) + "q")).toBeNull();
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
