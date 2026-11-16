// keccak256 (Ethereum) — Node's crypto has SHA3-256 but NOT keccak256 (they differ
// in the domain-separation pad byte: keccak uses 0x01, SHA3 uses 0x06). Ethereum log
// topics and CREATE2 addresses need keccak256, so it is implemented here and pinned
// by known-answer vectors (see keccak.test.ts). Correctness is what matters, not
// speed; inputs are tiny (event signatures, 85-byte CREATE2 preimages).

const MASK = (1n << 64n) - 1n;
const RATE_BYTES = 136; // keccak256 rate = 1088 bits

const RC: readonly bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// Rotation offsets r[x][y], lane stored at index x + 5*y.
const R: readonly number[][] = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

function rotl(x: bigint, n: number): bigint {
  const b = BigInt(n % 64);
  if (b === 0n) return x & MASK;
  return ((x << b) | (x >> (64n - b))) & MASK;
}

function keccakF(a: bigint[]): void {
  const idx = (x: number, y: number): number => x + 5 * y;
  for (let round = 0; round < 24; round++) {
    // theta
    const c = new Array<bigint>(5);
    for (let x = 0; x < 5; x++) {
      c[x] = a[idx(x, 0)]! ^ a[idx(x, 1)]! ^ a[idx(x, 2)]! ^ a[idx(x, 3)]! ^ a[idx(x, 4)]!;
    }
    const d = new Array<bigint>(5);
    for (let x = 0; x < 5; x++) {
      d[x] = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1);
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) a[idx(x, y)] = a[idx(x, y)]! ^ d[x]!;
    }
    // rho + pi
    const b = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[idx(y, (2 * x + 3 * y) % 5)] = rotl(a[idx(x, y)]!, R[x]![y]!);
      }
    }
    // chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        a[idx(x, y)] = b[idx(x, y)]! ^ (~b[idx((x + 1) % 5, y)]! & b[idx((x + 2) % 5, y)]! & MASK);
      }
    }
    // iota
    a[0] = a[0]! ^ RC[round]!;
  }
}

export function keccak256(input: Uint8Array): Uint8Array {
  const a = new Array<bigint>(25).fill(0n);
  const padded = pad(input);
  for (let off = 0; off < padded.length; off += RATE_BYTES) {
    for (let i = 0; i < RATE_BYTES / 8; i++) {
      let lane = 0n;
      for (let j = 0; j < 8; j++) lane |= BigInt(padded[off + i * 8 + j]!) << BigInt(8 * j);
      a[i] = a[i]! ^ lane;
    }
    keccakF(a);
  }
  // squeeze first 32 bytes (little-endian lanes)
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = a[i]!;
    for (let j = 0; j < 8; j++) {
      out[i * 8 + j] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}

function pad(input: Uint8Array): Uint8Array {
  const len = input.length;
  const padLen = RATE_BYTES - (len % RATE_BYTES);
  const out = new Uint8Array(len + padLen);
  out.set(input, 0);
  out[len] = (out[len] ?? 0) ^ 0x01; // keccak domain pad
  const last = out.length - 1;
  out[last] = (out[last] ?? 0) ^ 0x80; // final-block marker
  return out;
}
