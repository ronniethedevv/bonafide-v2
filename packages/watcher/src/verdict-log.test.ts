import { describe, it, expect } from "vitest";
import { createEngagement, type EngagementTerms } from "@mmr/prover";
import {
  DEFAULT_CONFIG,
  bucketsPerEpoch,
  type AddressActivity,
  type DepthBucketSample,
  type EpochRange,
} from "@mmr/indexer";
import { DEFAULT_TIMING } from "@mmr/protocol";
import {
  buildClientVerdictLog,
  summarizeLog,
  buildClaimInput,
  type EpochObservation,
} from "./verdict-log.js";

const config = DEFAULT_CONFIG;
const timing = DEFAULT_TIMING;

function fullDepth(v: bigint): DepthBucketSample[] {
  const out: DepthBucketSample[] = [];
  for (let b = 0; b < bucketsPerEpoch(config); b++) {
    out.push({ bucket: b, perBand: config.bandsBps.map((bandBps) => ({ bandBps, minBid: v, minAsk: v })) });
  }
  return out;
}

function compliant(addr: bigint, endBlock: number): AddressActivity {
  return {
    addr,
    isProtocol: false,
    baseStart: 1000n,
    baseEnd: 800n,
    quoteEnd: 0n,
    lpBase: 300n,
    lpQuote: 0n,
    // from_treasury (the loan) is part of xfer_in and excluded by I5 (DD-11).
    xferIn: 1000n,
    xferOut: 0n,
    fromTreasury: 1000n,
    swapBaseIn: 50n,
    swapBaseOut: 50n,
    swapQuoteIn: 0n,
    swapQuoteOut: 0n,
    depthBuckets: fullDepth(60n), // two wallets sum to 120 >= target 100
    flowWindows: [{ window: 0, buy: 50n, sell: 50n }],
    lpFirstActiveBlock: endBlock - 1000,
  };
}

const terms: EngagementTerms = {
  floorPriceP: 1n,
  loanL0: 1000n,
  quoteStartQ0: 0n,
  disposalD: 0n,
  netSellS: 0n,
  depthTarget: 100n,
  roundtripSharePpm: 600_000n,
  bandBps: 100,
  minUptimeBuckets: 48, // every bucket (DEFAULT_CONFIG: 48 per epoch)
  epochsTotal: 30,
};

const engagement = createEngagement({
  id: "eng-1",
  poolAddr: 0xabcdn,
  wallets: [0x10n, 0x20n],
  salt: new Uint8Array(32).fill(3),
  terms,
});

function range(epoch: number, endBlock: number, endTs: number): EpochRange {
  return { epoch, startBlock: endBlock - 100_000, endBlock, endBlockHash: "0x", startTs: endTs - 86_400, endTs };
}

function activities(endBlock: number): Map<bigint, AddressActivity> {
  return new Map([
    [0x10n, compliant(0x10n, endBlock)],
    [0x20n, compliant(0x20n, endBlock)],
  ]);
}

describe("client verdict log", () => {
  const observations: EpochObservation[] = [
    {
      // epoch 1: settled with an on-time proof
      range: range(1, 1_000_000, 1_000_000),
      activities: activities(1_000_000),
      root: { publishedTs: 1_000_100, voteCount: 2 },
      now: 1_100_000,
      challenged: false,
      proofAcceptedTs: 1_050_000,
      threshold: 2,
    },
    {
      // epoch 2: no root yet, before the attester timeout
      range: range(2, 1_100_000, 1_086_400),
      activities: activities(1_100_000),
      root: null,
      now: 1_090_000,
      challenged: false,
      proofAcceptedTs: null,
      threshold: 2,
    },
  ];

  const log = buildClientVerdictLog(engagement, observations, config, timing);

  it("scores a settled epoch and marks the pending one", () => {
    expect(log[0]!.outcome).toBe("settled");
    expect(log[0]!.scored).toBe(true);
    expect(log[0]!.settled).toBe(true);
    expect(log[0]!.verdict.pass).toBe(true);

    expect(log[1]!.outcome).toBe("awaiting-root");
    expect(log[1]!.scored).toBe(false);
    expect(log[1]!.settled).toBe(false);
  });

  it("summarizes only scored epochs", () => {
    const s = summarizeLog(log);
    expect(s.epochsObserved).toBe(2);
    expect(s.epochsScored).toBe(1);
    expect(s.epochsPassed).toBe(1);
    expect(s.avgUptimePct).toBe(100);
  });

  it("derives claim inputs from the verdict log, not on trust", () => {
    const ci = buildClaimInput(engagement, log, 2);
    expect(ci.engagementId).toBe("eng-1");
    expect(ci.tier).toBe(2);
    expect(ci.epochsPassed).toBe(1); // only the settled+passing epoch
    expect(ci.epochsTotal).toBe(1); // only scored epochs count
  });
});
