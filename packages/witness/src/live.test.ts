import { describe, it, expect } from "vitest";
import { Sha256Hasher } from "@mmr/merkle";
import {
  DEFAULT_CONFIG,
  bucketsPerEpoch,
  type AddressActivity,
  type ActivityParams,
  type ChainProvider,
  type DepthBucketSample,
  type EpochRange,
  type PoolDescriptor,
  type PriceSample,
  type PoolDepthFloor,
} from "@mmr/indexer";
import { createEngagement, type Engagement, type EngagementTerms } from "@mmr/prover";
import {
  captureLiveEpoch,
  captureLiveEpochToStore,
  filterToWallets,
  genesisCarryState,
  carryStateFromWitness,
  MemoryWitnessStore,
} from "./index.js";

const POOL_ADDR = 0xabcdn;
const WALLETS = [0x10n, 0x20n];
const NON_MEMBER = 0x99n;
const SALT = new Uint8Array(32).fill(7);

const terms: EngagementTerms = {
  floorPriceP: 1n, loanL0: 1000n, quoteStartQ0: 0n, disposalD: 0n, netSellS: 0n,
  depthTarget: 100n, roundtripSharePpm: 600_000n, bandBps: 100,
  minUptimeBuckets: bucketsPerEpoch(DEFAULT_CONFIG), epochsTotal: 30,
};
const engagement = (): Engagement =>
  createEngagement({ id: "eng-live", poolAddr: POOL_ADDR, wallets: WALLETS, salt: SALT, terms });

const pool: PoolDescriptor = {
  poolAddr: POOL_ADDR, token0: 0x1n, token1: 0x2n, liquidity: 1n, dex: "uniswap-v3",
};

function fullDepth(v: bigint): DepthBucketSample[] {
  return Array.from({ length: bucketsPerEpoch(DEFAULT_CONFIG) }, (_, b) => ({
    bucket: b, perBand: DEFAULT_CONFIG.bandsBps.map((bandBps) => ({ bandBps, minBid: v, minAsk: v })),
  }));
}
function activity(addr: bigint, depth: bigint, over: Partial<AddressActivity> = {}): AddressActivity {
  return {
    addr, isProtocol: false, baseStart: 1000n, baseEnd: 800n, quoteEnd: 0n, lpBase: 300n, lpQuote: 0n,
    xferIn: 1000n, xferOut: 0n, fromTreasury: 1000n, swapBaseIn: 50n, swapBaseOut: 50n,
    swapQuoteIn: 0n, swapQuoteOut: 0n, depthBuckets: fullDepth(depth),
    flowWindows: [{ window: 0, buy: 50n, sell: 50n }], lpFirstActiveTs: 1, ...over,
  };
}
function range(epoch: number): EpochRange {
  return {
    epoch, startBlock: 900_000 + epoch * 1000, endBlock: 901_000 + epoch * 1000,
    endBlockHash: `0xlive${epoch}`, startTs: 1_000_000 + epoch * 86_400, endTs: 1_086_400 + epoch * 86_400,
  };
}

// A fake reader: returns the MM's two wallets PLUS an unrelated address and a protocol
// contract, so filtering to the committed wallet set is exercised.
class FakeProvider implements ChainProvider {
  calls: Array<{ pool: bigint; epoch: number; params: ActivityParams }> = [];
  chainId(): number {
    return DEFAULT_CONFIG.chainId;
  }
  async finalizedBlock(): Promise<number> {
    return 2_000_000;
  }
  async poolsAboveFloor(_f: PoolDepthFloor, _b: number, _t: readonly string[]): Promise<PoolDescriptor[]> {
    return [pool];
  }
  async poolActivity(p: PoolDescriptor, r: EpochRange, params: ActivityParams): Promise<AddressActivity[]> {
    this.calls.push({ pool: p.poolAddr, epoch: r.epoch, params });
    return [
      activity(WALLETS[0]!, 60n),
      activity(WALLETS[1]!, 60n),
      activity(NON_MEMBER, 10_000n, { isProtocol: false }), // not the MM's: must be dropped
      activity(0x7n, 0n, { isProtocol: true }),
    ];
  }
  async poolPriceSamples(_p: PoolDescriptor, _r: EpochRange, _t: readonly number[]): Promise<PriceSample[]> {
    return [];
  }
}

describe("@mmr/witness/live — capture from a ChainProvider", () => {
  it("filters pool activity to the committed wallets", () => {
    const acts = [activity(WALLETS[0]!, 60n), activity(NON_MEMBER, 1n), activity(WALLETS[1]!, 60n)];
    const mine = filterToWallets(engagement(), acts);
    expect([...mine.keys()].sort()).toEqual([...WALLETS].sort());
  });

  it("captures a live epoch using only the MM's wallets and passes config params through", async () => {
    const provider = new FakeProvider();
    const w = await captureLiveEpoch({
      provider, hasher: new Sha256Hasher(), engagement: engagement(), pool,
      config: DEFAULT_CONFIG, range: range(1), settled: true,
      prevCarry: genesisCarryState(new Sha256Hasher(), SALT), newSalt: new Uint8Array(32).fill(1),
    });
    expect(w.members).toEqual(WALLETS); // the non-member and protocol address were excluded
    expect(w.pass).toBe(true);
    expect(w.carry.newTotals).toEqual({ xferIn: 2000n, xferOut: 0n, fromTreasury: 2000n });
    // the committed bucket/band params reached the provider
    expect(provider.calls[0]!.params.bandsBps).toEqual(DEFAULT_CONFIG.bandsBps);
    expect(provider.calls[0]!.params.bucketSeconds).toBe(DEFAULT_CONFIG.bucketSeconds);
  });

  it("captures straight to a store and chains the carry across epochs", async () => {
    const provider = new FakeProvider();
    const store = new MemoryWitnessStore();
    const eng = engagement();
    for (let e = 1; e <= 2; e++) {
      await captureLiveEpochToStore(store, {
        provider, hasher: new Sha256Hasher(), engagement: eng, pool,
        config: DEFAULT_CONFIG, range: range(e), settled: true,
        newSalt: new Uint8Array(32).fill(e), genesisSalt: SALT,
      });
    }
    const second = store.get("eng-live", 2)!;
    expect(second.carry.newTotals).toEqual({ xferIn: 4000n, xferOut: 0n, fromTreasury: 4000n });
    expect(second.carry.prevTotals).toEqual(carryStateFromWitness(store.get("eng-live", 1)!).totals);
  });

  it("rejects a pool that isn't the engagement's", async () => {
    const provider = new FakeProvider();
    const wrongPool: PoolDescriptor = { ...pool, poolAddr: 0xdeadn };
    await expect(
      captureLiveEpoch({
        provider, hasher: new Sha256Hasher(), engagement: engagement(), pool: wrongPool,
        config: DEFAULT_CONFIG, range: range(1), settled: true,
        prevCarry: genesisCarryState(new Sha256Hasher(), SALT), newSalt: new Uint8Array(32).fill(1),
      }),
    ).rejects.toThrow(/does not match the engagement's pool/);
  });
});
