import { describe, it, expect } from "vitest";
import {
  FixtureProfileRepository,
  totalCompleted,
  overallKpiHitRate,
  type EngagementRecord,
} from "./index.js";

describe("read-model fixtures + repository", () => {
  const repo = new FixtureProfileRepository();

  it("lists and gets profiles", async () => {
    const all = await repo.list();
    expect(all.length).toBeGreaterThan(0);
    const vega = await repo.get("vega-mm");
    expect(vega?.displayName).toBe("Vega Market Making");
    expect(await repo.get("nope")).toBeUndefined();
  });

  it("totalCompleted sums headline + sandbox", async () => {
    const vega = (await repo.get("vega-mm"))!;
    expect(totalCompleted(vega)).toBe(vega.engagements.length + vega.sandbox.length);
  });

  it("overallKpiHitRate averages the five KPIs", () => {
    const e: EngagementRecord = {
      id: "x",
      tier: "A",
      sandbox: false,
      epochsPassed: 1,
      epochsTotal: 1,
      kpis: { depth: 100, uptime: 90, utilization: 80, custody: 100, noRoundTrips: 100 },
      custodyIntact: true,
      bond: { posted: "—", status: "intact" },
      completedAt: "2026-01-01",
    };
    expect(overallKpiHitRate(e)).toBe(94); // (100+90+80+100+100)/5
  });
});
