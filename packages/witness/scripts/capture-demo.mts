// Witness-capture demo: run several epochs of a market maker's activity through the
// local witness store and print the running carry-forward ledger + coverage. In
// production the per-epoch `activities` come from the Base/Ethereum archive-RPC reader
// (the MM filtering the public index to their own committed wallets); here they are
// synthetic so the loop is exercised without a chain.
//
//   npx tsx packages/witness/scripts/capture-demo.mts [epochs] [outDir]

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompactHasher } from "@mmr/merkle";
import {
  DEFAULT_CONFIG,
  bucketsPerEpoch,
  type AddressActivity,
  type DepthBucketSample,
  type EpochRange,
} from "@mmr/indexer";
import { createEngagement, type EngagementTerms } from "@mmr/prover";
import { FsWitnessStore, captureAndStore, witnessCoverage } from "../src/index.js";

const epochs = Number(process.argv[2] ?? 4);
const outDir = process.argv[3] ?? mkdtempSync(join(tmpdir(), "mmr-witness-"));

const WALLETS = [0x10n, 0x20n];
const SALT = new Uint8Array(32).fill(7);
const terms: EngagementTerms = {
  floorPriceP: 1n, loanL0: 1000n, quoteStartQ0: 0n, disposalD: 0n, netSellS: 0n,
  depthTarget: 100n, roundtripSharePpm: 600_000n, bandBps: 100,
  minUptimeBuckets: bucketsPerEpoch(DEFAULT_CONFIG), epochsTotal: 30,
};
const engagement = createEngagement({ id: "eng-demo", poolAddr: 0xabcdn, wallets: WALLETS, salt: SALT, terms });

function fullDepth(v: bigint): DepthBucketSample[] {
  return Array.from({ length: bucketsPerEpoch(DEFAULT_CONFIG) }, (_, b) => ({
    bucket: b, perBand: DEFAULT_CONFIG.bandsBps.map((bandBps) => ({ bandBps, minBid: v, minAsk: v })),
  }));
}
function activity(addr: bigint, depth: bigint): AddressActivity {
  return {
    addr, isProtocol: false, baseStart: 1000n, baseEnd: 800n, quoteEnd: 0n, lpBase: 300n, lpQuote: 0n,
    xferIn: 1000n, xferOut: 0n, fromTreasury: 1000n, swapBaseIn: 50n, swapBaseOut: 50n,
    swapQuoteIn: 0n, swapQuoteOut: 0n, depthBuckets: fullDepth(depth),
    flowWindows: [{ window: 0, buy: 50n, sell: 50n }], lpFirstActiveTs: 1,
  };
}
function range(epoch: number): EpochRange {
  return {
    epoch, startBlock: 900_000 + epoch * 1000, endBlock: 901_000 + epoch * 1000,
    endBlockHash: `0xdemo${epoch}`, startTs: 1_000_000 + epoch * 86_400, endTs: 1_086_400 + epoch * 86_400,
  };
}

const store = new FsWitnessStore(outDir);
const hasher = new CompactHasher();
process.stdout.write(`capturing ${epochs} epoch(s) for ${engagement.id} → ${outDir}\n\n`);
for (let e = 1; e <= epochs; e++) {
  // epoch 3 under-quotes (depth 40 per wallet → 80 < target 100): fails uptime
  const depth = e === 3 ? 40n : 60n;
  const w = captureAndStore(store, {
    hasher, engagement,
    activities: new Map(WALLETS.map((a) => [a, activity(a, depth)] as const)),
    config: DEFAULT_CONFIG, range: range(e), settled: true,
    newSalt: new Uint8Array(32).fill(e), genesisSalt: SALT,
  });
  process.stdout.write(
    `  epoch ${e}: pass=${w.pass} uptime=${w.uptimeBuckets}/${w.totalBuckets} ` +
      `carry(in/out/treasury)=${w.carry.newTotals.xferIn}/${w.carry.newTotals.xferOut}/${w.carry.newTotals.fromTreasury} ` +
      `carryOk=${w.carry.ok}\n`,
  );
}

const cov = witnessCoverage(store, engagement.id, terms.epochsTotal);
process.stdout.write(
  `\ncoverage: ${cov.present}/${cov.epochsTotal} captured, ${cov.passed} passed, ` +
    `${cov.missing.length} not yet captured (contiguous=${cov.contiguous})\n`,
);
