// Deterministic Uniswap v3 pool address (CREATE2), so pools are located without
// trusting a PoolCreated scan:
//   salt = keccak256(abi.encode(token0, token1, fee))
//   addr = last20( keccak256(0xff ++ factory ++ salt ++ initCodeHash) )
// token0/token1 are sorted ascending, exactly as the factory does. All constants are
// fixed protocol values (see chains.ts); [verify] a derived address against a known
// pool on a live node.

import { keccak256 } from "./keccak.js";
import { hexToBytes } from "./abi.js";

/** Canonical Uniswap v3 fee tiers (bps*100). */
export const FEE_TIERS = [100, 500, 3000, 10000] as const;
export type FeeTier = (typeof FEE_TIERS)[number];

function addr20(a: string): Uint8Array {
  const b = hexToBytes(a);
  if (b.length !== 20) throw new Error(`address must be 20 bytes: ${a}`);
  return b;
}

function uint256Word(v: bigint): Uint8Array {
  if (v < 0n) throw new Error("uint256 must be non-negative");
  const out = new Uint8Array(32);
  let x = v;
  for (let i = 31; i >= 0 && x > 0n; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  if (x > 0n) throw new Error("value exceeds uint256");
  return out;
}

function addressWord(a: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(addr20(a), 12);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export interface PoolKey {
  readonly tokenA: string;
  readonly tokenB: string;
  readonly fee: number;
}

/** Sort two token addresses ascending (token0, token1), as the factory does. */
export function sortTokens(a: string, b: string): [string, string] {
  const an = BigInt(a.startsWith("0x") ? a : `0x${a}`);
  const bn = BigInt(b.startsWith("0x") ? b : `0x${b}`);
  if (an === bn) throw new Error("tokens must differ");
  return an < bn ? [a.toLowerCase(), b.toLowerCase()] : [b.toLowerCase(), a.toLowerCase()];
}

export function computePoolAddress(
  factory: string,
  key: PoolKey,
  initCodeHash: string,
): string {
  const [token0, token1] = sortTokens(key.tokenA, key.tokenB);
  const salt = keccak256(concat([addressWord(token0), addressWord(token1), uint256Word(BigInt(key.fee))]));
  const digest = keccak256(
    concat([Uint8Array.of(0xff), addr20(factory), salt, hexToBytes(initCodeHash)]),
  );
  let hex = "0x";
  for (const x of digest.subarray(12)) hex += x.toString(16).padStart(2, "0");
  return hex;
}
