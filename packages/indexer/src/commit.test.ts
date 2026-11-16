import { describe, it, expect } from "vitest";
import { Sha256Hasher, digestToHex } from "@mmr/merkle";
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import {
  BAND_SERIES_BUCKETS,
  BAND_TREE_DEPTH,
  bandSeriesLeaf,
  denseBandSeries,
  commitDepth,
  commitFlow,
  openBand,
  verifyBandOpening,
  FLOW_WINDOWS,
  openFlow,
  verifyFlowOpening,
} from "./commit.js";
import type { DepthBucketSample, FlowWindowSample } from "./provider.js";

const hasher = new Sha256Hasher();
const BANDS = [50, 100, 200, 500];

const buckets: DepthBucketSample[] = [
  {
    bucket: 0,
    perBand: [
      { bandBps: 50, minBid: 10n, minAsk: 12n },
      { bandBps: 100, minBid: 20n, minAsk: 22n },
      { bandBps: 200, minBid: 30n, minAsk: 32n },
      { bandBps: 500, minBid: 40n, minAsk: 42n },
    ],
  },
  {
    bucket: 1,
    perBand: [
      { bandBps: 50, minBid: 11n, minAsk: 13n },
      { bandBps: 100, minBid: 21n, minAsk: 23n },
      { bandBps: 200, minBid: 31n, minAsk: 33n },
      { bandBps: 500, minBid: 41n, minAsk: 43n },
    ],
  },
];

describe("depth commitment + band opening", () => {
  it("opens each band against depth_root", () => {
    const root = commitDepth(hasher, buckets, BANDS);
    for (const band of BANDS) {
      const opening = openBand(hasher, buckets, BANDS, band);
      expect(verifyBandOpening(hasher, root, opening)).toBe(true);
    }
  });

  it("rejects an opening against a different depth_root", () => {
    const opening = openBand(hasher, buckets, BANDS, 100);
    const otherBuckets = buckets.map((b, i) =>
      i === 0
        ? {
            ...b,
            perBand: b.perBand.map((pb) =>
              pb.bandBps === 100 ? { ...pb, minBid: 999n } : pb,
            ),
          }
        : b,
    );
    const otherRoot = commitDepth(hasher, otherBuckets, BANDS);
    expect(verifyBandOpening(hasher, otherRoot, opening)).toBe(false);
  });

  it("is deterministic and bucket-order independent", () => {
    const a = commitDepth(hasher, buckets, BANDS);
    const b = commitDepth(hasher, [...buckets].reverse(), BANDS);
    expect(digestToHex(a)).toBe(digestToHex(b));
  });

  it("rejects an unconfigured band", () => {
    expect(() => openBand(hasher, buckets, BANDS, 1234)).toThrow(/not configured/);
  });
});

describe("flow commitment", () => {
  it("is deterministic and window-order independent", () => {
    const w: FlowWindowSample[] = [
      { window: 0, buy: 5n, sell: 7n },
      { window: 1, buy: 9n, sell: 2n },
    ];
    expect(digestToHex(commitFlow(hasher, w))).toBe(
      digestToHex(commitFlow(hasher, [...w].reverse())),
    );
  });

  it("changes when a flow amount changes", () => {
    const w: FlowWindowSample[] = [{ window: 0, buy: 5n, sell: 7n }];
    const w2: FlowWindowSample[] = [{ window: 0, buy: 5n, sell: 8n }];
    expect(digestToHex(commitFlow(hasher, w))).not.toBe(
      digestToHex(commitFlow(hasher, w2)),
    );
  });
});

describe("flow opening: whole dense series (I7, DD-14)", () => {
  const windows: FlowWindowSample[] = [
    { window: 0, buy: 5n, sell: 7n },
    { window: 1, buy: 9n, sell: 2n },
    { window: 2, buy: 4n, sell: 4n },
  ];

  it("opens the dense series against flow_root", () => {
    const root = commitFlow(hasher, windows);
    const opening = openFlow(windows);
    expect(opening.buy.length).toBe(FLOW_WINDOWS);
    expect([opening.buy[1], opening.sell[1], opening.buy[47]]).toEqual([9n, 2n, 0n]);
    expect(verifyFlowOpening(hasher, root, opening)).toBe(true);
  });

  it("rejects tampered amounts and an omitted window", () => {
    const root = commitFlow(hasher, windows);
    const tampered = openFlow(windows);
    tampered.sell[1] = 999n;
    expect(verifyFlowOpening(hasher, root, tampered)).toBe(false);
    const omitted = openFlow(windows);
    omitted.buy[0] = 0n;
    omitted.sell[0] = 0n;
    expect(verifyFlowOpening(hasher, root, omitted)).toBe(false);
  });

  it("rejects an opening against a different flow_root", () => {
    const otherRoot = commitFlow(hasher, [{ window: 0, buy: 1n, sell: 1n }]);
    expect(verifyFlowOpening(hasher, otherRoot, openFlow(windows))).toBe(false);
  });

  it("rejects out-of-range and duplicate windows", () => {
    expect(() => commitFlow(hasher, [{ window: FLOW_WINDOWS, buy: 1n, sell: 1n }])).toThrow(RangeError);
    expect(() => commitFlow(hasher, [
      { window: 3, buy: 1n, sell: 1n }, { window: 3, buy: 2n, sell: 2n },
    ])).toThrow(/duplicate/);
  });
});

describe("dense band series + fixed-depth band tree (H1 circuit layout)", () => {
  const poseidon = new PoseidonHasher();

  it("band paths are always BAND_TREE_DEPTH long, even with fewer bands", () => {
    for (const bands of [[100], [50, 100], BANDS]) {
      const root = commitDepth(hasher, buckets.map((b) => ({ ...b, perBand: b.perBand.filter((p) => bands.includes(p.bandBps)) })), bands);
      const o = openBand(hasher, buckets, bands, 100);
      expect(o.path.length).toBe(BAND_TREE_DEPTH);
      expect(verifyBandOpening(hasher, root, o)).toBe(true);
    }
  });

  it("rejects more bands than the fixed tree holds", () => {
    expect(() => commitDepth(hasher, [], [1, 2, 3, 4, 5])).toThrow(/exceed depth/);
  });

  it("dense encoding: an explicit zero bucket and a missing bucket give the same leaf", () => {
    const sparse = [{ bucket: 3, minBid: 5n, minAsk: 6n }];
    const withZero = [...sparse, { bucket: 9, minBid: 0n, minAsk: 0n }];
    expect(digestToHex(bandSeriesLeaf(hasher, 100, sparse))).toBe(digestToHex(bandSeriesLeaf(hasher, 100, withZero)));
    const d = denseBandSeries(sparse);
    expect(d.bid.length).toBe(BAND_SERIES_BUCKETS);
    expect([d.bid[3], d.ask[3], d.bid[0]]).toEqual([5n, 6n, 0n]);
  });

  it("rejects out-of-range and duplicate buckets", () => {
    expect(() => denseBandSeries([{ bucket: BAND_SERIES_BUCKETS, minBid: 1n, minAsk: 1n }])).toThrow(RangeError);
    expect(() => denseBandSeries([
      { bucket: 1, minBid: 1n, minAsk: 1n }, { bucket: 1, minBid: 2n, minAsk: 2n },
    ])).toThrow(/duplicate/);
  });

  it("PoseidonHasher commits and opens depth (padded band tree) and flow", () => {
    const root = commitDepth(poseidon, buckets, [50, 100, 200]); // one padded position
    expect(verifyBandOpening(poseidon, root, openBand(poseidon, buckets, [50, 100, 200], 200))).toBe(true);
    const w: FlowWindowSample[] = [
      { window: 0, buy: 5n, sell: 7n }, { window: 1, buy: 9n, sell: 2n }, { window: 4, buy: 1n, sell: 1n },
    ];
    expect(verifyFlowOpening(poseidon, commitFlow(poseidon, w), openFlow(w))).toBe(true);
  });
});
