import { describe, it, expect } from "vitest";
import { UniswapV3ChainProvider, NotImplementedError, uniswapV3Provider } from "./provider.js";
import { resolveChain } from "../chains.js";
import type { EvmRpc, LogFilter, RpcLog } from "./rpc.js";

class FakeRpc implements EvmRpc {
  constructor(private readonly opts: { chainId?: number; finalized?: number } = {}) {}
  async chainId(): Promise<number> {
    return this.opts.chainId ?? 1;
  }
  async blockNumber(): Promise<number> {
    return 0;
  }
  async finalizedBlockNumber(): Promise<number> {
    return this.opts.finalized ?? 0;
  }
  async getLogs(_filter: LogFilter): Promise<RpcLog[]> {
    return [];
  }
  async call(): Promise<string> {
    return "0x";
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

  it("stages the data-extraction methods behind a typed error (no fabricated data)", async () => {
    const p = new UniswapV3ChainProvider(resolveChain(1), new FakeRpc());
    const range = { epoch: 1, startBlock: 0, endBlock: 1, endBlockHash: "0x", startTs: 0, endTs: 1 };
    const pool = { poolAddr: 0n, token0: 0n, token1: 0n, liquidity: 0n, dex: "uniswap-v3" as const };
    await expect(p.poolsAboveFloor(0n, 1)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(p.poolActivity(pool, range)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(p.poolPriceSamples(pool, range)).rejects.toBeInstanceOf(NotImplementedError);
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
