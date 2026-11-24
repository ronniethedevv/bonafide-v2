// The published source: each day as the daily indexer published it, checked against the
// root the attesters put on Midnight. No RPC key is needed. The engagement's start day and
// each day's root and manifest come from the contract's public state; the day's trees and
// series come from IPFS and must rebuild that root. A committed wallet's activity is then
// read back from its leaf (its metrics) and the series it commits to (its depth and flow,
// already past the anti-JIT rule), and both commitments are checked before it is used.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as rt from "@midnight-ntwrk/compact-runtime";
import { ledger } from "@mmr/contracts/epoch_proof";
import { rootKey } from "@mmr/contracts/harness";
import { type Fetcher, fetchIpfs, loadPublishedDay, loadSeries } from "@mmr/dapp/published";
import type { EngagementOpening } from "@mmr/engagement-file";
import { type AddressActivity, commitDepth, commitFlow, seriesOf } from "@mmr/indexer";
import { digestToHex, parseAddr } from "@mmr/merkle";
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import type { ActivitySource, EpochActivity } from "./sources.js";

const DAY = 86_400;

/** One engagement day whose root is on Midnight. */
export interface AttestedDay {
  /** UTC day number. */
  day: number;
  rootHex: string;
  manifestCid: string;
}

/** Finds the attested day behind an epoch of the engagement. */
export type DayLocator = (epoch: number) => Promise<AttestedDay>;

type Ledger = ReturnType<typeof ledger>;

/** The deployed contract this repository's Preview deployment points at. */
export function previewContractAddress(): string {
  const path = createRequire(import.meta.url).resolve("@mmr/dapp/deployments/preview.json");
  return (JSON.parse(readFileSync(path, "utf8")) as { contractAddress: string }).contractAddress;
}

/** The contract's public state, from Midnight's public indexer. */
export async function readContract(
  contractAddress: string = previewContractAddress(),
  indexerUrl: string = process.env.MIDNIGHT_INDEXER_URL ?? "https://indexer.preview.midnight.network/api/v4/graphql",
): Promise<Ledger> {
  const res = await fetch(indexerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: `{ contractAction(address: "${contractAddress}") { state } }` }),
  });
  if (!res.ok) throw new Error(`Midnight indexer: HTTP ${res.status}`);
  const state = ((await res.json()) as { data?: { contractAction?: { state: string } | null } }).data?.contractAction?.state;
  if (!state) throw new Error(`no contract at ${contractAddress}`);
  return ledger(rt.ContractState.deserialize(Uint8Array.from(Buffer.from(state, "hex"))).data);
}

/** Days of the engagement behind `opening`, located through the contract's public state. */
export function chainDays(opening: EngagementOpening, read: () => Promise<Ledger> = () => readContract()): DayLocator {
  const id = rt.persistentHash(new rt.CompactTypeBytes(32), Buffer.from(opening.secrets.engagementSecret.replace(/^0x/, ""), "hex"));
  return async (epoch) => {
    const led = await read();
    if (!led.startDay.member(id)) throw new Error("the engagement is not active on Midnight yet");
    const day = (led.startDay.lookup(id) as bigint) + BigInt(epoch) - 1n;
    const rk = rootKey(led.chainOf.lookup(id) as bigint, day);
    const label = `day ${epoch} (${new Date(Number(day) * DAY * 1000).toISOString().slice(0, 10)})`;
    if (led.disputedRoot.member(rk)) throw new Error(`${label}: its root was disputed, so the day counts for nobody`);
    if (!led.publishedRoot.member(rk)) throw new Error(`${label}: no root is attested on Midnight yet`);
    return {
      day: Number(day),
      rootHex: `0x${Buffer.from(led.publishedRoot.lookup(rk) as Uint8Array).toString("hex")}`,
      manifestCid: new TextDecoder().decode(led.publishedCid.lookup(rk) as Uint8Array).replace(/\0+$/, ""),
    };
  };
}

/** The engagement's activity for each epoch, from the published and attested day. */
export function publishedSource(opening: EngagementOpening, locate: DayLocator = chainDays(opening), fetchCid: Fetcher = fetchIpfs): ActivitySource {
  return {
    name: "published",
    async activity(epoch: number): Promise<EpochActivity> {
      const at = await locate(epoch);
      const check = await loadPublishedDay(at.manifestCid, at.rootHex, fetchCid);
      if (!check.ok) throw new Error(`day ${epoch}: the published data does not rebuild the attested root (${check.reason})`);
      const pool = parseAddr(opening.pool.address);
      const tree = check.day.trees.get(pool);
      if (!tree) throw new Error(`day ${epoch}: pool ${opening.pool.address} is not in the published day`);
      const series = await loadSeries(check.day, pool, fetchCid);
      const hasher = new PoseidonHasher();
      const activities: AddressActivity[] = [];
      for (const w of opening.wallets.map(parseAddr)) {
        if (!tree.has(w)) continue; // no activity in this pool today
        const leaf = tree.membershipProof(w).leaf;
        const s = seriesOf(series.series, w);
        if (digestToHex(commitDepth(hasher, s.depth, series.bandsBps)) !== digestToHex(leaf.depthRoot)
          || digestToHex(commitFlow(hasher, s.flow)) !== digestToHex(leaf.flowRoot)) {
          throw new Error(`day ${epoch}: the published series of 0x${w.toString(16)} does not match its leaf`);
        }
        const m = leaf.metrics;
        activities.push({
          addr: w, isProtocol: leaf.isProtocol,
          baseStart: m.baseStart, baseEnd: m.baseEnd, quoteEnd: m.quoteEnd, lpBase: m.lpBase, lpQuote: m.lpQuote,
          xferIn: m.xferIn, xferOut: m.xferOut, fromTreasury: m.fromTreasury,
          swapBaseIn: m.swapBaseIn, swapBaseOut: m.swapBaseOut, swapQuoteIn: m.swapQuoteIn, swapQuoteOut: m.swapQuoteOut,
          // The committed series is already past the anti-JIT rule, so nothing is held back again.
          depthBuckets: s.depth, flowWindows: s.flow, lpFirstActiveTs: null,
        });
      }
      const mf = check.day.manifest;
      return {
        pool: opening.pool.address,
        activities,
        range: { epoch, startBlock: mf.startBlock, endBlock: mf.endBlock, endBlockHash: mf.endBlockHash, startTs: at.day * DAY, endTs: (at.day + 1) * DAY },
      };
    },
  };
}
