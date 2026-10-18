import { describe, it, expect } from "vitest";
import {
  assertUint,
  decodeUint,
  encodeUint,
  formatAddr,
  parseAddr,
  UintWidthError,
} from "./uint.js";

describe("uint width discipline", () => {
  it("encodes/decodes round-trip big-endian", () => {
    const v = 0x0123456789abcdefn;
    const bytes = encodeUint(v, 128);
    expect(bytes.length).toBe(16);
    expect(decodeUint(bytes)).toBe(v);
  });

  it("pads to the full width", () => {
    expect(encodeUint(1n, 160).length).toBe(20);
    expect([...encodeUint(1n, 160)].slice(0, 19).every((b) => b === 0)).toBe(true);
    expect(encodeUint(1n, 160)[19]).toBe(1);
  });

  it("rejects overflow instead of wrapping", () => {
    expect(() => encodeUint(1n << 128n, 128)).toThrow(UintWidthError);
    expect(() => assertUint(-1n, 128)).toThrow(UintWidthError);
  });

  it("rejects non-byte-aligned widths", () => {
    expect(() => encodeUint(1n, 7)).toThrow(RangeError);
  });

  it("parses and formats addresses canonically", () => {
    const a = parseAddr("0xABCDEF0000000000000000000000000000000001");
    expect(formatAddr(a)).toBe("0xabcdef0000000000000000000000000000000001");
    expect(() => parseAddr("0xZZ")).toThrow();
  });
});
