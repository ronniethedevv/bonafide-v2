import { describe, expect, it } from "vitest";
import { newOpening, termsCommit, hexToBytes } from "@mmr/engagement-file";
import { buildTerms, clientPayload, formatMicro, toMicro } from "./terms";

const INPUT = {
  loan: "2,000,000",
  depthTarget: "250000.5",
  bandBps: 100,
  minUptime: "90",
  epochs: "30",
  roundtrip: "60",
  outflowCap: "",
  netSellCap: "",
  floorPrice: "1850.25",
  bond: "120000",
};

describe("terms from the wizard", () => {
  it("parses amounts to micro-USDM exactly", () => {
    expect(toMicro("1")).toBe(1_000_000n);
    expect(toMicro("1,234.5")).toBe(1_234_500_000n);
    expect(toMicro("0.000001")).toBe(1n);
    expect(toMicro("1.0000001")).toBeNull();
    expect(toMicro("-1")).toBeNull();
    expect(toMicro("abc")).toBeNull();
  });

  it("maps the form onto protocol terms", () => {
    const { terms, human } = buildTerms(INPUT);
    expect(terms).toEqual({
      floorPriceP: 1_850_250_000n,
      loanL0: 2_000_000_000_000n,
      quoteStartQ0: 0n,
      disposalD: 2_000_000_000_000n, // blank outflow cap = the loan
      netSellS: 0n,
      depthTarget: 250_000_500_000n,
      roundtripSharePpm: 600_000n,
      bandBps: 100,
      minUptimeBuckets: 44, // ceil(0.9 × 48)
      epochsTotal: 30,
    });
    expect(human.outflowCap).toBe("2,000,000");
  });

  it("never lets a percentage round below what was promised", () => {
    expect(buildTerms({ ...INPUT, minUptime: "85" }).terms.minUptimeBuckets).toBe(41); // 40.8 → 41
    expect(buildTerms({ ...INPUT, minUptime: "100" }).terms.minUptimeBuckets).toBe(48);
  });

  it("the client's copy keeps the salts (to check the commitments) but not the engagement secret or private label", async () => {
    const { terms, human } = buildTerms(INPUT);
    const o = await newOpening({
      pool: { chain: "Base", address: "0xd0b53d9277642d899df5c87a3966a349a798f224", pair: "WETH / USDC" },
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
    expect(await termsCommit(terms, hexToBytes(p.secrets.termsSalt))).toBe(p.commitments.termsCommit);
  });

  it("formats micro-USDM back for display", () => {
    expect(formatMicro(2_000_000_000_000n)).toBe("2,000,000");
    expect(formatMicro("1850250000")).toBe("1,850.25");
  });
});
