import { describe, it, expect } from "vitest";
import { epochCoverageOfRecords, deriveClaimFromRecords, type EpochRecord } from "./verdict-log.js";

const rec = (epoch: number, uptime: number): EpochRecord => ({ epoch, uptime });

describe("epochCoverageOfRecords — completeness surface", () => {
  it("reports a contiguous record set", () => {
    const records = [1, 2, 3, 4, 5].map((e) => rec(e, 48));
    const c = epochCoverageOfRecords(records, 5);
    expect(c).toEqual({ epochsTotal: 5, present: 5, missing: [], contiguous: true });
  });

  it("surfaces withheld / unproven epochs as gaps", () => {
    const records = [rec(1, 48), rec(2, 48), rec(4, 48)]; // epoch 3 and 5 missing
    const c = epochCoverageOfRecords(records, 5);
    expect(c.present).toBe(3);
    expect(c.missing).toEqual([3, 5]);
    expect(c.contiguous).toBe(false);
  });

  it("ignores out-of-range records", () => {
    const records = [rec(1, 48), rec(2, 48), rec(9, 48)];
    expect(epochCoverageOfRecords(records, 3).missing).toEqual([3]);
  });

  it("a withheld epoch is visible AND still lowers the derived pass-rate (can't inflate)", () => {
    const full = [1, 2, 3, 4].map((e) => rec(e, 48)); // all meet threshold 40
    const withheld = [rec(1, 48), rec(2, 48), rec(4, 48)]; // drop epoch 3
    expect(deriveClaimFromRecords("e", 0, full, 40, 4).epochsPassed).toBe(4);
    // hiding epoch 3 does not raise passed; it stays below total and the gap shows
    expect(deriveClaimFromRecords("e", 0, withheld, 40, 4).epochsPassed).toBe(3);
    expect(epochCoverageOfRecords(withheld, 4).missing).toEqual([3]);
  });
});
