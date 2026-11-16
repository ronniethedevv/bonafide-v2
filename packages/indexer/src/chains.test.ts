import { describe, it, expect } from "vitest";
import { CHAINS, resolveChain, isSupportedChain } from "./chains.js";

describe("chain registry", () => {
  it("knows Base (8453) and Ethereum (1)", () => {
    expect(resolveChain(1).name).toBe("ethereum");
    expect(resolveChain(8453).name).toBe("base");
    expect(isSupportedChain(1)).toBe(true);
    expect(isSupportedChain(8453)).toBe(true);
    expect(isSupportedChain(137)).toBe(false);
  });

  it("maps each chain to its own RPC env var", () => {
    expect(resolveChain(1).rpcEnvVar).toBe("ETH_ARCHIVE_RPC_URL");
    expect(resolveChain(8453).rpcEnvVar).toBe("BASE_ARCHIVE_RPC_URL");
  });

  it("configures Uniswap v3 on both chains with distinct factories but one init-code hash", () => {
    const eth = resolveChain(1).dexes;
    const base = resolveChain(8453).dexes;
    expect(eth).toHaveLength(1);
    expect(base).toHaveLength(1);
    expect(eth[0]!.kind).toBe("uniswap-v3");
    expect(base[0]!.kind).toBe("uniswap-v3");
    expect(eth[0]!.factory).not.toBe(base[0]!.factory);
    expect(eth[0]!.initCodeHash).toBe(base[0]!.initCodeHash);
  });

  it("stores factory addresses lowercase for case-insensitive compares", () => {
    for (const cfg of Object.values(CHAINS)) {
      for (const dex of cfg.dexes) {
        expect(dex.factory).toBe(dex.factory.toLowerCase());
        expect(dex.factory).toMatch(/^0x[0-9a-f]{40}$/);
      }
    }
  });

  it("throws on an unsupported chain", () => {
    expect(() => resolveChain(137)).toThrow(/unsupported chainId 137/);
  });
});
