// @mmr/dapp — one indexed day, read back from public data.
//
// The daily indexer pins each day's manifest, pool trees and committed series to IPFS
// and stores (chain, day, root, manifest CID) in Postgres. Everything fetched here is
// untrusted: every pool tree is rebuilt from its leaves and must reproduce the root the
// manifest lists, and the root-of-roots over those pools must reproduce the day's root
// (the watcher's check, @mmr/watcher verifyEpoch). Only then is the day used to vote for
// a root or to build a proof.

import {
  type EpochManifest,
  type AddressSeries,
  parsePoolSeries,
} from "@mmr/indexer";
import { type IndexedMerkleTree, RootOfRoots, digestToHex, parseAddr } from "@mmr/merkle";
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import { recomputePoolTree } from "@mmr/watcher";

/** Gateways tried in order; MMR_IPFS_GATEWAY (e.g. a dedicated gateway) goes first. */
function gateways(): string[] {
  const own = process.env.MMR_IPFS_GATEWAY?.replace(/\/+$/, "");
  return [own, "https://gateway.pinata.cloud", "https://ipfs.io", "https://dweb.link"].filter(
    (g): g is string => !!g,
  );
}

/** Fetches content by CID (IPFS gateways in production; an in-memory store in tests). */
export type Fetcher = (cid: string) => Promise<Uint8Array>;

/** Fetch content by CID from the first gateway that serves it. */
export async function fetchIpfs(cid: string): Promise<Uint8Array> {
  if (!/^[A-Za-z0-9]+$/.test(cid)) throw new Error(`not a CID: ${cid}`);
  const errors: string[] = [];
  for (const gw of gateways()) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${gw}/ipfs/${cid}`, { signal: AbortSignal.timeout(60_000) });
        if (res.ok) return new Uint8Array(await res.arrayBuffer());
        errors.push(`${new URL(gw).host}: HTTP ${res.status}`);
        if (res.status === 404 || res.status === 400) break;
      } catch (e) {
        errors.push(`${new URL(gw).host}: ${e instanceof Error ? e.message : String(e)}`);
      }
      await new Promise((r) => setTimeout(r, 2_000 * attempt));
    }
  }
  throw new Error(`could not fetch ${cid}: ${errors.join("; ")}`);
}

export interface PublishedDay {
  readonly chainId: number;
  /** UTC day number (the manifest's epoch). */
  readonly day: number;
  readonly manifestCid: string;
  readonly manifest: EpochManifest;
  /** Rebuilt pool trees, by pool address. */
  readonly trees: ReadonlyMap<bigint, IndexedMerkleTree>;
  readonly ror: RootOfRoots;
  /** The recomputed root-of-roots (0x hex). */
  readonly rootHex: string;
}

export type DayCheck =
  | { ok: true; day: PublishedDay }
  | { ok: false; reason: string; recomputedRootHex?: string };

/**
 * Fetch a day's manifest and pool trees and recompute its root. `ok` only when every
 * pool tree reproduces its listed root, the root-of-roots reproduces the manifest's,
 * and (when given) that equals `expectRootHex` (the root the indexer stored or the
 * committee published).
 */
export async function loadPublishedDay(
  manifestCid: string,
  expectRootHex?: string,
  fetchCid: Fetcher = fetchIpfs,
): Promise<DayCheck> {
  const hasher = new PoseidonHasher();
  const manifest = JSON.parse(new TextDecoder().decode(await fetchCid(manifestCid))) as EpochManifest;
  if (!Number.isInteger(manifest.epoch) || !Array.isArray(manifest.pools)) {
    return { ok: false, reason: "manifest is malformed" };
  }
  const trees = new Map<bigint, IndexedMerkleTree>();
  for (const p of manifest.pools) {
    const { tree, claimedRootHex } = recomputePoolTree(hasher, await fetchCid(p.cid));
    const rebuilt = digestToHex(tree.root);
    if (rebuilt !== p.rootHex || claimedRootHex !== p.rootHex) {
      return { ok: false, reason: `pool ${p.poolAddr}: tree rebuilds to ${rebuilt}, manifest lists ${p.rootHex}` };
    }
    trees.set(parseAddr(p.poolAddr), tree);
  }
  const ror = RootOfRoots.build(
    hasher,
    manifest.epoch,
    [...trees].map(([poolAddr, tree]) => ({ poolAddr, poolRoot: tree.root })),
  );
  const rootHex = ror.rootHex();
  if (rootHex !== manifest.rootOfRootsHex) {
    return { ok: false, reason: `root-of-roots rebuilds to ${rootHex}, manifest lists ${manifest.rootOfRootsHex}`, recomputedRootHex: rootHex };
  }
  if (expectRootHex !== undefined && rootHex !== normalizeHex(expectRootHex)) {
    return { ok: false, reason: `published data rebuilds to ${rootHex}, expected ${expectRootHex}`, recomputedRootHex: rootHex };
  }
  return { ok: true, day: { chainId: manifest.chainId, day: manifest.epoch, manifestCid, manifest, trees, ror, rootHex } };
}

/** A pool's committed depth and flow series (its seriesCid document). */
export async function loadSeries(
  day: PublishedDay,
  poolAddr: bigint,
  fetchCid: Fetcher = fetchIpfs,
): Promise<{ bandsBps: number[]; series: Map<bigint, AddressSeries> }> {
  const entry = day.manifest.pools.find((p) => parseAddr(p.poolAddr) === poolAddr);
  if (!entry) throw new Error(`pool 0x${poolAddr.toString(16)} is not in day ${day.day}`);
  if (!entry.seriesCid) throw new Error(`day ${day.day} was indexed before series were published`);
  return parsePoolSeries(await fetchCid(entry.seriesCid));
}

export function normalizeHex(h: string): string {
  return (h.startsWith("0x") ? h : `0x${h}`).toLowerCase();
}
