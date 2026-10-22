// Minimal ABI decoding for the exact Uniswap v3 / ERC-20 events the indexer reads.
//
// Event layouts are the canonical, fixed ABIs (not assumptions). topic0 values are
// DERIVED here as keccak256 of the event signature (verified against on-chain
// constants in abi.test.ts), so nothing is a hard-coded magic hash. Signed values
// (int256 amounts, int24 ticks) are ABI sign-extended into the full 32-byte word, so
// one 256-bit two's-complement decode covers every signed field.

import { keccak256 } from "./keccak.js";

const WORD = 32;

export function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) throw new Error(`not hex: ${hex}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = "0x";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** keccak256(signature) as a 0x-hex topic0. */
export function eventTopic0(signature: string): string {
  return bytesToHex(keccak256(new TextEncoder().encode(signature)));
}

export const EVENT_SIG = {
  transfer: "Transfer(address,address,uint256)",
  swap: "Swap(address,address,int256,int256,uint160,uint128,int24)",
  mint: "Mint(address,address,int24,int24,uint128,uint256,uint256)",
  burn: "Burn(address,int24,int24,uint128,uint256,uint256)",
  poolCreated: "PoolCreated(address,address,uint24,int24,address)",
  increaseLiquidity: "IncreaseLiquidity(uint256,uint128,uint256,uint256)",
  decreaseLiquidity: "DecreaseLiquidity(uint256,uint128,uint256,uint256)",
} as const;

export const TOPIC0 = {
  transfer: eventTopic0(EVENT_SIG.transfer),
  swap: eventTopic0(EVENT_SIG.swap),
  mint: eventTopic0(EVENT_SIG.mint),
  burn: eventTopic0(EVENT_SIG.burn),
  poolCreated: eventTopic0(EVENT_SIG.poolCreated),
  increaseLiquidity: eventTopic0(EVENT_SIG.increaseLiquidity),
  decreaseLiquidity: eventTopic0(EVENT_SIG.decreaseLiquidity),
} as const;

export function decodeUint(word: Uint8Array): bigint {
  if (word.length !== WORD) throw new Error(`word must be ${WORD} bytes`);
  let v = 0n;
  for (const b of word) v = (v << 8n) | BigInt(b);
  return v;
}

/** Signed 256-bit two's complement — covers int256 and (sign-extended) int24. */
export function decodeInt(word: Uint8Array): bigint {
  const u = decodeUint(word);
  return u >> 255n === 1n ? u - (1n << 256n) : u;
}

/** Address is right-aligned in the 32-byte word; returned lowercase 0x-hex. */
export function decodeAddress(word: Uint8Array): string {
  if (word.length !== WORD) throw new Error(`word must be ${WORD} bytes`);
  return bytesToHex(word.subarray(12)).toLowerCase();
}

export function addressToBigInt(addr: string): bigint {
  return BigInt(addr.startsWith("0x") ? addr : `0x${addr}`);
}

export interface RawLog {
  readonly topics: readonly string[];
  readonly data: string;
}

function dataWords(data: string, expected: number): Uint8Array[] {
  const bytes = hexToBytes(data);
  if (bytes.length !== expected * WORD) {
    throw new Error(`expected ${expected} data words, got ${bytes.length} bytes`);
  }
  const words: Uint8Array[] = [];
  for (let i = 0; i < expected; i++) words.push(bytes.subarray(i * WORD, i * WORD + WORD));
  return words;
}

function topicWord(topic: string): Uint8Array {
  const b = hexToBytes(topic);
  if (b.length !== WORD) throw new Error(`topic must be ${WORD} bytes`);
  return b;
}

function requireTopic0(log: RawLog, topic0: string, name: string): void {
  if ((log.topics[0] ?? "").toLowerCase() !== topic0) throw new Error(`log is not a ${name} event`);
}

export interface SwapEvent {
  readonly sender: string;
  readonly recipient: string;
  readonly amount0: bigint;
  readonly amount1: bigint;
  readonly sqrtPriceX96: bigint;
  readonly liquidity: bigint;
  readonly tick: number;
}

export function decodeSwap(log: RawLog): SwapEvent {
  requireTopic0(log, TOPIC0.swap, "Swap");
  const w = dataWords(log.data, 5);
  return {
    sender: decodeAddress(topicWord(log.topics[1]!)),
    recipient: decodeAddress(topicWord(log.topics[2]!)),
    amount0: decodeInt(w[0]!),
    amount1: decodeInt(w[1]!),
    sqrtPriceX96: decodeUint(w[2]!),
    liquidity: decodeUint(w[3]!),
    tick: Number(decodeInt(w[4]!)),
  };
}

export interface MintEvent {
  readonly owner: string;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly sender: string;
  readonly amount: bigint;
  readonly amount0: bigint;
  readonly amount1: bigint;
}

export function decodeMint(log: RawLog): MintEvent {
  requireTopic0(log, TOPIC0.mint, "Mint");
  const w = dataWords(log.data, 4);
  return {
    owner: decodeAddress(topicWord(log.topics[1]!)),
    tickLower: Number(decodeInt(topicWord(log.topics[2]!))),
    tickUpper: Number(decodeInt(topicWord(log.topics[3]!))),
    sender: decodeAddress(w[0]!),
    amount: decodeUint(w[1]!),
    amount0: decodeUint(w[2]!),
    amount1: decodeUint(w[3]!),
  };
}

export interface BurnEvent {
  readonly owner: string;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly amount: bigint;
  readonly amount0: bigint;
  readonly amount1: bigint;
}

export function decodeBurn(log: RawLog): BurnEvent {
  requireTopic0(log, TOPIC0.burn, "Burn");
  const w = dataWords(log.data, 3);
  return {
    owner: decodeAddress(topicWord(log.topics[1]!)),
    tickLower: Number(decodeInt(topicWord(log.topics[2]!))),
    tickUpper: Number(decodeInt(topicWord(log.topics[3]!))),
    amount: decodeUint(w[0]!),
    amount0: decodeUint(w[1]!),
    amount1: decodeUint(w[2]!),
  };
}

export interface TransferEvent {
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
}

export function decodeTransfer(log: RawLog): TransferEvent {
  requireTopic0(log, TOPIC0.transfer, "Transfer");
  const w = dataWords(log.data, 1);
  return {
    from: decodeAddress(topicWord(log.topics[1]!)),
    to: decodeAddress(topicWord(log.topics[2]!)),
    value: decodeUint(w[0]!),
  };
}

export interface PoolCreatedEvent {
  readonly token0: string;
  readonly token1: string;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly pool: string;
}

export function decodePoolCreated(log: RawLog): PoolCreatedEvent {
  requireTopic0(log, TOPIC0.poolCreated, "PoolCreated");
  const w = dataWords(log.data, 2);
  return {
    token0: decodeAddress(topicWord(log.topics[1]!)),
    token1: decodeAddress(topicWord(log.topics[2]!)),
    fee: Number(decodeUint(topicWord(log.topics[3]!))),
    tickSpacing: Number(decodeInt(w[0]!)),
    pool: decodeAddress(w[1]!),
  };
}

/** Position-manager IncreaseLiquidity / DecreaseLiquidity (tokenId indexed). */
export interface LiquidityChangeEvent {
  readonly tokenId: bigint;
  /** Signed: positive for IncreaseLiquidity, negative for DecreaseLiquidity. */
  readonly liquidityDelta: bigint;
}

export function decodeLiquidityChange(log: RawLog): LiquidityChangeEvent {
  const inc = log.topics[0] === TOPIC0.increaseLiquidity;
  if (!inc) requireTopic0(log, TOPIC0.decreaseLiquidity, "DecreaseLiquidity");
  const w = dataWords(log.data, 3);
  const liquidity = decodeUint(w[0]!);
  return { tokenId: decodeUint(topicWord(log.topics[1]!)), liquidityDelta: inc ? liquidity : -liquidity };
}
