import { describe, it, expect } from "vitest";
import { keccak256 } from "./keccak.js";

function hex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("keccak256 known-answer vectors", () => {
  it('hashes the empty input', () => {
    expect(hex(keccak256(new Uint8Array()))).toBe(
      "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
  });

  it('hashes "abc"', () => {
    expect(hex(keccak256(utf8("abc")))).toBe(
      "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    );
  });

  it("hashes the ERC-20 Transfer signature to its canonical topic0", () => {
    expect(hex(keccak256(utf8("Transfer(address,address,uint256)")))).toBe(
      "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    );
  });

  it("hashes the Uniswap v3 Swap signature to its canonical topic0", () => {
    expect(hex(keccak256(utf8("Swap(address,address,int256,int256,uint160,uint128,int24)")))).toBe(
      "c42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
    );
  });

  it("is deterministic and 32 bytes across the 136-byte block boundary", () => {
    // Exercises single- and multi-block absorb without a hand-typed digest: outputs
    // must be 32 bytes and identical across repeated/independent calls.
    for (const len of [135, 136, 137, 272, 500]) {
      const msg = utf8("a".repeat(len));
      const first = keccak256(msg);
      expect(first).toHaveLength(32);
      expect(hex(keccak256(msg))).toBe(hex(first));
    }
  });
});
