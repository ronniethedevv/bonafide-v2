// The published source, end to end without a network: the indexer's own pipeline builds and
// "publishes" a day from raw activity, the source reads the market maker's wallets back from
// it, and the client's figures come out exactly as they do from the raw activity.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newOpening, type EngagementOpening } from "@mmr/engagement-file";
import { rootKey } from "@mmr/contracts/harness";
import {
  DEFAULT_CONFIG, InMemoryPublisher, buildEpoch,
  type AddressActivity, type ChainProvider, type EpochRange, type PoolDescriptor, type PriceSample,
} from "@mmr/indexer";
import { CompactHasher } from "@mmr/merkle";
import { FsWitnessStore, captureAndStore, filterToWallets } from "@mmr/witness";
import { genesisCarrySalt, proverEngagement } from "./engagement.js";
import { figuresFromWitness } from "./figures.js";
import { chainDays, publishedSource, type DayLocator } from "./published-source.js";

const POOL = "0x00000000000000000000000000000000000abcde";
const MM_WALLET = "0x0000000000000000000000000000000000000010";
const OTHER = "0x0000000000000000000000000000000000000099";
const DAY = 20_781; // 24 Nov 2026

function activity(addr: string, depth: bigint): AddressActivity {
  return {
    addr: BigInt(addr), isProtocol: false, baseStart: 1000n, baseEnd: 800n, quoteEnd: 0n, lpBase: 300n, lpQuote: 0n,
    xferIn: 0n, xferOut: 0n, fromTreasury: 0n, swapBaseIn: 50n, swapBaseOut: 50n, swapQuoteIn: 0n, swapQuoteOut: 0n,
    depthBuckets: Array.from({ length: 48 }, (_, b) => ({ bucket: b, perBand: DEFAULT_CONFIG.bandsBps.map((bandBps) => ({ bandBps, minBid: depth, minAsk: depth })) })),
    flowWindows: [{ window: 0, buy: 50n, sell: 40n }],
    lpFirstActiveTs: 1,
  };
}
const RAW = [activity(MM_WALLET, 120n), activity(OTHER, 5n)];

class FakeChain implements ChainProvider {
  chainId(): number { return 8453; }
  async finalizedBlock(): Promise<number> { return 1_000_000; }
  async poolsAboveFloor(): Promise<PoolDescriptor[]> {
    return [{ poolAddr: BigInt(POOL), token0: 1n, token1: 2n, liquidity: 10n, dex: "uniswap-v3" }];
  }
  async poolActivity(): Promise<AddressActivity[]> { return RAW; }
  async poolPriceSamples(_p: PoolDescriptor, range: EpochRange): Promise<PriceSample[]> {
    return [{ ts: range.endTs - 600, price: 100n }];
  }
}
const RANGE: EpochRange = { epoch: DAY, startBlock: 900_000, endBlock: 943_199, endBlockHash: "0xday", startTs: DAY * 86_400, endTs: (DAY + 1) * 86_400 };

async function setup() {
  const publisher = new InMemoryPublisher();
  const built = await buildEpoch({ provider: new FakeChain(), publisher }, DEFAULT_CONFIG, RANGE);
  const store = new Map<string, Uint8Array>();
  const fetcher = async (cid: string) => {
    const b = store.get(cid) ?? publisher.get(cid);
    if (!b) throw new Error(`no ${cid}`);
    return b;
  };
  const opening = await newOpening({
    pool: { chain: "Base", address: POOL, pair: "TKN / USDC" },
    client: { address: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" },
    wallets: [MM_WALLET],
    terms: { floorPriceP: 0n, loanL0: 1000n, quoteStartQ0: 0n, disposalD: 1000n, netSellS: 0n, depthTarget: 100n, roundtripSharePpm: 600_000n, bandBps: 100, minUptimeBuckets: 44, epochsTotal: 30, pool: BigInt(POOL) },
    human: {},
  });
  const locate: DayLocator = async () => ({ day: DAY, rootHex: built.manifest.rootOfRootsHex, manifestCid: built.manifestCid });
  return { built, publisher, store, fetcher, opening, locate };
}

function figures(opening: EngagementOpening, activities: AddressActivity[], range: EpochRange) {
  const engagement = proverEngagement(opening, "rec_abc");
  const w = captureAndStore(new FsWitnessStore(mkdtempSync(join(tmpdir(), "mmr-pub-"))), {
    hasher: new CompactHasher(), engagement, activities: filterToWallets(engagement, activities), config: DEFAULT_CONFIG,
    range, settled: false, newSalt: new Uint8Array(32).fill(1), genesisSalt: genesisCarrySalt(opening),
  });
  return figuresFromWitness(w);
}

describe("the published source", () => {
  it("reads the committed wallets back from the attested day, and gives the same figures as the raw activity", async () => {
    const { fetcher, opening, locate } = await setup();
    const act = await publishedSource(opening, locate, fetcher).activity(1);
    expect(act.pool).toBe(POOL);
    expect(act.activities.map((a) => a.addr)).toEqual([BigInt(MM_WALLET)]);
    expect(act.range).toMatchObject({ epoch: 1, startBlock: RANGE.startBlock, endBlock: RANGE.endBlock, startTs: RANGE.startTs, endTs: RANGE.endTs });
    const range = { ...RANGE, epoch: 1 };
    const fromPublished = figures(opening, act.activities, range);
    expect(fromPublished).toEqual(figures(opening, RAW, range));
    expect(fromPublished).toMatchObject({ bucketsAtTarget: 48, met: true });
  });

  it("refuses a day that does not rebuild the attested root", async () => {
    const { fetcher, opening, built } = await setup();
    const wrong: DayLocator = async () => ({ day: DAY, rootHex: `0x${"11".repeat(32)}`, manifestCid: built.manifestCid });
    await expect(publishedSource(opening, wrong, fetcher).activity(1)).rejects.toThrow(/does not rebuild the attested root/);
  });

  it("refuses a series that does not match the wallet's leaf", async () => {
    const { fetcher, opening, locate, built, store, publisher } = await setup();
    const seriesCid = built.manifest.pools[0]!.seriesCid!;
    const doc = JSON.parse(new TextDecoder().decode(publisher.get(seriesCid)!));
    for (const a of doc.addresses) if (BigInt(a[0]) === BigInt(MM_WALLET)) a[1] = a[1].slice(1); // drop one bucket
    store.set(seriesCid, new TextEncoder().encode(JSON.stringify(doc)));
    await expect(publishedSource(opening, locate, fetcher).activity(1)).rejects.toThrow(/does not match its leaf/);
  });
});

describe("locating a day on Midnight", () => {
  const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
  const set = (keys: Uint8Array[]) => ({ member: (k: Uint8Array) => keys.some((x) => hex(x) === hex(k)) });
  function fakeLedger(o: { active?: boolean; attested?: boolean; disputed?: boolean }) {
    const rk = rootKey(8453n, BigInt(DAY));
    const cid = new Uint8Array(64);
    cid.set(new TextEncoder().encode("bafkday"));
    const one = <V>(k: Uint8Array, v: V, on = true) => ({ member: (x: Uint8Array) => on && hex(x) === hex(k), lookup: () => v });
    return (id: Uint8Array) => ({
      startDay: { member: (x: Uint8Array) => !!o.active && hex(x) === hex(id), lookup: () => BigInt(DAY) },
      chainOf: { member: () => true, lookup: () => 8453n },
      publishedRoot: one(rk, new Uint8Array(32).fill(0xab), !!o.attested),
      publishedCid: one(rk, cid, !!o.attested),
      disputedRoot: set(o.disputed ? [rk] : []),
    });
  }

  it("finds the epoch's day and its attested root and manifest, and says why when it can't", async () => {
    const { opening } = await setup();
    const rt = await import("@midnight-ntwrk/compact-runtime");
    const id = rt.persistentHash(new rt.CompactTypeBytes(32), Buffer.from(opening.secrets.engagementSecret.replace(/^0x/, ""), "hex"));
    const at = (o: Parameters<typeof fakeLedger>[0]) => chainDays(opening, async () => fakeLedger(o)(id) as never)(1);
    await expect(at({})).rejects.toThrow(/not active on Midnight yet/);
    await expect(at({ active: true })).rejects.toThrow(/no root is attested/);
    await expect(at({ active: true, attested: true, disputed: true })).rejects.toThrow(/disputed/);
    await expect(at({ active: true, attested: true })).resolves.toEqual({ day: DAY, rootHex: `0x${"ab".repeat(32)}`, manifestCid: "bafkday" });
  });
});
