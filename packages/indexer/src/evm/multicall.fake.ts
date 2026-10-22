// Test support (not exported from the package): a Multicall3-speaking fake EvmRpc
// that decodes real aggregate calldata, so encodeAggregate is exercised end to end.

import { MULTICALL3, SELECTOR, type Call } from "./multicall.js";
import { hexToBytes } from "./abi.js";
import type { BlockHeader, EvmRpc, LogFilter, RpcLog } from "./rpc.js";

export const word = (v: bigint): string => v.toString(16).padStart(64, "0");

/** Decode aggregate((address,bytes)[]) calldata — the inverse of encodeAggregate. */
export function decodeAggregateCalldata(data: string): Call[] {
  if (!data.startsWith(SELECTOR.aggregate)) throw new Error("not aggregate calldata");
  const b = hexToBytes(`0x${data.slice(10)}`);
  const read = (at: number): number => Number(BigInt(`0x${Buffer.from(b.subarray(at, at + 32)).toString("hex")}`));
  const arr = read(0);
  const n = read(arr);
  const base = arr + 32;
  const calls: Call[] = [];
  for (let i = 0; i < n; i++) {
    const t = base + read(base + 32 * i);
    const target = `0x${Buffer.from(b.subarray(t + 12, t + 32)).toString("hex")}`;
    const at = t + read(t + 32);
    const len = read(at);
    calls.push({ target, data: `0x${Buffer.from(b.subarray(at + 32, at + 32 + len)).toString("hex")}` });
  }
  return calls;
}

/** ABI-encode aggregate's (uint256, bytes[]) return. */
export function encodeAggregateReturn(block: bigint, results: readonly string[]): string {
  const bodies = results.map((r) => {
    const hex = r.slice(2);
    return word(BigInt(hex.length / 2)) + hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
  });
  let offsets = "";
  let at = 32n * BigInt(results.length);
  for (const body of bodies) {
    offsets += word(at);
    at += BigInt(body.length / 2);
  }
  return `0x${word(block)}${word(0x40n)}${word(BigInt(results.length))}${offsets}${bodies.join("")}`;
}

/** An EvmRpc whose Multicall3 dispatches inner calls to `inner`. */
export class MulticallFake implements EvmRpc {
  batches = 0;
  constructor(
    private readonly inner: (call: Call, block: number) => string,
    private readonly reportBlock?: number,
  ) {}
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
  async getLogs(_f: LogFilter): Promise<RpcLog[]> {
    return [];
  }
  async call(to: string, data: string, block: number): Promise<string> {
    if (to !== MULTICALL3) return this.inner({ target: to, data }, block);
    this.batches++;
    const calls = decodeAggregateCalldata(data);
    return encodeAggregateReturn(BigInt(this.reportBlock ?? block), calls.map((c) => this.inner(c, block)));
  }
}
