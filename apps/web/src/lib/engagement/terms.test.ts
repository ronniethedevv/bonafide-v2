import { describe, expect, it } from "vitest";
import { newOpening, termsCommit, hexToBytes } from "@mmr/engagement-file";
import { buildTerms, clientPayload, floorPriceToP, formatUnits, pToPrice, toUnits, type TokenInfo } from "./terms";

const WETH: TokenInfo = { symbol: "WETH", decimals: 18 };
const USDC: TokenInfo = { symbol: "USDC", decimals: 6 };
const DEGEN: TokenInfo = { symbol: "DEGEN", decimals: 18 };
const CBBTC: TokenInfo = { symbol: "cbBTC", decimals: 8 };

const INPUT = {
  pool: "0xd0b53d9277642d899df5c87a3966a349a798f224",
  base: WETH,
  quote: USDC,
  loan: "1,000",
  depthTarget: "250000.5",
  bandBps: 100,
  minUptime: "90",
  epochs: "30",
  roundtrip: "60",
  outflowCap: "",
  netSellCap: "",
  floorPrice: "1850",
  bond: "120000",
};

describe("amount parsing", () => {
  it("converts to raw units at the token's decimals, refusing extra precision", () => {
    expect(toUnits("1,234.5", 6)).toBe(1_234_500_000n);
    expect(toUnits("1", 18)).toBe(10n ** 18n);
    expect(toUnits("0.000001", 6)).toBe(1n);
    expect(toUnits("1.0000001", 6)).toBeNull();
    expect(toUnits("-1", 6)).toBeNull();
    expect(toUnits("abc", 6)).toBeNull();
  });

  it("formats raw units back", () => {
    expect(formatUnits(1_234_500_000n, 6)).toBe("1,234.5");
    expect(formatUnits(10n ** 21n, 18)).toBe("1,000");
  });
});

describe("floor price → the contract's P (raw base per raw quote)", () => {
  it("WETH/USDC at 1,850 USDC per WETH", () => {
    const r = floorPriceToP("1,850", WETH, USDC);
    expect(r).toEqual({ ok: true, p: 540_540_540n }); // floor(10^12 / 1850)
    expect(pToPrice(540_540_540n, WETH, USDC)).toBe("1,850.000001");
  });

  it("DEGEN/WETH at 0.0000025 WETH per DEGEN", () => {
    expect(floorPriceToP("0.0000025", DEGEN, WETH)).toEqual({ ok: true, p: 400_000n });
  });

  it("refuses prices the contract's whole-number P can't express", () => {
    const r = floorPriceToP("95000", CBBTC, USDC); // 10^2 / 95000 < 1
    expect(r.ok).toBe(false);
    expect(floorPriceToP("0", WETH, USDC).ok).toBe(false);
  });
});

describe("terms from the wizard", () => {
  it("puts each term in the unit the contract compares it in", () => {
    const { terms, human } = buildTerms(INPUT);
    expect(terms).toEqual({
      floorPriceP: 540_540_540n,
      loanL0: 1000n * 10n ** 18n, // base token (WETH)
      quoteStartQ0: 0n,
      disposalD: 1000n * 10n ** 18n, // blank outflow cap = the loan, in WETH
      netSellS: 0n,
      depthTarget: 250_000_500_000n, // quote token (USDC), per side
      roundtripSharePpm: 600_000n,
      bandBps: 100,
      minUptimeBuckets: 44, // ceil(0.9 × 48)
      epochsTotal: 30,
      pool: BigInt(INPUT.pool),
    });
    expect(human).toMatchObject({ base: "WETH", quote: "USDC", outflowCap: "1,000" });
  });

  it("I3 with these units: selling at the floor price keeps custody, and rounding favours the client", () => {
    const { terms } = buildTerms(INPUT);
    // Borrowed 1,000 WETH, sold 400 WETH at exactly 1,850 → holds 600 WETH + 740,000 USDC.
    const heldBase = 600n * 10n ** 18n;
    const heldQuote = 740_000n * 10n ** 6n;
    const rhs = terms.loanL0 + terms.quoteStartQ0 * terms.floorPriceP;
    const lhsNoAllowance = heldBase + heldQuote * terms.floorPriceP;
    // Rounding P down values the quote a hair under its true worth, never over...
    expect(lhsNoAllowance).toBeLessThanOrEqual(rhs);
    expect(rhs - lhsNoAllowance).toBeLessThan(rhs / 10n ** 9n); // short by under a billionth of the loan (~0.0000004 WETH)
    // ...and any outflow allowance absorbs it.
    expect(lhsNoAllowance + terms.disposalD).toBeGreaterThanOrEqual(rhs);
    // Selling below the floor fails without an allowance.
    const soldCheap = 600n * 10n ** 18n + 700_000n * 10n ** 6n * terms.floorPriceP;
    expect(soldCheap).toBeLessThan(rhs);
  });

  it("a blank floor price means quote holdings don't count (P = 0)", () => {
    expect(buildTerms({ ...INPUT, floorPrice: "" }).terms.floorPriceP).toBe(0n);
  });

  it("never lets a percentage round below what was promised", () => {
    expect(buildTerms({ ...INPUT, minUptime: "85" }).terms.minUptimeBuckets).toBe(41); // 40.8 → 41
    expect(buildTerms({ ...INPUT, minUptime: "100" }).terms.minUptimeBuckets).toBe(48);
  });

  it("the client's copy keeps the salts (to check the commitments) but not the engagement secret or private label", async () => {
    const { terms, human } = buildTerms(INPUT);
    const o = await newOpening({
      pool: { chain: "Base", address: "0xd0b53d9277642d899df5c87a3966a349a798f224", pair: "WETH / USDC", base: WETH, quote: USDC },
      client: { address: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" },
      label: "secret desk label",
      wallets: ["0x0000000000000000000000000000000000000010"],
      terms,
      human,
    });
    const p = clientPayload(o);
    const json = JSON.stringify(p);
    expect(json).not.toContain(o.secrets.engagementSecret);
    expect(json).not.toContain("secret desk label");
    expect(p.pool.base).toEqual(WETH);
    expect(await termsCommit(terms, hexToBytes(p.secrets.termsSalt))).toBe(p.commitments.termsCommit);
  });
});
