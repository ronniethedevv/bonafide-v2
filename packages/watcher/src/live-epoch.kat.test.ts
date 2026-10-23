// Known-answer test from a live epoch (Unit 3, 2026-10-21 UTC, Base): BROOMY/WETH 0.3%
// indexed end to end by the real ChainProvider, buildEpoch run twice with identical
// roots. The published pool tree and manifest are committed, so this check needs no RPC:
// the watcher must rebuild exactly the attested root from the published data.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import { parseAddr } from "@mmr/merkle";
import { recomputePoolTree, verifyEpoch } from "./recompute.js";

const dir = fileURLToPath(new URL("../fixtures/base-8453-broomy-weth-2026-10-21/", import.meta.url));
const manifest = JSON.parse(readFileSync(dir + "manifest.json", "utf8"));
const tree = readFileSync(dir + "pool-tree.json");

describe("live epoch KAT: Base BROOMY/WETH, 2026-10-21", () => {
  it("pins the range and the attested root", () => {
    expect([manifest.chainId, manifest.epoch, manifest.startBlock, manifest.endBlock]).toEqual([8453, 1, 52875726, 52918926]);
    expect(manifest.endBlockHash).toBe("0xbfa89f75838705788e299c851c25c0b409582204819b786cfa2bad9ceb08334e");
    expect(manifest.rootOfRootsHex).toBe("0x5a3a6373489512ce231856573012a90e45d2bc2720ce5538b92fc74af1d04461");
  });

  it("the published tree rebuilds to its pool root", () => {
    const { tree: t, claimedRootHex } = recomputePoolTree(new PoseidonHasher(), tree);
    expect("0x" + Buffer.from(t.root).toString("hex")).toBe(claimedRootHex);
    expect(claimedRootHex).toBe(manifest.pools[0].rootHex);
    expect(t.size).toBe(manifest.pools[0].leafCount);
  });

  it("the watcher recomputes the attested root-of-roots", () => {
    const trees = new Map([[parseAddr(manifest.pools[0].poolAddr), new Uint8Array(tree)]]);
    const r = verifyEpoch(new PoseidonHasher(), manifest.epoch, trees, manifest.rootOfRootsHex);
    expect(r).toMatchObject({ ok: true, mismatchedPools: [] });
  });

  it("a one-unit change to any published metric is caught", () => {
    const doc = JSON.parse(tree.toString("utf8"));
    const leaf = doc.leaves.find((l: { addr: string }) => l.addr !== "0");
    leaf.metrics.swapBaseIn = (BigInt(leaf.metrics.swapBaseIn) + 1n).toString();
    const trees = new Map([[parseAddr(manifest.pools[0].poolAddr), new TextEncoder().encode(JSON.stringify(doc))]]);
    expect(verifyEpoch(new PoseidonHasher(), manifest.epoch, trees, manifest.rootOfRootsHex).ok).toBe(false);
  });
});
