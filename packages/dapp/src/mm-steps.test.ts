// The market maker's claim inputs, built from the ledger the way `mm claim` reads it, are
// accepted by the compiled contract's claim circuit; days not yet credited are not presented.

import { describe, expect, it } from "vitest";
import { HAVE_BUILD, creditEpochs, runClaimWithPaths, runningEngagement } from "@mmr/contracts/harness";
import { ledger } from "@mmr/contracts/epoch_proof";
import { claimInputs } from "./mm-steps.js";

const SECRET = new Uint8Array(32).fill(0x99);
const PROFILE = new Uint8Array(32).fill(0x77);

describe.skipIf(!HAVE_BUILD)("the market maker's claim, from the ledger", () => {
  it("presents exactly the credited days, and the compiled claim accepts them", async () => {
    const g = await runningEngagement({ proven: 3, secret: SECRET });
    const { terms, termsSalt } = g.scenario.witness;
    // Proven but not yet released: nothing is credited.
    expect(claimInputs(ledger(g.state), g.id, terms.min_uptime_buckets).credited).toBe(0);

    const state = await creditEpochs(g.state, g.id, g.records);
    const c = claimInputs(ledger(state), g.id, terms.min_uptime_buckets);
    expect([c.credited, c.released]).toEqual([3, 3]);
    expect(c.present.slice(0, 4)).toEqual([true, true, true, false]);

    const r = await runClaimWithPaths({
      engagementId: g.id, engagementSecret: SECRET, profileSecret: PROFILE, terms, termsSalt,
      presentFlags: c.present, paths: c.paths, epochsPassed: c.epochsPassed, epochsTotal: 30n, tier: c.tier,
    }, state);
    expect([r.completed, r.kpiHits, r.kpiTotal]).toEqual([1n, c.epochsPassed, 30n]);
  }, 300_000);
});
