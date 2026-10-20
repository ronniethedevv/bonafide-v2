// KAT (H3): window gates read the block time, not a caller-supplied "now".
//
// Compact exposes block time only as comparisons (blockTimeLt/Gte...), evaluated
// against the transaction's block. The harness sets that block time on the circuit
// context (QueryContext.block.secondsSinceEpoch) — the one input a caller cannot
// choose. Each gate must revert one second before its window ends and pass at
// the end; registration's recorded timestamp must sit within its tolerance of
// the block time.

import { describe, expect, it } from "vitest";
import {
  BLOCK_TIME,
  HAVE_BOND_BUILD,
  HAVE_REG_BUILD,
  buildScenario,
  runBondGate,
  runRegister,
  type BondGate,
} from "./harness.js";

const ID = new Uint8Array(32).fill(0x42);
const ANCHOR = 1_700_000_000n;

describe.skipIf(!HAVE_BOND_BUILD)("H3: bond window gates use block time", () => {
  const gates: [BondGate, bigint, RegExp][] = [
    ["releaseEpoch", 43_200n, /challenge window open/],      // settledAt + 12h
    ["voidUnfunded", 259_200n, /funding window open/],       // registeredAt + 72h
    ["defaultEngagement", 86_400n, /proving window open/],   // deadline + 24h
  ];

  for (const [gate, window, err] of gates) {
    it(`${gate}: reverts one second before the window ends, passes at the end`, async () => {
      const end = ANCHOR + window;
      await expect(runBondGate(gate, ID, ANCHOR, end - 1n)).rejects.toThrow(err);
      await expect(runBondGate(gate, ID, ANCHOR, end)).resolves.toBeUndefined();
    });
  }

  it("releaseEpoch long before the window ends reverts (no caller 'now' to forge)", async () => {
    await expect(runBondGate("releaseEpoch", ID, ANCHOR, ANCHOR + 60n)).rejects.toThrow(/challenge window open/);
  });
});

describe.skipIf(!HAVE_REG_BUILD)("H3: registeredAt is checked against block time", () => {
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
