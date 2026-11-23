// End to end without a network: the indexer's own pipeline builds and "publishes" a day
// (fake chain data, in-memory content store), the job's code reads it back and recomputes
// it, builds the engagement's witness from the published tree and series, and the
// compiled contract accepts it (proveEpoch, proveFunding). Tampered published data is
// refused before anything reaches the circuit.

import { describe, expect, it } from "vitest";
import {
  BLOCK_TIME, HAVE_BUILD, runProveEpoch, runProveFunding, runRegister, type TermsW,
} from "@mmr/contracts/harness";
import {
  DEFAULT_CONFIG, InMemoryPublisher, buildEpoch,
  type AddressActivity, type ChainProvider, type EpochRange, type PoolDescriptor, type PriceSample,
} from "@mmr/indexer";
import { loadPublishedDay, loadSeries, type Fetcher } from "./published.js";
import { realWitness, type EngagementPrivate } from "./real-witness.js";

const POOL = 0x00000000000000000000000000000000000000b2n;
const OTHER_POOL = 0x00000000000000000000000000000000000000a1n;
const A = 0x1000000000000000000000000000000000000010n; // committed, in the pool
const B = 0x2000000000000000000000000000000000000020n; // committed, not in the pool
const C = 0x3000000000000000000000000000000000000030n; // someone else

function activity(addr: bigint, depth: (bucket: number) => bigint, over: Partial<AddressActivity> = {}): AddressActivity {
  return {
    addr, isProtocol: false,
    baseStart: 1_000n, baseEnd: 1_000n, quoteEnd: 0n, lpBase: 500n, lpQuote: 500n,
    xferIn: 0n, xferOut: 0n, fromTreasury: 0n,
    swapBaseIn: 10n, swapBaseOut: 5n, swapQuoteIn: 0n, swapQuoteOut: 0n,
    depthBuckets: Array.from({ length: 48 }, (_, bucket) => ({
      bucket,
      perBand: DEFAULT_CONFIG.bandsBps.map((bandBps) => ({ bandBps, minBid: depth(bucket) * BigInt(bandBps), minAsk: depth(bucket) * BigInt(bandBps) })),
    })).filter((b) => depth(b.bucket) > 0n),
    flowWindows: [{ window: 3, buy: 5n, sell: 3n }],
    lpFirstActiveTs: null,
    ...over,
  };
}

class FakeChain implements ChainProvider {
  chainId(): number { return 8453; }
  async finalizedBlock(): Promise<number> { return 1_000_000; }
  async poolsAboveFloor(): Promise<PoolDescriptor[]> {
    return [
      { poolAddr: POOL, token0: 1n, token1: 2n, liquidity: 10n, dex: "uniswap-v3" },
      { poolAddr: OTHER_POOL, token0: 1n, token1: 3n, liquidity: 10n, dex: "uniswap-v3" },
    ];
  }
  async poolActivity(pool: PoolDescriptor): Promise<AddressActivity[]> {
    // A quotes 10 per band step in 40 of 48 buckets; C quotes everywhere.
    if (pool.poolAddr === POOL) return [activity(A, (b) => (b < 40 ? 10n : 0n)), activity(C, () => 7n)];
    return [activity(C, () => 1n)];
  }
  async poolPriceSamples(_p: PoolDescriptor, range: EpochRange): Promise<PriceSample[]> {
    return [{ ts: range.endTs - 600, price: 100n }];
  }
}

const DAY1 = Number(BLOCK_TIME / 86_400n + 1n);
const range: EpochRange = {
  epoch: DAY1, startBlock: 900_000, endBlock: 943_200, endBlockHash: "0xkat",
  startTs: DAY1 * 86_400, endTs: (DAY1 + 1) * 86_400,
};

// A retainer: no loan, depth 500 (A's 10 per bps step in the 50 bps band) in 36 of 48 buckets.
const TERMS: TermsW = {
  floor_price_P: 0n, loan_L0: 0n, quote_start_Q0: 0n, disposal_D: 0n, net_sell_S: 0n,
  depth_target: 500n, roundtrip_share_ppm: 1_000_000n, band_bps: 50n, min_uptime_buckets: 36n, epochs_total: 30n,
  pool: POOL,
};
const ENG: EngagementPrivate = {
  poolAddr: POOL, wallets: [B, A], walletSalt: new Uint8Array(32).fill(0x5a), terms: TERMS, termsSalt: new Uint8Array(32).fill(0x7e),
};

async function publishedDay() {
  const publisher = new InMemoryPublisher();
  const built = await buildEpoch({ provider: new FakeChain(), publisher }, DEFAULT_CONFIG, range);
  const fetcher: Fetcher = async (cid) => {
    const b = publisher.get(cid);
    if (!b) throw new Error(`no ${cid}`);
    return b;
  };
  return { built, publisher, fetcher };
}

describe("published day -> witness", () => {
  it("recomputes the published day and refuses a wrong root or a tampered tree", async () => {
    const { built, publisher, fetcher } = await publishedDay();
    const ok = await loadPublishedDay(built.manifestCid, built.manifest.rootOfRootsHex, fetcher);
    expect(ok.ok).toBe(true);
    const wrong = await loadPublishedDay(built.manifestCid, `0x${"11".repeat(32)}`, fetcher);
    expect(wrong).toMatchObject({ ok: false });
    // a tree document whose leaf was edited no longer rebuilds to the listed root
    const treeCid = built.manifest.pools[0]!.cid;
    const doc = JSON.parse(new TextDecoder().decode(publisher.get(treeCid)!));
    doc.leaves[1].metrics.baseEnd = "999999";
    const tampered: Fetcher = async (cid) => (cid === treeCid ? new TextEncoder().encode(JSON.stringify(doc)) : fetcher(cid));
    const bad = await loadPublishedDay(built.manifestCid, built.manifest.rootOfRootsHex, tampered);
    expect(bad.ok).toBe(false);
  });

  it("refuses a series that does not match the published leaf", async () => {
    const { built, fetcher } = await publishedDay();
    const check = await loadPublishedDay(built.manifestCid, undefined, fetcher);
    if (!check.ok) throw new Error(check.reason);
    const s = await loadSeries(check.day, POOL, fetcher);
    const a = s.series.get(A)!;
    s.series.set(A, { ...a, depth: a.depth.slice(1) }); // drop one bucket
    expect(() => realWitness(check.day, ENG, s)).toThrow(/depth series .* does not match its leaf/);
  });
});

describe.skipIf(!HAVE_BUILD)("published day -> witness -> the compiled contract", () => {
  it("proveEpoch and proveFunding accept the witness built from published data", async () => {
    const { built, fetcher } = await publishedDay();
    const check = await loadPublishedDay(built.manifestCid, built.manifest.rootOfRootsHex, fetcher);
    if (!check.ok) throw new Error(check.reason);
    const rw = realWitness(check.day, ENG, await loadSeries(check.day, POOL, fetcher));
    expect(rw.members).toEqual([A]);
    const reg = await runRegister(rw.witness, new Uint8Array(32).fill(0x42));
    const proved = await runProveEpoch(rw.witness, reg.id, rw.rootOfRoots, 1n, reg.state);
    expect(proved.uptime).toBe(40n); // A's 500 in the 50 bps band in 40 buckets; B is absent
    const funded = await runProveFunding(rw.witness, reg.id, rw.rootOfRoots, proved.state);
    expect(funded.proven).toBe(true);
  });
});
