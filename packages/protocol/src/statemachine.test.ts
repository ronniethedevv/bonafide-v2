import { describe, it, expect } from "vitest";
import { DEFAULT_TIMING } from "./timing.js";
import {
  createEngagementState,
  reduce,
  isTerminal,
  TransitionError,
} from "./statemachine.js";

const t = DEFAULT_TIMING;
const T0 = 1_000_000;
const withinWindow = T0 + 1000;
const pastWindow = T0 + t.fundingWindowSeconds + 1;

describe("engagement state machine", () => {
  it("starts Registered", () => {
    expect(createEngagementState(T0).status).toBe("Registered");
  });

  it("funds within the funding window", () => {
    const s = reduce(createEngagementState(T0), { type: "fund", at: withinWindow }, t);
    expect(s.status).toBe("Funded");
    expect(s.fundedAt).toBe(withinWindow);
  });

  it("refuses to fund after the funding window", () => {
    expect(() =>
      reduce(createEngagementState(T0), { type: "fund", at: pastWindow }, t),
    ).toThrow(/funding window passed/);
  });

  it("activates a funded engagement", () => {
    const funded = reduce(createEngagementState(T0), { type: "fund", at: withinWindow }, t);
    const active = reduce(funded, { type: "activate", at: withinWindow + 10 }, t);
    expect(active.status).toBe("Active");
  });

  it("refuses to activate before funding", () => {
    expect(() =>
      reduce(createEngagementState(T0), { type: "activate", at: withinWindow }, t),
    ).toThrow(TransitionError);
  });

  it("voids an unfunded engagement after the window", () => {
    const s = reduce(createEngagementState(T0), { type: "voidUnfunded", at: pastWindow }, t);
    expect(s.status).toBe("Voided");
    expect(s.endedReason).toBe("unfunded");
    expect(isTerminal(s.status)).toBe(true);
  });

  it("refuses to void while the funding window is open", () => {
    expect(() =>
      reduce(createEngagementState(T0), { type: "voidUnfunded", at: withinWindow }, t),
    ).toThrow(/funding window still open/);
  });

  it("completes and defaults from Active only", () => {
    const active = reduce(
      reduce(createEngagementState(T0), { type: "fund", at: withinWindow }, t),
      { type: "activate", at: withinWindow + 10 },
      t,
    );
    expect(reduce(active, { type: "complete", at: withinWindow + 99 }, t).status).toBe("Settled");
    expect(reduce(active, { type: "default", at: withinWindow + 99 }, t).status).toBe("Defaulted");
  });

  it("lets only the client terminate early", () => {
    const active = reduce(
      reduce(createEngagementState(T0), { type: "fund", at: withinWindow }, t),
      { type: "activate", at: withinWindow + 10 },
      t,
    );
    expect(reduce(active, { type: "terminateEarly", at: withinWindow + 50, by: "client" }, t).status).toBe(
      "Settled",
    );
  });
});
