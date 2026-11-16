import { describe, it, expect } from "vitest";
import { runDemoEpoch } from "./demo.js";

describe("runDemoEpoch — end-to-end pipeline", () => {
  it("indexes, assembles a verifying witness, and passes all invariants", async () => {
    const r = await runDemoEpoch();
    expect(r.poolCount).toBe(1);
    expect(r.witnessValid).toBe(true);
    expect(r.depthBound).toBe(true);
    expect(r.verdict.pass).toBe(true);
    expect(r.verdict.uptimeBuckets).toBe(r.verdict.totalBuckets);
    expect(Object.values(r.verdict.invariants).every(Boolean)).toBe(true);
    expect(r.rootOfRootsHex).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
