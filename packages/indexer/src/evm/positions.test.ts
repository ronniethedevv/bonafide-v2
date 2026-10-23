import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePosition, emptyRegistry, loadRegistry, poolKeyId, positionsFromHistory, saveRegistry, scanRegistry, SEL_NPM } from "./positions.js";
import { TOPIC0 } from "./abi.js";
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

describe("positionsFromHistory (DD-25)", () => {
  const POOL = 0x900n;
  const t = (v: bigint): string => `0x${w(v)}`;
  const log = (address: bigint, topics: string[], tx: string) => ({ address: `0x${address.toString(16).padStart(40, "0")}`, topics, transactionHash: tx });
  const MINT = "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde";
  const INC = "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f";
  const npm = BigInt(NPM);
  it("finds NFTs minted into this pool and every direct owner, confirmed on chain", async () => {
    const logs = [
      log(POOL, [MINT, t(npm), t(-60n), t(60n)], "0xa"), log(npm, [INC, t(2n)], "0xa"), // NFT 2 into this pool
      log(npm, [INC, t(3n)], "0xb"), // NFT 3: increase in a tx with no Mint here (another pool)
      log(POOL, [MINT, t(npm), t(-60n), t(60n)], "0xc"), log(npm, [INC, t(5n)], "0xc"), // NFT 5: positions() says another pool
      log(POOL, [MINT, t(0x51c7n), t(-120n), t(120n)], "0xd"), // direct position
    ];
    const res = await positionsFromHistory(chain(10, new Set()), POOL, NPM, A, logs, [100]);
    // chain(): even ids are pool A — 2 is confirmed; 5 is odd (pool B) and is dropped
    expect(res.nfts.map((p) => p.tokenId)).toEqual([2n]);
    expect(res.direct).toEqual([{ owner: 0x51c7n, tickLower: -120, tickUpper: 120 }]);
  });
});

describe("topic constants used by the history test", () => {
  it("match the derived Mint / IncreaseLiquidity topics", () => {
    expect(TOPIC0.mint).toBe("0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde");
    expect(TOPIC0.increaseLiquidity).toBe("0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f");
  });
});
