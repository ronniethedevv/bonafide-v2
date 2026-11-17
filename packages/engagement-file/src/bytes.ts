// Small byte helpers over WebCrypto (globalThis.crypto in browsers and Node ≥ 19).

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto is not available in this environment");
  return s;
};
export { subtle };

/** A fresh ArrayBuffer copy — WebCrypto's BufferSource typing rejects shared/offset views. */
export function ab(u: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(u.length);
  out.set(u);
  return out.buffer;
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function hexToBytes(hex: string, expectLen?: number): Uint8Array {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error("invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  if (expectLen !== undefined && out.length !== expectLen) throw new Error(`expected ${expectLen} bytes, got ${out.length}`);
  return out;
}

export function bytesToHex(b: Uint8Array): `0x${string}` {
  let s = "0x";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s as `0x${string}`;
}

export function toB64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Unsigned integer, little-endian, exactly bits/8 bytes (Compact's Uint<bits> serialization). */
export function uintLE(value: bigint, bits: number): Uint8Array {
  if (bits % 8 !== 0) throw new Error("bit width must be a multiple of 8");
  if (value < 0n || value >= 1n << BigInt(bits)) throw new RangeError(`value does not fit in Uint<${bits}>`);
  const out = new Uint8Array(bits / 8);
  let v = value;
  for (let i = 0; i < out.length; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export async function sha256(...parts: readonly Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-256", ab(concatBytes(...parts))));
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}
