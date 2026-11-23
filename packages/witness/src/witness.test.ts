import { describe, it, expect } from "vitest";
import { Sha256Hasher } from "@mmr/merkle";
import {
  DEFAULT_CONFIG,
  bucketsPerEpoch,
  type AddressActivity,
  type DepthBucketSample,
  type EpochRange,
} from "@mmr/indexer";
import { createEngagement, type Engagement, type EngagementTerms } from "@mmr/prover";
import {
  captureEpochWitness,
  captureAndStore,
  carryStateFromWitness,
  genesisCarryState,
  witnessCoverage,
  serializeWitness,
  deserializeWitness,
  MemoryWitnessStore,
} from "./index.js";

const hasher = () => new Sha256Hasher();
const WALLETS = [0x10n, 0x20n];
const SALT = new Uint8Array(32).fill(7);

const TERMS: EngagementTerms = {
  floorPriceP: 1n,
  loanL0: 1000n,
  quoteStartQ0: 0n,
  disposalD: 0n,
  netSellS: 0n,
  depthTarget: 100n,
  roundtripSharePpm: 600_000n,
  bandBps: 100,
  minUptimeBuckets: bucketsPerEpoch(DEFAULT_CONFIG),
  epochsTotal: 30,
  pool: 0xabcdn,
};

function fullDepth(minBid: bigint, minAsk: bigint): DepthBucketSample[] {
  const out: DepthBucketSample[] = [];
  for (let b = 0; b < bucketsPerEpoch(DEFAULT_CONFIG); b++) {
    out.push({ bucket: b, perBand: DEFAULT_CONFIG.bandsBps.map((bandBps) => ({ bandBps, minBid, minAsk })) });
  }
  return out;
}

function compliant(addr: bigint, over: Partial<AddressActivity> = {}): AddressActivity {
  return {
    addr,
    isProtocol: false,
    baseStart: 1000n,
    baseEnd: 800n,
    quoteEnd: 0n,
    lpBase: 300n,
    lpQuote: 0n,
    xferIn: 1000n,
    xferOut: 0n,
    fromTreasury: 1000n,
    swapBaseIn: 50n,
    swapBaseOut: 50n,
    swapQuoteIn: 0n,
    swapQuoteOut: 0n,
    depthBuckets: fullDepth(60n, 60n),
    flowWindows: [{ window: 0, buy: 50n, sell: 50n }],
    lpFirstActiveTs: 1,
    ...over,
  };
}

function range(epoch: number): EpochRange {
  return {
    epoch,
    startBlock: 900_000 + epoch * 1000,
    endBlock: 901_000 + epoch * 1000,
    endBlockHash: `0xdemo${epoch}`,
    startTs: 1_000_000 + epoch * 86_400,
    endTs: 1_086_400 + epoch * 86_400,
  };
}

function engagement(): Engagement {
  return createEngagement({ id: "eng-demo", poolAddr: 0xabcdn, wallets: WALLETS, salt: SALT, terms: TERMS });
}

function activities(): Map<bigint, AddressActivity> {
  return new Map(WALLETS.map((w) => [w, compliant(w)] as const));
}

describe("@mmr/witness — per-epoch capture + carry chaining", () => {
  it("captures a passing epoch and a well-formed carry step", () => {
    const eng = engagement();
    const w = captureEpochWitness({
      hasher: hasher(),
      engagement: eng,
      activities: activities(),
      config: DEFAULT_CONFIG,
      range: range(1),
      settled: true,
      prevCarry: genesisCarryState(hasher(), SALT),
      newSalt: new Uint8Array(32).fill(1),
    });
    expect(w.pass).toBe(true);
    expect(w.members).toEqual(WALLETS);
    expect(w.uptimeBuckets).toBe(w.totalBuckets);
    // two wallets, each xferIn 1000 / fromTreasury 1000
    expect(w.carry.newTotals).toEqual({ xferIn: 2000n, xferOut: 0n, fromTreasury: 2000n });
    expect(w.carry.ok).toBe(true);
  });

  it("chains the carry-forward across epochs in a store and reports coverage", () => {
    const eng = engagement();
    const store = new MemoryWitnessStore();
    for (let e = 1; e <= 3; e++) {
      captureAndStore(store, {
        hasher: hasher(),
        engagement: eng,
        activities: activities(),
        config: DEFAULT_CONFIG,
        range: range(e),
        settled: true,
        newSalt: new Uint8Array(32).fill(e),
        genesisSalt: SALT,
      });
    }
    const last = store.get("eng-demo", 3)!;
    // cumulative over 3 epochs: 3 × (2000 in, 2000 treasury)
    expect(last.carry.newTotals).toEqual({ xferIn: 6000n, xferOut: 0n, fromTreasury: 6000n });
    // epoch 3 chains from epoch 2's committed carry
    const prev2 = carryStateFromWitness(store.get("eng-demo", 2)!);
    expect(last.carry.prevTotals).toEqual(prev2.totals);

    const cov = witnessCoverage(store, "eng-demo", TERMS.epochsTotal);
    expect(cov.present).toBe(3);
    expect(cov.passed).toBe(3);
    expect(cov.missing.length).toBe(TERMS.epochsTotal - 3);
    expect(cov.contiguous).toBe(false); // only 3 of 30 captured so far
  });

  it("enforces in-order capture (no chaining across a gap)", () => {
    const eng = engagement();
    const store = new MemoryWitnessStore();
    captureAndStore(store, {
      hasher: hasher(), engagement: eng, activities: activities(), config: DEFAULT_CONFIG,
      range: range(1), settled: true, newSalt: new Uint8Array(32).fill(1), genesisSalt: SALT,
    });
    expect(() =>
      captureAndStore(store, {
        hasher: hasher(), engagement: eng, activities: activities(), config: DEFAULT_CONFIG,
        range: range(3), settled: true, newSalt: new Uint8Array(32).fill(3), genesisSalt: SALT,
      }),
    ).toThrow(/epoch 2 not yet captured/);
  });

  it("flags a failing epoch and a broken cumulative budget cap", () => {
    const eng = engagement();
    // a wallet dumps a large outflow: breaks per-epoch I5 AND the cumulative cap (D=0)
    const acts = new Map<bigint, AddressActivity>([
      [0x10n, compliant(0x10n, { xferOut: 5000n })],
      [0x20n, compliant(0x20n)],
    ]);
    const w = captureEpochWitness({
      hasher: hasher(), engagement: eng, activities: acts, config: DEFAULT_CONFIG,
      range: range(1), settled: true, prevCarry: genesisCarryState(hasher(), SALT),
      newSalt: new Uint8Array(32).fill(1),
    });
    expect(w.pass).toBe(false);
    expect(w.invariants.I5_outflowCap).toBe(false);
    expect(w.carry.capHolds).toBe(false);
    expect(w.carry.ok).toBe(false);
  });

  it("round-trips through serialization (private store format)", () => {
    const w = captureEpochWitness({
      hasher: hasher(), engagement: engagement(), activities: activities(), config: DEFAULT_CONFIG,
      range: range(1), settled: true, prevCarry: genesisCarryState(hasher(), SALT),
      newSalt: new Uint8Array(32).fill(1), capturedAt: "2026-11-16T00:00:00.000Z",
    });
    const back = deserializeWitness(serializeWitness(w));
    expect(back.sums).toEqual(w.sums);
    expect(back.members).toEqual(w.members);
    expect(back.carry.newTotals).toEqual(w.carry.newTotals);
    expect(Buffer.from(back.carry.newCommitment).toString("hex")).toBe(
      Buffer.from(w.carry.newCommitment).toString("hex"),
    );
  });
});
