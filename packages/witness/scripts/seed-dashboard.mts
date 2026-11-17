// Seed the app's demo world from REAL @mmr/witness capture output.
//
// Runs the actual capture (I1–I8 oracle + carry-forward chaining) for every in-flight
// engagement of two market makers, each engagement tied to a client, and emits one JSON
// the web app projects BOTH the MM workspace and the client portal from — so the two
// sides of an engagement always show the same epochs, verdicts and figures.
//
// Per-epoch inputs vary deterministically (depth dips in some 30-min buckets, round-trip
// share) so the record looks like a real run, and every committed term matches what the
// UI states (e.g. "min uptime 90% of buckets" is committed as ceil(0.9 × 48) = 44).
//
//   npx tsx packages/witness/scripts/seed-dashboard.mts [outFile]

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CompactHasher } from "@mmr/merkle";
import {
  DEFAULT_CONFIG,
  bucketsPerEpoch,
  type AddressActivity,
  type DepthBucketSample,
  type EpochRange,
} from "@mmr/indexer";
import { createEngagement, type EngagementTerms } from "@mmr/prover";
import { MemoryWitnessStore, captureAndStore, serializeWitness } from "../src/index.js";

const OUT = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../../../apps/web/src/data/world.json"));
const WALLETS = [0x10n, 0x20n];
const SALT = new Uint8Array(32).fill(7);
const BUCKETS = bucketsPerEpoch(DEFAULT_CONFIG); // 48 × 30-min buckets per 24h epoch
const DEPTH_TARGET = 100n; // per side, summed across the MM's wallets

/** Deterministic pseudo-random in [0, 1) from integers (stable fixture). */
function rnd(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) {
    h ^= x + 0x9e3779b9;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 10_000) / 10_000;
}

/** Per-bucket depth for one wallet: 60 normally, 40 in "dipped" buckets (sum 80 < target). */
function depthSeries(dipped: Set<number>): DepthBucketSample[] {
  return Array.from({ length: BUCKETS }, (_, b) => {
    const v = dipped.has(b) ? 40n : 60n;
    return { bucket: b, perBand: DEFAULT_CONFIG.bandsBps.map((bandBps) => ({ bandBps, minBid: v, minAsk: v })) };
  });
}

function activity(
  addr: bigint,
  dipped: Set<number>,
  sell: bigint,
  flow: { xferIn: bigint; xferOut: bigint; fromTreasury: bigint },
): AddressActivity {
  return {
    addr, isProtocol: false, baseStart: 1000n, baseEnd: 800n, quoteEnd: 0n, lpBase: 300n, lpQuote: 0n,
    xferIn: flow.xferIn, xferOut: flow.xferOut, fromTreasury: flow.fromTreasury,
    swapBaseIn: 50n, swapBaseOut: 50n, swapQuoteIn: 0n, swapQuoteOut: 0n,
    depthBuckets: depthSeries(dipped),
    flowWindows: [{ window: 0, buy: 50n, sell }],
    lpFirstActiveBlock: 1,
  };
}

function range(epoch: number, offset: number): EpochRange {
  const base = 1_790_000_000 + offset * 40 * 86_400;
  return {
    epoch, startBlock: 30_000_000 + offset * 300_000 + epoch * 7_200, endBlock: 30_007_200 + offset * 300_000 + epoch * 7_200,
    endBlockHash: `0x${(offset * 1000 + epoch).toString(16).padStart(64, "0")}`,
    startTs: base + (epoch - 1) * 86_400, endTs: base + epoch * 86_400,
  };
}

interface Spec {
  id: string; clientId: string; pair: string; privateLabel: string;
  bondPostedLabel: string; loanLabel: string; depthTargetLabel: string;
  bandBps: number; minUptimePct: number; roundtripCapPct: number; epochsTotal: number;
  captureThrough: number; settledThrough: number; failed: number[];
  loan: bigint; disposalD: bigint; xferOutPerEpoch: bigint;
}

interface MmSpec { handle: string; displayName: string; engagements: Spec[] }

const CLIENTS: Record<string, { name: string }> = {
  orion: { name: "Orion Capital" },
  tidal: { name: "Tidal Fund" },
};

const MMS: MmSpec[] = [
  {
    handle: "vega-mm",
    displayName: "Vega Market Making",
    engagements: [
      {
        id: "rec_07", clientId: "orion", pair: "WETH / USDC", privateLabel: "Orion Capital · WETH book",
        bondPostedLabel: "$120k USDM", loanLabel: "$2.0M", depthTargetLabel: "$250k / side",
        bandBps: 100, minUptimePct: 90, roundtripCapPct: 60, epochsTotal: 30,
        captureThrough: 14, settledThrough: 13, failed: [5],
        loan: 2_000_000n, disposalD: 2_000_000n, xferOutPerEpoch: 87_000n,
      },
      {
        id: "rec_06", clientId: "orion", pair: "cbBTC / USDC", privateLabel: "Orion Capital · cbBTC book",
        bondPostedLabel: "$90k USDM", loanLabel: "$1.5M", depthTargetLabel: "$180k / side",
        bandBps: 100, minUptimePct: 90, roundtripCapPct: 60, epochsTotal: 30,
        captureThrough: 30, settledThrough: 30, failed: [9, 22],
        loan: 1_500_000n, disposalD: 1_600_000n, xferOutPerEpoch: 46_000n,
      },
      {
        id: "rec_08", clientId: "tidal", pair: "DEGEN / WETH", privateLabel: "Tidal Fund · DEGEN launch",
        bondPostedLabel: "$30k USDM", loanLabel: "$300k", depthTargetLabel: "$60k / side",
        bandBps: 200, minUptimePct: 80, roundtripCapPct: 70, epochsTotal: 14,
        captureThrough: 0, settledThrough: 0, failed: [],
        loan: 300_000n, disposalD: 300_000n, xferOutPerEpoch: 9_000n,
      },
    ],
  },
  {
    handle: "helix-lq",
    displayName: "Helix Liquidity",
    engagements: [
      {
        id: "rec_h4", clientId: "tidal", pair: "AERO / USDC", privateLabel: "Tidal Fund · AERO book",
        bondPostedLabel: "$75k USDM", loanLabel: "$1.0M", depthTargetLabel: "$120k / side",
        bandBps: 100, minUptimePct: 85, roundtripCapPct: 65, epochsTotal: 21,
        captureThrough: 9, settledThrough: 8, failed: [3, 7],
        loan: 1_000_000n, disposalD: 1_200_000n, xferOutPerEpoch: 52_000n,
      },
      {
        id: "rec_h5", clientId: "orion", pair: "cbBTC / WETH", privateLabel: "Orion Capital · cbBTC/WETH book",
        bondPostedLabel: "$60k USDM", loanLabel: "$800k", depthTargetLabel: "$90k / side",
        bandBps: 100, minUptimePct: 85, roundtripCapPct: 60, epochsTotal: 14,
        captureThrough: 14, settledThrough: 14, failed: [11],
        loan: 800_000n, disposalD: 900_000n, xferOutPerEpoch: 38_000n,
      },
    ],
  },
];

function capture(spec: Spec, offset: number) {
  const minUptimeBuckets = Math.ceil((spec.minUptimePct / 100) * BUCKETS);
  const terms: EngagementTerms = {
    floorPriceP: 1n, loanL0: spec.loan, quoteStartQ0: 0n, disposalD: spec.disposalD, netSellS: 0n,
    depthTarget: DEPTH_TARGET, roundtripSharePpm: BigInt(spec.roundtripCapPct) * 10_000n,
    bandBps: spec.bandBps, minUptimeBuckets, epochsTotal: spec.epochsTotal,
  };
  const engagement = createEngagement({ id: spec.id, poolAddr: 0xabcdn + BigInt(offset), wallets: WALLETS, salt: SALT, terms });
  const store = new MemoryWitnessStore();
  const hasher = new CompactHasher();
  const failed = new Set(spec.failed);
  const slack = BUCKETS - minUptimeBuckets; // dips a passing epoch can absorb

  for (let e = 1; e <= spec.captureThrough; e++) {
    // How many 30-min buckets dip below the depth target this epoch.
    const dips = failed.has(e)
      ? slack + 5 + Math.floor(rnd(offset, e, 1) * 8) // clearly under the uptime bar
      : Math.floor(rnd(offset, e, 2) * (slack + 1)); // within the allowed slack
    const dipped = new Set<number>();
    for (let k = 0; dipped.size < dips && k < BUCKETS * 4; k++) {
      dipped.add(Math.floor(rnd(offset, e, 3, k) * BUCKETS));
    }
    const sell = 30n + BigInt(Math.floor(rnd(offset, e, 4) * 41)); // round-trip share varies
    const flow = e === 1
      ? { xferIn: spec.loan, xferOut: spec.xferOutPerEpoch, fromTreasury: spec.loan }
      : { xferIn: spec.xferOutPerEpoch, xferOut: spec.xferOutPerEpoch, fromTreasury: 0n };
    const zero = { xferIn: 0n, xferOut: 0n, fromTreasury: 0n };
    captureAndStore(store, {
      hasher, engagement,
      activities: new Map([
        [WALLETS[0]!, activity(WALLETS[0]!, dipped, sell, flow)],
        [WALLETS[1]!, activity(WALLETS[1]!, dipped, sell, zero)],
      ]),
      config: DEFAULT_CONFIG, range: range(e, offset), settled: e <= spec.settledThrough,
      newSalt: new Uint8Array(32).fill(((offset * 31 + e) % 250) + 1), genesisSalt: SALT,
    });
  }

  // Ship only what the app renders: verdicts, sums, carry totals and the public commitment.
  // Wallet members and the carry salt are private to the MM and never leave the capture host.
  const witnesses = store.list(spec.id).map((w) => {
    const { members: _m, carry, capturedAt: _c, ...rest } = JSON.parse(serializeWitness(w));
    const { newSalt: _s, ...publicCarry } = carry;
    return { ...rest, carry: publicCarry };
  });
  return {
    id: spec.id, clientId: spec.clientId, pair: spec.pair, privateLabel: spec.privateLabel,
    bond: { postedLabel: spec.bondPostedLabel, status: "intact", releasedEpochs: 0, totalEpochs: spec.epochsTotal },
    loanLabel: spec.loanLabel, depthTargetLabel: spec.depthTargetLabel, bandBps: spec.bandBps,
    minUptimePct: spec.minUptimePct, minUptimeBuckets, roundtripCapPct: spec.roundtripCapPct,
    epochsTotal: spec.epochsTotal, disposalD: spec.disposalD.toString(),
    witnesses,
  };
}

let offset = 0;
const world = {
  generatedAt: new Date().toISOString(),
  note: "Produced by packages/witness/scripts/seed-dashboard.mts — every witness is real @mmr/witness capture output.",
  clients: CLIENTS,
  workspaces: MMS.map((mm) => ({
    handle: mm.handle,
    displayName: mm.displayName,
    engagements: mm.engagements.map((s) => capture(s, offset++)),
  })),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(world, null, 1) + "\n");
let total = 0;
for (const ws of world.workspaces) {
  for (const e of ws.engagements) {
    total += e.witnesses.length;
    const met = e.witnesses.filter((w: { settled: boolean; invariants: Record<string, boolean> }) =>
      w.settled && Object.entries(w.invariants).every(([k, v]) => k === "I8_settled" || v)).length;
    const ups = e.witnesses.map((w: { uptimeBuckets: number }) => w.uptimeBuckets);
    process.stdout.write(
      `  ${ws.handle} ${e.id} ${e.pair} (client ${e.clientId}): ${e.witnesses.length}/${e.epochsTotal} captured, ` +
        `${met} settled+met, uptime buckets ${ups.length ? `${Math.min(...ups)}–${Math.max(...ups)}` : "—"} (need ${e.minUptimeBuckets})\n`,
    );
  }
}
process.stdout.write(`wrote ${total} real epoch witnesses → ${OUT}\n`);
