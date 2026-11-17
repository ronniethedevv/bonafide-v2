// Seed real witness data for the web dashboard.
//
// Runs the ACTUAL @mmr/witness capture (I1-I8 oracle + carry-forward chaining) over a few
// engagements and emits a combined JSON the web app reads to drive the MM dashboard — so
// the per-epoch pass/uptime and the running budget shown there are real capture output,
// not hand-authored numbers. Engagement metadata the witnesses don't carry (pair, label,
// bond, formatted targets) sits alongside as a descriptor, standing in for the on-chain
// engagement registry.
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

const OUT = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../../../apps/web/src/data/witness-store.json"));
const WALLETS = [0x10n, 0x20n];
const SALT = new Uint8Array(32).fill(7);
const BUCKETS = bucketsPerEpoch(DEFAULT_CONFIG);

function fullDepth(v: bigint): DepthBucketSample[] {
  return Array.from({ length: BUCKETS }, (_, b) => ({
    bucket: b, perBand: DEFAULT_CONFIG.bandsBps.map((bandBps) => ({ bandBps, minBid: v, minAsk: v })),
  }));
}
function activity(addr: bigint, depth: bigint, flow: { xferIn: bigint; xferOut: bigint; fromTreasury: bigint }): AddressActivity {
  return {
    addr, isProtocol: false, baseStart: 1000n, baseEnd: 800n, quoteEnd: 0n, lpBase: 300n, lpQuote: 0n,
    xferIn: flow.xferIn, xferOut: flow.xferOut, fromTreasury: flow.fromTreasury,
    swapBaseIn: 50n, swapBaseOut: 50n, swapQuoteIn: 0n, swapQuoteOut: 0n,
    depthBuckets: fullDepth(depth), flowWindows: [{ window: 0, buy: 50n, sell: 50n }], lpFirstActiveBlock: 1,
  };
}
function range(epoch: number): EpochRange {
  return {
    epoch, startBlock: 900_000 + epoch * 1000, endBlock: 901_000 + epoch * 1000,
    endBlockHash: `0xseed${epoch}`, startTs: 1_000_000 + epoch * 86_400, endTs: 1_086_400 + epoch * 86_400,
  };
}

interface Spec {
  id: string; pair: string; privateLabel: string;
  bondPostedLabel: string; bondStatus: "intact" | "releasing" | "released" | "slashed"; bondReleasedEpochs: number;
  loanLabel: string; depthTargetLabel: string; bandBps: number; minUptimePct: number; roundtripCapPct: number;
  epochsTotal: number; captureThrough: number; settledThrough: number; failed: number[];
  loan: bigint; disposalD: bigint; xferOutPerEpoch: bigint;
}

const SPECS: Spec[] = [
  {
    id: "rec_07", pair: "WETH / USDC", privateLabel: "Orion desk — WETH pair",
    bondPostedLabel: "$120k USDM", bondStatus: "intact", bondReleasedEpochs: 0,
    loanLabel: "$2.0M", depthTargetLabel: "$250k / side", bandBps: 100, minUptimePct: 90, roundtripCapPct: 60,
    epochsTotal: 30, captureThrough: 14, settledThrough: 13, failed: [5],
    loan: 2_000_000n, disposalD: 2_000_000n, xferOutPerEpoch: 87_000n,
  },
  {
    id: "rec_06", pair: "cbBTC / USDC", privateLabel: "Helix — cbBTC pair",
    bondPostedLabel: "$90k USDM", bondStatus: "intact", bondReleasedEpochs: 0,
    loanLabel: "$1.5M", depthTargetLabel: "$180k / side", bandBps: 100, minUptimePct: 90, roundtripCapPct: 60,
    epochsTotal: 30, captureThrough: 30, settledThrough: 30, failed: [9, 22],
    loan: 1_500_000n, disposalD: 1_600_000n, xferOutPerEpoch: 46_000n,
  },
  {
    id: "rec_08", pair: "DEGEN / WETH", privateLabel: "Nimbus — new desk",
    bondPostedLabel: "$30k USDM", bondStatus: "intact", bondReleasedEpochs: 0,
    loanLabel: "$300k", depthTargetLabel: "$60k / side", bandBps: 200, minUptimePct: 80, roundtripCapPct: 70,
    epochsTotal: 14, captureThrough: 0, settledThrough: 0, failed: [],
    loan: 300_000n, disposalD: 300_000n, xferOutPerEpoch: 9_000n,
  },
];

function capture(spec: Spec) {
  const terms: EngagementTerms = {
    floorPriceP: 1n, loanL0: spec.loan, quoteStartQ0: 0n, disposalD: spec.disposalD, netSellS: 0n,
    depthTarget: 100n, roundtripSharePpm: 600_000n, bandBps: 100, minUptimeBuckets: BUCKETS, epochsTotal: spec.epochsTotal,
  };
  const engagement = createEngagement({ id: spec.id, poolAddr: 0xabcdn, wallets: WALLETS, salt: SALT, terms });
  const store = new MemoryWitnessStore();
  const hasher = new CompactHasher();
  const failed = new Set(spec.failed);
  for (let e = 1; e <= spec.captureThrough; e++) {
    const depth = failed.has(e) ? 40n : 60n; // under-quote on a failed epoch -> I6 fails
    // Flow (loan draw + outflow) is carried by the first wallet only, so the cumulative
    // budget reads cleanly; the second wallet just quotes depth.
    const flow = e === 1
      ? { xferIn: spec.loan, xferOut: spec.xferOutPerEpoch, fromTreasury: spec.loan }
      : { xferIn: spec.xferOutPerEpoch, xferOut: spec.xferOutPerEpoch, fromTreasury: 0n };
    const zero = { xferIn: 0n, xferOut: 0n, fromTreasury: 0n };
    captureAndStore(store, {
      hasher, engagement,
      activities: new Map([
        [WALLETS[0]!, activity(WALLETS[0]!, depth, flow)],
        [WALLETS[1]!, activity(WALLETS[1]!, depth, zero)],
      ]),
      config: DEFAULT_CONFIG, range: range(e), settled: e <= spec.settledThrough,
      newSalt: new Uint8Array(32).fill(e % 251), genesisSalt: SALT,
    });
  }
  const witnesses = store.list(spec.id).map((w) => JSON.parse(serializeWitness(w)));
  return {
    id: spec.id, pair: spec.pair, privateLabel: spec.privateLabel,
    bond: { postedLabel: spec.bondPostedLabel, status: spec.bondStatus, releasedEpochs: spec.bondReleasedEpochs, totalEpochs: spec.epochsTotal },
    loanLabel: spec.loanLabel, depthTargetLabel: spec.depthTargetLabel, bandBps: spec.bandBps,
    minUptimePct: spec.minUptimePct, roundtripCapPct: spec.roundtripCapPct, epochsTotal: spec.epochsTotal,
    disposalD: spec.disposalD.toString(),
    witnesses,
  };
}

const out = {
  handle: "vega-mm",
  displayName: "Vega Market Making",
  generatedAt: new Date().toISOString(),
  engagements: SPECS.map(capture),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
const total = out.engagements.reduce((n, e) => n + e.witnesses.length, 0);
process.stdout.write(`wrote ${out.engagements.length} engagements, ${total} real epoch witnesses → ${OUT}\n`);
for (const e of out.engagements) {
  const passed = e.witnesses.filter((w: { pass: boolean }) => w.pass).length;
  process.stdout.write(`  ${e.id} ${e.pair}: ${e.witnesses.length} captured, ${passed} passed\n`);
}
