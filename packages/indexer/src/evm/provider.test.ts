import { describe, it, expect } from "vitest";
import { UniswapV3ChainProvider, NotImplementedError, uniswapV3Provider } from "./provider.js";
import { resolveChain } from "../chains.js";
import type { BlockHeader, EvmRpc, LogFilter, RpcLog } from "./rpc.js";

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

  it("stages discovery + activity behind a typed error (no fabricated data)", async () => {
    const p = new UniswapV3ChainProvider(resolveChain(1), new FakeRpc());
    const range = { epoch: 1, startBlock: 0, endBlock: 1, endBlockHash: "0x", startTs: 0, endTs: 1 };
    const pool = { poolAddr: 0n, token0: 0n, token1: 0n, liquidity: 0n, dex: "uniswap-v3" as const };
    await expect(p.poolsAboveFloor(0n, 1)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(p.poolActivity(pool, range)).rejects.toBeInstanceOf(NotImplementedError);
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
