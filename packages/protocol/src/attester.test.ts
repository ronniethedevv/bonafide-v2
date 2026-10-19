import { describe, it, expect } from "vitest";
import { MockAttesterCommittee } from "./attester.js";

const ATTESTERS = ["att-1", "att-2", "att-3"];
const EPOCH = 7;
const ROOT = "0xabc";
const CID = "mem://cid";

describe("MockAttesterCommittee", () => {
  it("signs with all online attesters", async () => {
    const c = new MockAttesterCommittee({ attesters: ATTESTERS, threshold: 2 });
    const sigs = await c.sign(EPOCH, ROOT, CID);
    expect(sigs.length).toBe(3);
    expect(c.threshold).toBe(2);
    expect(c.size).toBe(3);
  });

  it("produces deterministic signatures", async () => {
    const c = new MockAttesterCommittee({ attesters: ATTESTERS, threshold: 2 });
    const a = await c.sign(EPOCH, ROOT, CID);
    const b = await c.sign(EPOCH, ROOT, CID);
    expect(a).toEqual(b);
  });

  it("counts valid signatures and meets threshold", async () => {
    const c = new MockAttesterCommittee({ attesters: ATTESTERS, threshold: 2 });
    const sigs = await c.sign(EPOCH, ROOT, CID);
    const valid = MockAttesterCommittee.countValid(sigs, ATTESTERS, EPOCH, ROOT, CID);
    expect(valid).toBe(3);
    expect(valid >= c.threshold).toBe(true);
  });

  it("falls below threshold when attesters are offline", async () => {
    const c = new MockAttesterCommittee({ attesters: ATTESTERS, threshold: 2, online: ["att-1"] });
    const sigs = await c.sign(EPOCH, ROOT, CID);
    const valid = MockAttesterCommittee.countValid(sigs, ATTESTERS, EPOCH, ROOT, CID);
    expect(valid).toBe(1);
    expect(valid >= c.threshold).toBe(false);
  });

  it("ignores tampered, unknown, and duplicate signatures", async () => {
    const c = new MockAttesterCommittee({ attesters: ATTESTERS, threshold: 2 });
    const [s1] = await c.sign(EPOCH, ROOT, CID);
    const tampered = [
      { attester: "att-1", signature: "0xdeadbeef" }, // wrong signature
      { attester: "intruder", signature: s1!.signature }, // not in committee
      s1!,
      s1!, // duplicate of a valid one — counts once
    ];
    const valid = MockAttesterCommittee.countValid(tampered, ATTESTERS, EPOCH, ROOT, CID);
    expect(valid).toBe(1);
  });

  it("rejects an invalid threshold", () => {
    expect(() => new MockAttesterCommittee({ attesters: ATTESTERS, threshold: 4 })).toThrow();
  });
});
