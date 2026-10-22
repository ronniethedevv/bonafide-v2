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
