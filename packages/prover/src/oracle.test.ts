import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIG,
  bucketsPerEpoch,
  type AddressActivity,
  type DepthBucketSample,
  type EpochRange,
} from "@mmr/indexer";
import { createEngagement, type EngagementTerms } from "./engagement.js";
import { evaluateEpoch } from "./oracle.js";

const config = DEFAULT_CONFIG;
const range: EpochRange = {
  epoch: 1,
  startBlock: 900_000,
  endBlock: 1_000_000,
  endBlockHash: "0x00",
  startTs: 1_000_000,
  endTs: 1_086_400,
};

function fullDepth(minBid: bigint, minAsk: bigint): DepthBucketSample[] {
  const n = bucketsPerEpoch(config);
  const out: DepthBucketSample[] = [];
  for (let b = 0; b < n; b++) {
    out.push({
      bucket: b,
      perBand: config.bandsBps.map((bandBps) => ({ bandBps, minBid, minAsk })),
    });
  }
  return out;
}

function goodActivity(addr: bigint, over: Partial<AddressActivity> = {}): AddressActivity {
  return {
    addr,
    isProtocol: false,
    baseStart: 1000n,
    baseEnd: 800n,
    quoteEnd: 0n,
    lpBase: 300n,
    lpQuote: 0n,
    // from_treasury (the loan) is a subset of xfer_in, so a compliant MM whose
    // only inflow is the 1000 loan has xfer_in == from_treasury (I5).
    xferIn: 1000n,
    xferOut: 0n,
    fromTreasury: 1000n,
    swapBaseIn: 50n,
    swapBaseOut: 50n,
    swapQuoteIn: 0n,
    swapQuoteOut: 0n,
    depthBuckets: fullDepth(100n, 100n),
    flowWindows: [{ window: 0, buy: 50n, sell: 50n }],
    lpFirstActiveBlock: range.endBlock - 1000, // aged, not JIT
    ...over,
  };
}

const terms: EngagementTerms = {
  floorPriceP: 1n,
  loanL0: 1000n,
  quoteStartQ0: 0n,
  disposalD: 0n,
  netSellS: 0n,
  depthTarget: 100n,
  roundtripSharePpm: 600_000n, // 60%
  bandBps: 100,
};

function engWith(wallets: bigint[]) {
  return createEngagement({
    id: "e",
    poolAddr: 0xabcdn,
    wallets,
    salt: new Uint8Array(32).fill(1),
    terms,
  });
}

describe("evaluateEpoch — reference oracle", () => {
  it("passes a compliant MM on all invariants", () => {
    const acts = new Map([[0x10n, goodActivity(0x10n)]]);
    const v = evaluateEpoch(engWith([0x10n]), acts, config, range, { settled: true });
    expect(v.pass).toBe(true);
    expect(v.uptimeBuckets).toBe(v.totalBuckets);
    expect(Object.values(v.invariants).every(Boolean)).toBe(true);
  });

  it("I3: fails when custody floor is breached", () => {
    const acts = new Map([[0x10n, goodActivity(0x10n, { baseEnd: 100n, lpBase: 100n })]]);
    const v = evaluateEpoch(engWith([0x10n]), acts, config, range, { settled: true });
    expect(v.invariants.I3_custodyFloor).toBe(false);
    expect(v.pass).toBe(false);
  });

  it("I4: fails when net selling exceeds the cap", () => {
    const acts = new Map([[0x10n, goodActivity(0x10n, { swapBaseOut: 500n, swapBaseIn: 50n })]]);
    const v = evaluateEpoch(engWith([0x10n]), acts, config, range, { settled: true });
    expect(v.invariants.I4_netSellingCap).toBe(false);
  });

  it("I5: fails when outflows exceed the cap", () => {
    const acts = new Map([[0x10n, goodActivity(0x10n, { xferOut: 50n, xferIn: 0n, fromTreasury: 0n })]]);
    const v = evaluateEpoch(engWith([0x10n]), acts, config, range, { settled: true });
    expect(v.invariants.I5_outflowCap).toBe(false);
  });

  it("I5: rejects transferring the loan out of the set (custody)", () => {
    // The MM receives the 1000 loan (part of xfer_in) and tries to send it out.
    // The loan is excluded from spendable inflow, so this must fail.
    const acts = new Map([
      [0x10n, goodActivity(0x10n, { xferIn: 1000n, fromTreasury: 1000n, xferOut: 1000n })],
    ]);
    const v = evaluateEpoch(engWith([0x10n]), acts, config, range, { settled: true });
    expect(v.invariants.I5_outflowCap).toBe(false);
  });

  it("I5: internal wallet-to-wallet moves net out, external moves do not", () => {
    // A sends 500 to B, both committed: A.xfer_out=500, B.xfer_in=1000(loan)+500.
    // The 500 appears in both Σxfer_out and Σxfer_in, so it cancels -> passes.
    const internal = new Map([
      [0x10n, goodActivity(0x10n, { xferIn: 1000n, fromTreasury: 1000n, xferOut: 500n })],
      [0x20n, goodActivity(0x20n, { xferIn: 1500n, fromTreasury: 1000n, xferOut: 0n })],
    ]);
    expect(
      evaluateEpoch(engWith([0x10n, 0x20n]), internal, config, range, { settled: true })
        .invariants.I5_outflowCap,
    ).toBe(true);

    // Same 500 sent OUTSIDE the set: no member records the receipt, so it is a
    // real outflow and must fail (D = 0).
    const external = new Map([
      [0x10n, goodActivity(0x10n, { xferIn: 1000n, fromTreasury: 1000n, xferOut: 500n })],
      [0x20n, goodActivity(0x20n, { xferIn: 1000n, fromTreasury: 1000n, xferOut: 0n })],
    ]);
    expect(
      evaluateEpoch(engWith([0x10n, 0x20n]), external, config, range, { settled: true })
        .invariants.I5_outflowCap,
    ).toBe(false);
  });

  it("I6: fails when depth misses the target in some buckets", () => {
    const acts = new Map([[0x10n, goodActivity(0x10n, { depthBuckets: fullDepth(10n, 10n) })]]);
    const v = evaluateEpoch(engWith([0x10n]), acts, config, range, { settled: true });
    expect(v.invariants.I6_uptime).toBe(false);
    expect(v.uptimeBuckets).toBe(0);
  });

  it("I6: anti-JIT position earns no depth credit", () => {
    const acts = new Map([
      [0x10n, goodActivity(0x10n, { lpFirstActiveBlock: range.endBlock - 5 })],
    ]);
    const v = evaluateEpoch(engWith([0x10n]), acts, config, range, { settled: true });
    expect(v.uptimeBuckets).toBe(0);
    expect(v.invariants.I6_uptime).toBe(false);
  });

  it("I7: fails when round-trip volume exceeds the share cap", () => {
    const acts = new Map([
      [0x10n, goodActivity(0x10n, { flowWindows: [{ window: 0, buy: 100n, sell: 100n }] })],
    ]);
    const lowCap = { ...terms, roundtripSharePpm: 100_000n }; // 10%
    const eng = createEngagement({
      id: "e",
      poolAddr: 0xabcdn,
      wallets: [0x10n],
      salt: new Uint8Array(32).fill(1),
      terms: lowCap,
    });
    const v = evaluateEpoch(eng, acts, config, range, { settled: true });
    expect(v.invariants.I7_roundTripCap).toBe(false);
  });

  it("I8: fails when the epoch is not settled", () => {
    const acts = new Map([[0x10n, goodActivity(0x10n)]]);
    const v = evaluateEpoch(engWith([0x10n]), acts, config, range, { settled: false });
    expect(v.invariants.I8_settled).toBe(false);
    expect(v.pass).toBe(false);
  });

  it("I2: fails when a committed wallet is a protocol contract", () => {
    const acts = new Map([[0x10n, goodActivity(0x10n, { isProtocol: true })]]);
    const v = evaluateEpoch(engWith([0x10n]), acts, config, range, { settled: true });
    expect(v.invariants.I2_accountedOnce).toBe(false);
  });

  it("aggregates depth across two wallets to meet the target together", () => {
    const acts = new Map([
      [0x10n, goodActivity(0x10n, { depthBuckets: fullDepth(60n, 60n) })],
      [0x20n, goodActivity(0x20n, { depthBuckets: fullDepth(60n, 60n) })],
    ]);
    // each alone is below target 100; summed (120) clears it
    const v = evaluateEpoch(engWith([0x10n, 0x20n]), acts, config, range, { settled: true });
    expect(v.invariants.I6_uptime).toBe(true);
    expect(v.uptimeBuckets).toBe(v.totalBuckets);
  });
});
