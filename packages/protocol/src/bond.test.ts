import { describe, expect, it } from "vitest";
import { cumulativeRelease, nextTranche } from "./bond.js";

describe("bond release schedule (M3b)", () => {
  it("splits a bond into floor(B·k/E) steps", () => {
    expect([0, 1, 2].map((k) => nextTranche(1_000n, 3, k))).toEqual([333n, 333n, 334n]);
    expect([0, 1, 2].map((k) => nextTranche(1_001n, 3, k))).toEqual([333n, 334n, 334n]);
    expect(cumulativeRelease(1_000n, 3, 2)).toBe(666n);
  });

  it("tranches sum to exactly the bond and never exceed it along the way", () => {
    for (const [bond, e] of [[1_000n, 3], [7n, 90], [10_000n, 30], [1n, 1], [999_999n, 7]] as const) {
      let sum = 0n;
      for (let k = 0; k < e; k++) {
        const t = nextTranche(bond, e, k);
        expect(t >= 0n).toBe(true);
        sum += t;
        expect(sum <= bond).toBe(true);
        expect(sum).toBe(cumulativeRelease(bond, e, k + 1));
      }
      expect(sum).toBe(bond);
    }
  });

  it("rejects out-of-range inputs", () => {
    expect(() => cumulativeRelease(1n, 0, 0)).toThrow(/epochsTotal/);
    expect(() => cumulativeRelease(1n, 3, 4)).toThrow(/releasedEpochs/);
    expect(() => nextTranche(1n, 3, 3)).toThrow(/releasedEpochs/);
    expect(() => cumulativeRelease(-1n, 3, 0)).toThrow(/bond/);
  });
});
