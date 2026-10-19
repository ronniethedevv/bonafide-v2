import { describe, it, expect } from "vitest";
import { DEFAULT_TIMING } from "./timing.js";
import {
  evaluateEpochSettlement,
  rootIsSettled,
  isScored,
  isDefault,
  type RootState,
  type SettlementInput,
} from "./settlement.js";

const t = DEFAULT_TIMING;
const epochEndTs = 1000;
const root: RootState = { publishedTs: 1100, signatureCount: 2 };

function input(over: Partial<SettlementInput>): SettlementInput {
  return {
    epochEndTs,
    now: 2000,
    root,
    threshold: 2,
    challenged: false,
    proofAcceptedTs: null,
    timing: t,
    ...over,
  };
}

describe("evaluateEpochSettlement", () => {
  it("awaits the root before the attester timeout", () => {
    expect(evaluateEpochSettlement(input({ root: null, now: 1500 })).outcome).toBe(
      "awaiting-root",
    );
  });

  it("voids when no valid root by the attester timeout", () => {
    expect(evaluateEpochSettlement(input({ root: null, now: 30_000 })).outcome).toBe(
      "voided-no-root",
    );
  });

  it("voids when signatures are below threshold at the timeout", () => {
    const under = { publishedTs: 1100, signatureCount: 1 };
    expect(evaluateEpochSettlement(input({ root: under, now: 30_000 })).outcome).toBe(
      "voided-no-root",
    );
  });

  it("is in-challenge while the challenge window is open", () => {
    expect(evaluateEpochSettlement(input({ now: 2000 })).outcome).toBe("in-challenge");
  });

  it("reports a raised challenge", () => {
    expect(evaluateEpochSettlement(input({ now: 50_000, challenged: true })).outcome).toBe(
      "challenged",
    );
  });

  it("opens the proving window after an unchallenged root settles", () => {
    expect(evaluateEpochSettlement(input({ now: 50_000 })).outcome).toBe("proving");
  });

  it("settles on a proof within the proving window", () => {
    const r = evaluateEpochSettlement(input({ now: 60_000, proofAcceptedTs: 50_000 }));
    expect(r.outcome).toBe("settled");
    expect(isScored(r.outcome)).toBe(true);
  });

  it("flags a late proof inside the grace window", () => {
    const r = evaluateEpochSettlement(input({ now: 160_000, proofAcceptedTs: 150_000 }));
    expect(r.outcome).toBe("settled-flagged");
    expect(isScored(r.outcome)).toBe(true);
  });

  it("is in grace when the proving deadline passes with no proof", () => {
    expect(evaluateEpochSettlement(input({ now: 150_000 })).outcome).toBe("grace");
  });

  it("defaults when no proof arrives by the grace deadline", () => {
    const r = evaluateEpochSettlement(input({ now: 300_000 }));
    expect(r.outcome).toBe("defaulted");
    expect(isDefault(r.outcome)).toBe(true);
  });

  it("defaults a proof accepted after the grace deadline", () => {
    expect(
      evaluateEpochSettlement(input({ now: 300_000, proofAcceptedTs: 300_000 })).outcome,
    ).toBe("defaulted");
  });
});

describe("rootIsSettled", () => {
  it("is true for a sufficiently-signed, unchallenged root past the challenge window", () => {
    expect(rootIsSettled({ epochEndTs, now: 50_000, root, threshold: 2, challenged: false, timing: t })).toBe(true);
  });
  it("is false during the challenge window", () => {
    expect(rootIsSettled({ epochEndTs, now: 2000, root, threshold: 2, challenged: false, timing: t })).toBe(false);
  });
  it("is false when challenged", () => {
    expect(rootIsSettled({ epochEndTs, now: 50_000, root, threshold: 2, challenged: true, timing: t })).toBe(false);
  });
});
