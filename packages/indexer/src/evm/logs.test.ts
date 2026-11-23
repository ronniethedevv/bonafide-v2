import { describe, it, expect } from "vitest";
import { getLogsChunked } from "./logs.js";
import type { BlockHeader, EvmRpc, LogFilter, RpcLog, TxReceipt } from "./rpc.js";

/** One log every 3rd block (two in block multiples of 9), served in shuffled order. */
class LogChain implements EvmRpc {
  readonly requests: [number, number][] = [];
  constructor(private readonly maxSpan = 10) {}
  async chainId(): Promise<number> {
    return 1;
  }
  async blockNumber(): Promise<number> {
    return 0;
  }
  async finalizedBlockNumber(): Promise<number> {
    return 0;
  }
  async blockHeader(n: number): Promise<BlockHeader> {
    return { number: n, timestamp: n, hash: "0x" };
  }
  async call(): Promise<string> {
    return "0x";
  }
  async transactionReceipt(_hash: string): Promise<TxReceipt> {
    throw new Error("no receipts in this fake");
  }
  async getLogs(f: LogFilter): Promise<RpcLog[]> {
    if (f.toBlock - f.fromBlock + 1 > this.maxSpan) throw new Error("range too wide");
    this.requests.push([f.fromBlock, f.toBlock]);
    const out: RpcLog[] = [];
    for (let b = f.fromBlock; b <= f.toBlock; b++) {
      if (b % 3 === 0) out.push(log(b, 0));
      if (b % 9 === 0) out.push(log(b, 1));
    }
    return out.reverse();
  }
}
const log = (blockNumber: number, logIndex: number): RpcLog => ({
  address: "0x1",
  topics: [],
  data: "0x",
  blockNumber,
  logIndex,
  transactionHash: `0x${blockNumber}`,
});

describe("getLogsChunked", () => {
  it("covers the range in ≤10-block chunks with no gap or overlap", async () => {
    const rpc = new LogChain();
    await getLogsChunked(rpc, { fromBlock: 101, toBlock: 245 });
    const sorted = [...rpc.requests].sort((a, b) => a[0] - b[0]);
    expect(sorted[0]![0]).toBe(101);
    expect(sorted.at(-1)![1]).toBe(245);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]![0]).toBe(sorted[i - 1]![1] + 1);
    expect(sorted.every(([a, b]) => b - a + 1 <= 10)).toBe(true);
  });

  it("returns logs sorted by (block, logIndex), independent of chunking and concurrency", async () => {
    const a = await getLogsChunked(new LogChain(), { fromBlock: 0, toBlock: 99 }, { concurrency: 1 });
    const b = await getLogsChunked(new LogChain(100), { fromBlock: 0, toBlock: 99 }, { chunkBlocks: 7, concurrency: 5 });
    expect(a).toEqual(b);
    expect(a.length).toBe(34 + 12);
    for (let i = 1; i < a.length; i++) {
      const [p, q] = [a[i - 1]!, a[i]!];
      expect(p.blockNumber < q.blockNumber || (p.blockNumber === q.blockNumber && p.logIndex < q.logIndex)).toBe(true);
    }
  });

  it("splits a chunk the provider refuses for its range, with the same result", async () => {
    const narrow = new LogChain(10);
    const split = await getLogsChunked(narrow, { fromBlock: 0, toBlock: 99 }, { chunkBlocks: 100 });
    expect(split).toEqual(await getLogsChunked(new LogChain(), { fromBlock: 0, toBlock: 99 }));
    expect(narrow.requests.every(([a, b]) => b - a + 1 <= 10)).toBe(true);
  });

  it("propagates any other failure", async () => {
    const broken = new LogChain();
    broken.getLogs = async () => {
      throw new Error("execution reverted");
    };
    await expect(getLogsChunked(broken, { fromBlock: 0, toBlock: 30 })).rejects.toThrow(/reverted/);
  });
});
