// KAT (H3): recorded timestamps are checked against the block time, not trusted.
//
// Compact exposes block time only as comparisons (blockTimeLt/Gte...), evaluated
// against the transaction's block. The harness sets that block time on the circuit
// context (QueryContext.block.secondsSinceEpoch) — the one input a caller cannot
// choose. Registration's recorded timestamp must sit within its tolerance of the
// block time.

import { describe, expect, it } from "vitest";
import { BLOCK_TIME, HAVE_BUILD, buildScenario, runRegister } from "./harness.js";

// The bond window gates and their anchors (H3b) are in anchors.kat.test.ts.

describe.skipIf(!HAVE_BUILD)("H3: registeredAt is checked against block time", () => {
  const { witness } = buildScenario();
  const secret = new Uint8Array(32).fill(0x99);

  it("records a timestamp equal to the block time", async () => {
    await expect(runRegister(witness, secret, BLOCK_TIME, BLOCK_TIME)).resolves.toMatchObject({ registeredAt: BLOCK_TIME });
  });

  it("accepts a timestamp just inside the 600 s tolerance", async () => {
    const r = await runRegister(witness, secret, BLOCK_TIME - 599n, BLOCK_TIME);
    expect(r.registeredAt).toBe(BLOCK_TIME - 599n);
  });

  it("rejects a backdated timestamp (block time - 600 s)", async () => {
    await expect(runRegister(witness, secret, BLOCK_TIME - 600n, BLOCK_TIME))
      .rejects.toThrow(/registeredTs too far in the past \(H3\)/);
  });

  it("rejects a future timestamp", async () => {
    await expect(runRegister(witness, secret, BLOCK_TIME + 1n, BLOCK_TIME))
      .rejects.toThrow(/registeredTs is in the future \(H3\)/);
  });
});
