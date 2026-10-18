// Unsigned fixed-width integer discipline.
//
// Every amount mirrored from chain is an unsigned `bigint`. We never use
// `number` for values, never wrap on overflow, and always encode big-endian to
// a fixed width so the byte image that feeds a hash is canonical and
// recomputable by anyone (determinism is a hard invariant).

export type Uint = bigint;

export class UintWidthError extends Error {
  constructor(
    readonly value: bigint,
    readonly bits: number,
  ) {
    super(`value ${value} does not fit in an unsigned Uint<${bits}>`);
    this.name = "UintWidthError";
  }
}

const widthMax = (bits: number): bigint => (1n << BigInt(bits)) - 1n;

/** Assert that `value` is a non-negative integer within `bits` width. */
export function assertUint(value: bigint, bits: number): void {
  if (typeof value !== "bigint") {
    throw new TypeError(`expected bigint, got ${typeof value}`);
  }
  if (value < 0n || value > widthMax(bits)) {
    throw new UintWidthError(value, bits);
  }
}

/**
 * Encode an unsigned bigint as a big-endian byte buffer of exactly
 * `bits / 8` bytes. Throws on overflow or non-byte-aligned widths.
 */
export function encodeUint(value: bigint, bits: number): Uint8Array {
  assertUint(value, bits);
  if (bits % 8 !== 0) throw new RangeError(`bits must be byte-aligned: ${bits}`);
  const bytes = bits / 8;
  const out = new Uint8Array(bytes);
  let v = value;
  for (let i = bytes - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Parse a big-endian byte buffer back to an unsigned bigint. */
export function decodeUint(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

// Width aliases used by the leaf schema.
export const BITS = {
  ADDR: 160,
  U128: 128,
} as const;

/** Parse a hex string (0x-prefixed or not) into an unsigned bigint address. */
export function parseAddr(hex: string): bigint {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length === 0 || !/^[0-9a-fA-F]+$/.test(h)) {
    throw new Error(`invalid address hex: ${hex}`);
  }
  const v = BigInt("0x" + h);
  assertUint(v, BITS.ADDR);
  return v;
}

/** Lowercased, 0x-prefixed, 40-hex-digit canonical address string. */
export function formatAddr(value: bigint): string {
  assertUint(value, BITS.ADDR);
  return "0x" + value.toString(16).padStart(40, "0");
}
