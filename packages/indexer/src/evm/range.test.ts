import { describe, it, expect } from "vitest";
import { resolveEpochRange, EpochRangeError } from "./range.js";
import type { BlockHeader, EvmRpc, LogFilter, RpcLog, TxReceipt } from "./rpc.js";

/** Blocks every 2 s on odd seconds (as on Base): block n has ts 1 + 2n. */
class Chain implements EvmRpc {
  constructor(private readonly finalized: number) {}
  async chainId(): Promise<number> {
    return 8453;
  }
  async blockNumber(): Promise<number> {
    return this.finalized;
  }
  async finalizedBlockNumber(): Promise<number> {
    return this.finalized;
  }
  async blockHeader(n: number): Promise<BlockHeader> {
    return { number: n, timestamp: 1 + 2 * n, hash: `0x${n.toString(16)}` };
  }
  async transactionReceipt(_hash: string): Promise<TxReceipt> {
    throw new Error("no receipts in this fake");
  }
  async getLogs(_f: LogFilter): Promise<RpcLog[]> {
    return [];
  }
  async call(): Promise<string> {
    return "0x";
  }
}

describe("resolveEpochRange (start = last block ≤ startTs)", () => {
  it("pins both ends to the last block at or before each boundary", async () => {
    const r = await resolveEpochRange(new Chain(10_000), 3, 1000, 2000);
    // block 499 has ts 999 (≤ 1000), block 500 has 1001
    expect(r).toEqual({ epoch: 3, startBlock: 499, endBlock: 999, endBlockHash: "0x3e7", startTs: 1000, endTs: 2000 });
  });

  it("adjacent epochs tile: e's endBlock is e+1's startBlock", async () => {
    const c = new Chain(10_000);
    const a = await resolveEpochRange(c, 1, 0 + 1000, 2000);
    const b = await resolveEpochRange(c, 2, 2000, 3000);
    expect(a.endBlock).toBe(b.startBlock);
  });

  it("refuses an epoch that is not yet behind the finalized head", async () => {
    // finalized block 999 has ts 1999 < endTs
    await expect(resolveEpochRange(new Chain(999), 1, 1000, 2000)).rejects.toThrow(EpochRangeError);
    await expect(resolveEpochRange(new Chain(10_000), 1, 2000, 2000)).rejects.toThrow(/bad epoch window/);
  });
});
