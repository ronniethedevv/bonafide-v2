import { describe, it, expect } from "vitest";
import {
  MAX_EPOCHS,
  deriveClaimFromRecords,
  planClaimWitness,
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

describe("H4 claim witness plan (DD-15)", () => {
  it("lays out MAX_EPOCHS slots; slot s binds epoch s+1", () => {
    const plan = planClaimWitness(RECORDS, THRESHOLD, TOTAL);
    expect(plan.slots.length).toBe(MAX_EPOCHS);
    expect(plan.slots.every((s) => s.epoch === s.slot + 1)).toBe(true);
  });

  it("credited slots and count match deriveClaimFromRecords", () => {
    const plan = planClaimWitness(RECORDS, THRESHOLD, TOTAL);
    const derived = deriveClaimFromRecords("eng", 2, RECORDS, THRESHOLD, TOTAL);
    expect(plan.epochsPassed).toBe(derived.epochsPassed); // 3
    expect(plan.epochsPassed).toBe(plan.slots.filter((s) => s.credited).length);
    // epoch 1 (48) & 2 (44) & 5 (46) credited; epoch 3 (40) present but below threshold
    expect(plan.slots[0]).toMatchObject({ epoch: 1, present: true, credited: true });
    expect(plan.slots[2]).toMatchObject({ epoch: 3, present: true, credited: false });
    expect(plan.slots[3]).toMatchObject({ epoch: 4, present: false, credited: false });
  });

  it("drops records outside the contracted range (slots >= epochsTotal are empty)", () => {
    const withExtra = [...RECORDS, { epoch: 6, uptime: 48 }];
    const plan = planClaimWitness(withExtra, THRESHOLD, TOTAL);
    expect(plan.slots[5]).toMatchObject({ epoch: 6, present: false, credited: false });
    expect(plan.epochsPassed).toBe(3);
  });

  it("a withheld record only lowers the count", () => {
    const withheld = RECORDS.filter((r) => r.epoch !== 1); // drop the epoch-1 pass
    expect(planClaimWitness(withheld, THRESHOLD, TOTAL).epochsPassed).toBe(2);
  });

  it("rejects epochsTotal outside 1..MAX_EPOCHS", () => {
    expect(() => planClaimWitness(RECORDS, THRESHOLD, 0)).toThrow();
    expect(() => planClaimWitness(RECORDS, THRESHOLD, MAX_EPOCHS + 1)).toThrow();
  });
});
