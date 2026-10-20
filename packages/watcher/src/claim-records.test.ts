import { describe, it, expect } from "vitest";
import {
  deriveClaimFromRecords,
  verifyClaimAgainstRecords,
  type EpochRecord,
} from "./verdict-log.js";

// A 5-epoch engagement, threshold 44 buckets:
//   epoch 1: 48  pass
//   epoch 2: 44  pass (exactly the threshold)
//   epoch 3: 40  fail (below threshold)
//   epoch 4: no record (failed I1-I7 or unproven) -> counts to total, not passed
//   epoch 5: 46  pass
// => epochsPassed = 3, epochsTotal = 5
const THRESHOLD = 44;
const TOTAL = 5;
const RECORDS: EpochRecord[] = [
  { epoch: 1, uptime: 48 },
  { epoch: 2, uptime: 44 },
  { epoch: 3, uptime: 40 },
  { epoch: 5, uptime: 46 },
];

describe("H4 claim derivation from on-chain records", () => {
  it("counts passed = records meeting the threshold within the contracted range", () => {
    const claim = deriveClaimFromRecords("eng", 2, RECORDS, THRESHOLD, TOTAL);
    expect(claim).toEqual({ engagementId: "eng", tier: 2, epochsPassed: 3, epochsTotal: 5 });
  });

  it("an honest claim verifies against the records", () => {
    const claim = deriveClaimFromRecords("eng", 2, RECORDS, THRESHOLD, TOTAL);
    expect(verifyClaimAgainstRecords(claim, RECORDS, THRESHOLD, TOTAL)).toBe(true);
  });

  it("rejects an inflated epochsPassed", () => {
    const forged = { engagementId: "eng", tier: 2, epochsPassed: 4, epochsTotal: 5 };
    expect(verifyClaimAgainstRecords(forged, RECORDS, THRESHOLD, TOTAL)).toBe(false);
  });

  it("rejects a denominator that does not match the committed contract length", () => {
    const claim = { engagementId: "eng", tier: 2, epochsPassed: 3, epochsTotal: 6 };
    expect(verifyClaimAgainstRecords(claim, RECORDS, THRESHOLD, TOTAL)).toBe(false);
  });

  it("ignores records outside the contracted epoch range", () => {
    const withExtra = [...RECORDS, { epoch: 6, uptime: 48 }]; // epoch 6 > total 5
    expect(deriveClaimFromRecords("eng", 2, withExtra, THRESHOLD, TOTAL).epochsPassed).toBe(3);
  });

  it("a stricter threshold credits fewer epochs", () => {
    // threshold 46 passes only epochs 1 (48) and 5 (46); epoch 2 (44) now fails
    expect(deriveClaimFromRecords("eng", 2, RECORDS, 46, TOTAL).epochsPassed).toBe(2);
  });

  it("missing epochs never let passed exceed total", () => {
    const sparse: EpochRecord[] = [{ epoch: 1, uptime: 48 }];
    const claim = deriveClaimFromRecords("eng", 1, sparse, THRESHOLD, TOTAL);
    expect(claim.epochsPassed).toBe(1);
    expect(claim.epochsPassed).toBeLessThanOrEqual(claim.epochsTotal);
  });
});
