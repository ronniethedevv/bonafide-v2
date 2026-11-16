import { describe, it, expect } from "vitest";
import { UniswapV3ChainProvider, uniswapV3Provider } from "./provider.js";
import { resolveChain } from "../chains.js";
import type { BlockHeader, EvmRpc, LogFilter, RpcLog, TxReceipt } from "./rpc.js";
import { MulticallFake } from "./multicall.fake.js";
import { SELECTOR, type Call } from "./multicall.js";
import { FEE_TIERS, computePoolAddress, sortTokens } from "./pool.js";

const hexWord = (x: bigint): string => x.toString(16).padStart(64, "0");

/** A fake pool: 2-second blocks from `t0`, slot0's sqrtPriceX96 = sqrt(n) per block. */
interface FakePool {
  readonly addr: string;
  readonly token0: bigint;
  readonly token1: bigint;
  readonly t0: number;
  readonly sqrtAt: (block: number) => bigint;
}

class FakeRpc implements EvmRpc {
  readonly calls: { to: string; data: string; block: number }[] = [];
  constructor(
    private readonly opts: { chainId?: number; finalized?: number; pool?: FakePool } = {},
  ) {}
  async chainId(): Promise<number> {
    return this.opts.chainId ?? 1;
  }
  async blockNumber(): Promise<number> {
    return 0;
  }
  async finalizedBlockNumber(): Promise<number> {
    return this.opts.finalized ?? 0;
  }
  async blockHeader(n: number): Promise<BlockHeader> {
    return { number: n, timestamp: (this.opts.pool?.t0 ?? 0) + 2 * n, hash: `0x${n.toString(16)}` };
  }
  async transactionReceipt(_hash: string): Promise<TxReceipt> {
    throw new Error("no receipts in this fake");
  }
  async getLogs(_filter: LogFilter): Promise<RpcLog[]> {
    return [];
  }
  async call(to: string, data: string, block: number): Promise<string> {
    this.calls.push({ to, data, block });
    const pool = this.opts.pool;
    if (!pool || to !== pool.addr) return "0x";
    if (data === "0x0dfe1681") return `0x${hexWord(pool.token0)}`;
    if (data === "0xd21220a7") return `0x${hexWord(pool.token1)}`;
    if (data === "0x3850c7bd") return `0x${hexWord(pool.sqrtAt(block))}${hexWord(0n).repeat(6)}`;
    throw new Error(`unexpected call ${data}`);
  }
}

describe("UniswapV3ChainProvider", () => {
  it("reports the configured chain id (Base and Ethereum)", () => {
    expect(new UniswapV3ChainProvider(resolveChain(1), new FakeRpc()).chainId()).toBe(1);
    expect(new UniswapV3ChainProvider(resolveChain(8453), new FakeRpc()).chainId()).toBe(8453);
  });

  it("returns the node's finalized height", async () => {
    const p = new UniswapV3ChainProvider(resolveChain(8453), new FakeRpc({ finalized: 42 }));
    expect(await p.finalizedBlock()).toBe(42);
  });

  it("assertChainId passes when the node matches and throws when it doesn't", async () => {
    const ok = new UniswapV3ChainProvider(resolveChain(1), new FakeRpc({ chainId: 1 }));
    await expect(ok.assertChainId()).resolves.toBeUndefined();
    const wrong = new UniswapV3ChainProvider(resolveChain(1), new FakeRpc({ chainId: 8453 }));
    await expect(wrong.assertChainId()).rejects.toThrow(/does not match configured 1/);
  });

});

describe("UniswapV3ChainProvider.poolPriceSamples", () => {
  const WETH = 0x4200000000000000000000000000000000000006n;
  const USDC = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n;
  const POOL = 0xd0b53d9277642d899df5c87a3966a349a798f224n;
  const fake = (over: Partial<FakePool> = {}) =>
    new FakeRpc({
      pool: {
        addr: "0xd0b53d9277642d899df5c87a3966a349a798f224",
        token0: WETH,
        token1: USDC,
        t0: 1001, // blocks land on odd seconds, as on Base
        sqrtAt: (b) => (1n << 96n) * BigInt(b + 1),
        ...over,
      },
    });
  const pool = { poolAddr: POOL, token0: WETH, token1: USDC, liquidity: 0n, dex: "uniswap-v3" as const };
  // blocks 0..1800 span ts 1001..4601; the epoch is [1000, 4600]
  const range = { epoch: 1, startBlock: 0, endBlock: 1799, endBlockHash: "0x", startTs: 1000, endTs: 4600 };

  const times = [1000, 1900, 2800, 3700, 4600];

  it("reads slot0 at the last block at or before each sample time, oriented and Q96", async () => {
    const rpc = fake();
    const p = new UniswapV3ChainProvider(resolveChain(8453), rpc);
    const samples = await p.poolPriceSamples(pool, range, times);
    // ts 1000 precedes block 0 (ts 1001): not sampled. 1900 -> block 449 (ts 1899), etc.
    const blocks = [449, 899, 1349, 1799];
    expect(samples.map((s) => s.ts)).toEqual([1900, 2800, 3700, 4600]);
    // base = WETH = token0: price = sqrtP^2 >> 96 = (b+1)^2 << 96
    expect(samples.map((s) => s.price)).toEqual(blocks.map((b) => BigInt(b + 1) ** 2n << 96n));
    const slot0Blocks = rpc.calls.filter((c) => c.data === "0x3850c7bd").map((c) => c.block);
    expect(slot0Blocks).toEqual(blocks);
  });

  it("is deterministic across provider instances", async () => {
    const a = await new UniswapV3ChainProvider(resolveChain(8453), fake()).poolPriceSamples(pool, range, times);
    const b = await new UniswapV3ChainProvider(resolveChain(8453), fake()).poolPriceSamples(pool, range, times);
    expect(a).toEqual(b);
  });

  it("fails loudly when the descriptor's tokens are not the pool's", async () => {
    const p = new UniswapV3ChainProvider(resolveChain(8453), fake({ token1: WETH + 1n }));
    await expect(p.poolPriceSamples(pool, range, times)).rejects.toThrow(/do not match its descriptor/);
  });

  it("refuses a pool with no quote asset", async () => {
    const odd = { ...pool, token0: 1n, token1: 2n };
    const p = new UniswapV3ChainProvider(resolveChain(8453), fake({ token0: 1n, token1: 2n }));
    await expect(p.poolPriceSamples(odd, range, times)).rejects.toThrow(/no quote asset/);
  });

  it("rejects sample times outside the range or out of order", async () => {
    const p = new UniswapV3ChainProvider(resolveChain(8453), fake());
    for (const bad of [[999], [4601], [2000, 2000], [3000, 2000]]) {
      await expect(p.poolPriceSamples(pool, range, bad)).rejects.toThrow(/ascend strictly/);
    }
  });

  it("refuses an uninitialized pool", async () => {
    const p = new UniswapV3ChainProvider(resolveChain(8453), fake({ sqrtAt: () => 0n }));
    await expect(p.poolPriceSamples(pool, range, times)).rejects.toThrow(/not initialized/);
  });
});

describe("uniswapV3Provider factory", () => {
  it("builds from an env RPC url for a supported chain", () => {
    const p = uniswapV3Provider(8453, { env: { BASE_ARCHIVE_RPC_URL: "https://base.example" } });
    expect(p.chainId()).toBe(8453);
  });

  it("throws when the chain's RPC env var is unset", () => {
    expect(() => uniswapV3Provider(1, { env: {} })).toThrow(/ETH_ARCHIVE_RPC_URL is not set/);
  });

  it("throws on an unsupported chain", () => {
    expect(() => uniswapV3Provider(137, { env: {} })).toThrow(/unsupported chainId 137/);
  });
});

describe("UniswapV3ChainProvider.poolsAboveFloor (DD-21 pair enumeration)", () => {
  const base = resolveChain(8453);
  const dex = base.dexes[0]!;
  const CBBTC = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
  const USDC = base.quoteAssets[0]!;
  const WETH = base.quoteAssets[2]!;
  const at = (q: string, fee: number) => computePoolAddress(dex.factory, { tokenA: CBBTC, tokenB: q, fee }, dex.initCodeHash);
  const word = (v: bigint) => `0x${v.toString(16).padStart(64, "0")}`;
  const NO_FLOOR = { bandBps: 200, minQuote: {} };
  const QUOTED = new Map([
    [at(USDC, 500), { bid: 900n, ask: 1000n }],
    [at(USDC, 3000), { bid: 50n, ask: 60n }],
  ]);

  /** cbBTC/USDC exists at 500 and 3000, cbBTC/WETH at 3000 (uninitialized); nothing else. */
  function chain(over: { getPool?: (addr: string) => string } = {}) {
    const deployed = new Map<string, { liquidity: bigint; sqrt: bigint }>([
      [at(USDC, 500), { liquidity: 2_000n, sqrt: 1n << 96n }],
      [at(USDC, 3000), { liquidity: 10n, sqrt: 1n << 96n }],
      [at(WETH, 3000), { liquidity: 0n, sqrt: 0n }],
    ]);
    const seen: Call[] = [];
    const rpc = new MulticallFake((c) => {
      seen.push(c);
      if (c.data.startsWith(SELECTOR.getPool)) {
        const w = (i: number) => BigInt(`0x${c.data.slice(10 + 64 * i, 74 + 64 * i)}`);
        const [t0, t1] = sortTokens(`0x${w(0).toString(16).padStart(40, "0")}`, `0x${w(1).toString(16).padStart(40, "0")}`);
        const addr = computePoolAddress(dex.factory, { tokenA: t0, tokenB: t1, fee: Number(w(2)) }, dex.initCodeHash);
        const real = deployed.has(addr) ? addr : "0x0";
        return word(BigInt(over.getPool ? over.getPool(real) : real));
      }
      if (c.target === dex.quoterV2) {
        // fee word (4th param) identifies the pool in this fake
        const fee = Number(BigInt(`0x${c.data.slice(10 + 64 * 3, 10 + 64 * 4)}`));
        const q = QUOTED.get(at(USDC, fee))!;
        const amount = c.data.startsWith(SELECTOR.quoteExactInputSingle) ? q.bid : q.ask;
        return word(amount) + "0".repeat(64 * 3);
      }
      const pool = deployed.get(c.target)!;
      if (c.data === SELECTOR.liquidity) return word(pool.liquidity);
      if (c.data === SELECTOR.slot0) return word(pool.sqrt) + "0".repeat(64 * 6);
      throw new Error(`unexpected ${c.data}`);
    });
    return { rpc, seen };
  }

  it("enumerates base × quote × fee in one getPool batch and keeps initialized pools ≥ floor", async () => {
    const { rpc, seen } = chain();
    const p = new UniswapV3ChainProvider(base, rpc);
    const pools = await p.poolsAboveFloor(NO_FLOOR, 100, [CBBTC]);
    expect(seen.filter((c) => c.data.startsWith(SELECTOR.getPool)).length).toBe(base.quoteAssets.length * FEE_TIERS.length);
    expect(rpc.batches).toBe(2);
    // the uninitialized cbBTC/WETH pool is dropped; ascending by address
    const want = [at(USDC, 500), at(USDC, 3000)].sort();
    expect(pools.map((x) => `0x${x.poolAddr.toString(16).padStart(40, "0")}`)).toEqual(want);
    const [t0, t1] = sortTokens(CBBTC, USDC);
    expect(pools[0]).toMatchObject({ token0: BigInt(t0), token1: BigInt(t1), dex: "uniswap-v3" });
    // the floor is quote-denominated depth from QuoterV2, per quote asset (DD-23):
    // depth = min(bid, ask net of fee): the 0.05% pool 900, the 0.3% pool min(50, 59) = 50
    const floor = { bandBps: 200, minQuote: { [USDC]: 100n } };
    expect((await p.poolsAboveFloor(floor, 100, [CBBTC])).map((x) => x.liquidity)).toEqual([2_000n]);
    const high = { bandBps: 200, minQuote: { [USDC]: 901n } };
    expect(await p.poolsAboveFloor(high, 100, [CBBTC])).toEqual([]);
    // a floor on another quote asset does not touch USDC pools
    expect((await p.poolsAboveFloor({ bandBps: 200, minQuote: { [WETH]: 10n ** 30n } }, 100, [CBBTC])).length).toBe(2);
  });

  it("finds nothing for no base tokens", async () => {
    expect(await new UniswapV3ChainProvider(base, chain().rpc).poolsAboveFloor(NO_FLOOR, 100, [])).toEqual([]);
  });

  it("fails loudly when the factory's pool is not at its CREATE2 address", async () => {
    const { rpc } = chain({ getPool: (a) => (a === "0x0" ? a : "0x1234") });
    await expect(new UniswapV3ChainProvider(base, rpc).poolsAboveFloor(NO_FLOOR, 100, [CBBTC])).rejects.toThrow(/CREATE2 gives/);
  });

  it("rejects a base token that is a quote asset", async () => {
    await expect(new UniswapV3ChainProvider(base, chain().rpc).poolsAboveFloor(NO_FLOOR, 100, [WETH])).rejects.toThrow(/is a quote asset/);
  });
});
