// Known-answer test from a live epoch (Unit 3 cross-chain check, 2026-11-10 UTC, ETHEREUM
// mainnet): a freshly-created Uniswap v3 pool (base 0x6af9…6666 / USDT) indexed end to end
// by the real ChainProvider, buildEpoch run twice with identical roots. The published pool
// tree and manifest are committed, so this check needs no RPC: the watcher must rebuild
// exactly the attested root from the published data. Companion to live-epoch.kat.test.ts
// (Base), proving the pipeline is chain-agnostic.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import { parseAddr } from "@mmr/merkle";
import { recomputePoolTree, verifyEpoch } from "./recompute.js";

const dir = fileURLToPath(new URL("../fixtures/eth-1-0x1de81afe-usdt-2026-11-10/", import.meta.url));
const manifest = JSON.parse(readFileSync(dir + "manifest.json", "utf8"));
const tree = readFileSync(dir + "pool-tree.json");

describe("live epoch KAT: Ethereum pool 0x1de81afe / USDT, 2026-11-10", () => {
  it("pins the range and the attested root", () => {
    expect([manifest.chainId, manifest.epoch, manifest.startBlock, manifest.endBlock]).toEqual([1, 1, 26380783, 26387956]);
    expect(manifest.endBlockHash).toBe("0xf17f3bc21e40276587bc3b418235d7b95d3d22973fb83c5c964c1ac2e0f8057a");
    expect(manifest.rootOfRootsHex).toBe("0xc4f5ae0e40c71a214c8dbfd61a9ccc694b9a001579b0b5886f50df37fe1b2c34");
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
