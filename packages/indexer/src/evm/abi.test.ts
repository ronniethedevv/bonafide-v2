import { describe, it, expect } from "vitest";
import {
  TOPIC0,
  bytesToHex,
  decodeAddress,
  decodeInt,
  decodeUint,
  decodeSwap,
  decodeMint,
  decodeBurn,
  decodeTransfer,
  decodePoolCreated,
} from "./abi.js";

// --- word encoders (test-only), the inverse of the decoders, for round-trips ---
function uintWord(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let x = v;
  for (let i = 31; i >= 0 && x > 0n; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}
function intWord(v: bigint): Uint8Array {
  return uintWord(v < 0n ? v + (1n << 256n) : v);
}
function addrTopic(a: string): string {
  return bytesToHex(uintWord(BigInt(a)));
}
function dataHex(words: Uint8Array[]): string {
  let s = "0x";
  for (const w of words) s += [...w].map((b) => b.toString(16).padStart(2, "0")).join("");
  return s;
}

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

describe("topic0 derivation matches canonical on-chain constants", () => {
  it("derives the published event topic0 hashes", () => {
    expect(TOPIC0.transfer).toBe("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
    expect(TOPIC0.swap).toBe("0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67");
    expect(TOPIC0.mint).toBe("0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde");
    expect(TOPIC0.burn).toBe("0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c");
    expect(TOPIC0.poolCreated).toBe("0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118");
  });
});

describe("word decoders", () => {
  it("decodes uint, signed int (incl. negative), and right-aligned address", () => {
    expect(decodeUint(uintWord(123456789n))).toBe(123456789n);
    expect(decodeInt(intWord(-887272n))).toBe(-887272n); // a real Uniswap v3 min-tick-ish value
    expect(decodeInt(intWord(42n))).toBe(42n);
    expect(decodeAddress(uintWord(BigInt(A)))).toBe(A);
  });
});

describe("event decoders (round-trip)", () => {
  it("decodes a Swap with signed amounts and tick", () => {
    const log = {
      topics: [TOPIC0.swap, addrTopic(A), addrTopic(B)],
      data: dataHex([intWord(-1000n), intWord(2500n), uintWord(79228162514264337593543950336n), uintWord(5000n), intWord(-73n)]),
    };
    expect(decodeSwap(log)).toEqual({
      sender: A,
      recipient: B,
      amount0: -1000n,
      amount1: 2500n,
      sqrtPriceX96: 79228162514264337593543950336n,
      liquidity: 5000n,
      tick: -73,
    });
  });

  it("decodes a Mint (owner/ticks indexed; sender+amounts in data)", () => {
    const log = {
      topics: [TOPIC0.mint, addrTopic(A), bytesToHex(intWord(-100n)), bytesToHex(intWord(100n))],
      data: dataHex([uintWord(BigInt(B)), uintWord(900n), uintWord(10n), uintWord(20n)]),
    };
    expect(decodeMint(log)).toEqual({
      owner: A,
      tickLower: -100,
      tickUpper: 100,
      sender: B,
      amount: 900n,
      amount0: 10n,
      amount1: 20n,
    });
  });

  it("decodes a Burn", () => {
    const log = {
      topics: [TOPIC0.burn, addrTopic(A), bytesToHex(intWord(-60n)), bytesToHex(intWord(60n))],
      data: dataHex([uintWord(777n), uintWord(3n), uintWord(4n)]),
    };
    expect(decodeBurn(log)).toEqual({ owner: A, tickLower: -60, tickUpper: 60, amount: 777n, amount0: 3n, amount1: 4n });
  });

  it("decodes an ERC-20 Transfer", () => {
    const log = { topics: [TOPIC0.transfer, addrTopic(A), addrTopic(B)], data: dataHex([uintWord(1_000_000n)]) };
    expect(decodeTransfer(log)).toEqual({ from: A, to: B, value: 1_000_000n });
  });

  it("decodes a PoolCreated", () => {
    const log = {
      topics: [TOPIC0.poolCreated, addrTopic(A), addrTopic(B), bytesToHex(uintWord(500n))],
      data: dataHex([intWord(10n), uintWord(BigInt("0x3333333333333333333333333333333333333333"))]),
    };
    expect(decodePoolCreated(log)).toEqual({
      token0: A,
      token1: B,
      fee: 500,
      tickSpacing: 10,
      pool: "0x3333333333333333333333333333333333333333",
    });
  });

  it("rejects a log whose topic0 is the wrong event", () => {
    const log = { topics: [TOPIC0.transfer, addrTopic(A), addrTopic(B)], data: dataHex([uintWord(1n)]) };
    expect(() => decodeSwap(log)).toThrow(/not a Swap event/);
  });

  it("rejects a Swap with the wrong number of data words", () => {
    const log = { topics: [TOPIC0.swap, addrTopic(A), addrTopic(B)], data: dataHex([intWord(1n)]) };
    expect(() => decodeSwap(log)).toThrow(/expected 5 data words/);
  });
});
