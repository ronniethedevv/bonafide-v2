import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePosition, emptyRegistry, loadRegistry, poolKeyId, saveRegistry, scanRegistry, SEL_NPM } from "./positions.js";
import { MulticallFake } from "./multicall.fake.js";

const NPM = "0x03a520b32c04bf3beef7beb72e919cf822ed34f1";
const w = (v: bigint): string => (v < 0n ? (1n << 256n) + v : v).toString(16).padStart(64, "0");
const position = (t0: bigint, t1: bigint, fee: number, tl: number, tu: number, L: bigint): string =>
  `0x${w(1n)}${w(0n)}${w(t0)}${w(t1)}${w(BigInt(fee))}${w(BigInt(tl))}${w(BigInt(tu))}${w(L)}${w(0n).repeat(4)}`;

/** Ids 1..minted exist except burned ones; even ids are in pool A, odd in pool B. */
function chain(minted: number, burned: Set<number>) {
  return new MulticallFake((c) => {
    if (!c.data.startsWith(SEL_NPM.positions)) throw new Error("unexpected");
    const id = Number(BigInt(`0x${c.data.slice(10)}`));
    if (id > minted || burned.has(id)) throw new Error("Invalid token ID");
    return id % 2 === 0 ? position(1n, 2n, 500, -60 - id, 60, 7n) : position(1n, 3n, 500, -60, 60, 7n);
  });
}
const A = poolKeyId(1n, 2n, 500);

describe("position registry (DD-24)", () => {
  it("decodes positions() including negative ticks", () => {
    expect(decodePosition(position(1n, 2n, 3000, -887220, 887220, 5n))).toEqual({ key: poolKeyId(1n, 2n, 3000), tickLower: -887220, tickUpper: 887220, liquidity: 5n });
  });

  it("keeps only the wanted pool's ids, skips burned ids, and stops past the last mint", async () => {
    const reg = emptyRegistry(NPM, [A]);
    await scanRegistry(chain(2_500, new Set([4, 6])), reg, 100, { roundIds: 1_000 });
    const ids = reg.byPool.get(A)!.map((p) => Number(p.tokenId));
    expect(ids.length).toBe(1_250 - 2);
    expect(ids.includes(4) || ids.includes(6)).toBe(false);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect([reg.scannedUpTo, reg.scannedAt]).toEqual([2_500n, 100]);
    expect(reg.byPool.get(A)![0]).toEqual({ tokenId: 2n, tickLower: -62, tickUpper: 60 });
  });

  it("extends from scannedUpTo without rescanning", async () => {
    const reg = emptyRegistry(NPM, [A]);
    await scanRegistry(chain(1_000, new Set()), reg, 100, { roundIds: 400 });
    const rpc = chain(1_300, new Set());
    await scanRegistry(rpc, reg, 200, { roundIds: 400 });
    expect(reg.scannedUpTo).toBe(1_300n);
    expect(reg.byPool.get(A)!.length).toBe(650);
    expect(rpc.batches).toBeLessThanOrEqual(6); // ids 1001..1800 only, at 200 per batch (+ a final empty round)
  });

  it("round-trips through the cache and reuses a cache that covers the requested pools", async () => {
    const reg = emptyRegistry(NPM, [A, poolKeyId(1n, 3n, 500)]);
    await scanRegistry(chain(300, new Set()), reg, 100, { roundIds: 200 });
    const path = join(mkdtempSync(join(tmpdir(), "reg-")), "r.json");
    saveRegistry(path, reg);
    const back = loadRegistry(path, NPM, [A]);
    expect(back.scannedUpTo).toBe(300n);
    expect(back.byPool.get(A)).toEqual(reg.byPool.get(A));
    // a pool the cache never kept forces an empty registry over the union
    const wider = loadRegistry(path, NPM, [poolKeyId(9n, 10n, 100)]);
    expect([wider.scannedUpTo, wider.pools.length]).toEqual([0n, 3]);
    expect(loadRegistry(path, "0xother", [A]).scannedUpTo).toBe(0n);
  });
});
