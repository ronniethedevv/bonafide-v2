// Batched eth_call through Multicall3 (deployed at the same address on Base and
// Ethereum; checked live via getBlockNumber()). Uses `aggregate`, which reverts if any
// inner call fails, so a bad read fails loudly instead of yielding a partial batch. Every
// batch runs at one pinned block and must report that block back.

import { keccak256 } from "./keccak.js";
import { bytesToHex, hexToBytes } from "./abi.js";
import type { EvmRpc } from "./rpc.js";

export const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";

/** Calls per eth_call; keeps request/response size and gas well inside node limits. */
const BATCH = 200;

/** 4-byte function selector: keccak256(signature)[0..4] as 0x-hex. */
export function selector(signature: string): string {
  return bytesToHex(keccak256(new TextEncoder().encode(signature)).subarray(0, 4));
}

export const SELECTOR = {
  aggregate: selector("aggregate((address,bytes)[])"),
  getPool: selector("getPool(address,address,uint24)"),
  liquidity: selector("liquidity()"),
  slot0: selector("slot0()"),
  token0: selector("token0()"),
  token1: selector("token1()"),
  quoteExactInputSingle: selector("quoteExactInputSingle((address,address,uint256,uint24,uint160))"),
  quoteExactOutputSingle: selector("quoteExactOutputSingle((address,address,uint256,uint24,uint160))"),
} as const;

export interface Call {
  readonly target: string;
  /** 0x-hex calldata. */
  readonly data: string;
}

export class MulticallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MulticallError";
  }
}

const word = (v: bigint): string => v.toString(16).padStart(64, "0");
const pad32 = (hex: string): string => hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");

/** ABI-encode aggregate((address,bytes)[]) calldata. */
export function encodeAggregate(calls: readonly Call[]): string {
  const tuples = calls.map((c) => {
    const data = hexToBytes(c.data);
    const target = hexToBytes(c.target);
    if (target.length !== 20) throw new MulticallError(`bad call target ${c.target}`);
    // (address, bytes): address word, offset of bytes (0x40), bytes length, bytes padded
    return word(BigInt(c.target)) + word(0x40n) + word(BigInt(data.length)) + pad32(c.data.slice(2));
  });
  let offsets = "";
  let at = 32n * BigInt(calls.length);
  for (const t of tuples) {
    offsets += word(at);
    at += BigInt(t.length / 2);
  }
  return `${SELECTOR.aggregate}${word(0x20n)}${word(BigInt(calls.length))}${offsets}${tuples.join("")}`;
}

/** Decode aggregate's (uint256 blockNumber, bytes[] returnData). */
export function decodeAggregate(hex: string): { blockNumber: bigint; returnData: string[] } {
  const b = hexToBytes(hex);
  const read = (at: number): bigint => {
    if (at + 32 > b.length) throw new MulticallError("short aggregate return data");
    let v = 0n;
    for (let i = at; i < at + 32; i++) v = (v << 8n) | BigInt(b[i]!);
    return v;
  };
  const blockNumber = read(0);
  const arr = Number(read(32));
  const n = Number(read(arr));
  const base = arr + 32;
  const returnData: string[] = [];
  for (let i = 0; i < n; i++) {
    const at = base + Number(read(base + 32 * i));
    const len = Number(read(at));
    if (at + 32 + len > b.length) throw new MulticallError("short aggregate return data");
    returnData.push(bytesToHex(b.subarray(at + 32, at + 32 + len)));
  }
  return { blockNumber, returnData };
}

/** Run `calls` at `block` in batches; results are in call order. */
export async function multicall(rpc: EvmRpc, calls: readonly Call[], block: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < calls.length; i += BATCH) {
    const chunk = calls.slice(i, i + BATCH);
    const res = decodeAggregate(await rpc.call(MULTICALL3, encodeAggregate(chunk), block));
    if (res.blockNumber !== BigInt(block)) {
      throw new MulticallError(`multicall ran at block ${res.blockNumber}, expected ${block}`);
    }
    if (res.returnData.length !== chunk.length) {
      throw new MulticallError(`multicall returned ${res.returnData.length} results for ${chunk.length} calls`);
    }
    out.push(...res.returnData);
  }
  return out;
}

const AGGREGATE3 = selector("aggregate3((address,bool,bytes)[])");
const GET_BLOCK_NUMBER = selector("getBlockNumber()");

/** ABI-encode aggregate3((address,bool,bytes)[]) with allowFailure = true for every call. */
export function encodeAggregate3(calls: readonly Call[]): string {
  const tuples = calls.map((c) => {
    const data = hexToBytes(c.data);
    if (hexToBytes(c.target).length !== 20) throw new MulticallError(`bad call target ${c.target}`);
    return word(BigInt(c.target)) + word(1n) + word(0x60n) + word(BigInt(data.length)) + pad32(c.data.slice(2));
  });
  let offsets = "";
  let at = 32n * BigInt(calls.length);
  for (const t of tuples) {
    offsets += word(at);
    at += BigInt(t.length / 2);
  }
  return `${AGGREGATE3}${word(0x20n)}${word(BigInt(calls.length))}${offsets}${tuples.join("")}`;
}

/** Decode aggregate3's (bool success, bytes returnData)[]. */
export function decodeAggregate3(hex: string): { success: boolean; returnData: string }[] {
  const b = hexToBytes(hex);
  const read = (at: number): bigint => {
    if (at + 32 > b.length) throw new MulticallError("short aggregate3 return data");
    let v = 0n;
    for (let i = at; i < at + 32; i++) v = (v << 8n) | BigInt(b[i]!);
    return v;
  };
  const arr = Number(read(0));
  const n = Number(read(arr));
  const base = arr + 32;
  const out: { success: boolean; returnData: string }[] = [];
  for (let i = 0; i < n; i++) {
    const t = base + Number(read(base + 32 * i));
    const at = t + Number(read(t + 32));
    const len = Number(read(at));
    if (at + 32 + len > b.length) throw new MulticallError("short aggregate3 return data");
    out.push({ success: read(t) === 1n, returnData: bytesToHex(b.subarray(at + 32, at + 32 + len)) });
  }
  return out;
}

/**
 * Like `multicall`, but a failing call yields null instead of reverting the batch
 * (e.g. positions() of a burned NFT). Each batch leads with getBlockNumber(), which
 * must report the pinned block. Batches run with bounded concurrency.
 */
export async function multicallTry(
  rpc: EvmRpc,
  calls: readonly Call[],
  block: number,
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(calls.length);
  const starts: number[] = [];
  for (let i = 0; i < calls.length; i += BATCH) starts.push(i);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < starts.length) {
      const i = starts[next++]!;
      const chunk = calls.slice(i, i + BATCH);
      const res = decodeAggregate3(
        await rpc.call(MULTICALL3, encodeAggregate3([{ target: MULTICALL3, data: GET_BLOCK_NUMBER }, ...chunk]), block),
      );
      if (res.length !== chunk.length + 1 || !res[0]!.success || BigInt(res[0]!.returnData) !== BigInt(block)) {
        throw new MulticallError(`aggregate3 batch did not run at block ${block}`);
      }
      res.slice(1).forEach((r, j) => (out[i + j] = r.success ? r.returnData : null));
      opts.onProgress?.(++done, starts.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 1, starts.length) }, worker));
  return out;
}
