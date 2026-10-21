import { describe, it, expect } from "vitest";
import { getProfile, type MmProfile } from "@mmr/read-model";
import { DbProfileRepository } from "./repository.js";
import type { EngagementRow, EpochPointRow, MmRow, ProfileStore } from "./store.js";

// Flatten a read-model profile into the rows a projection worker would store, so the
// test is a round-trip: rows -> DbProfileRepository -> profile must reproduce the
// input exactly. That proves the repository is the faithful inverse of the store.
function flatten(p: MmProfile): { mm: MmRow; engagements: EngagementRow[]; epochs: EpochPointRow[] } {
  const mm: MmRow = { handle: p.handle, displayName: p.displayName, headlineUptime: p.headlineUptime };
  const engagements = [...p.engagements, ...p.sandbox].map((e) => ({
    recordId: e.id,
    handle: p.handle,
    tier: e.tier,
    sandbox: e.sandbox,
    epochsPassed: e.epochsPassed,
    epochsTotal: e.epochsTotal,
    kpiDepth: e.kpis.depth,
    kpiUptime: e.kpis.uptime,
    kpiUtilization: e.kpis.utilization,
    kpiCustody: e.kpis.custody,
    kpiNoRoundTrips: e.kpis.noRoundTrips,
    custodyIntact: e.custodyIntact,
    bondPosted: e.bond.posted,
    bondStatus: e.bond.status,
    completedAt: e.completedAt,
  }));
  const epochs = p.epochSeries.map((s) => ({ handle: p.handle, epoch: s.epoch, uptime: s.uptime, depth: s.depth }));
  return { mm, engagements, epochs };
}

class FakeStore implements ProfileStore {
  private readonly mms = new Map<string, MmRow>();
  private readonly engagements = new Map<string, EngagementRow[]>();
  private readonly epochs = new Map<string, EpochPointRow[]>();

  add(p: MmProfile): this {
    const { mm, engagements, epochs } = flatten(p);
    this.mms.set(mm.handle, mm);
    this.engagements.set(mm.handle, engagements);
    this.epochs.set(mm.handle, epochs);
    return this;
  }

  /** Store epoch rows in a deliberately scrambled order to test the repo's sort. */
  scrambleEpochs(handle: string): this {
    const rows = this.epochs.get(handle);
    if (rows) this.epochs.set(handle, [...rows].reverse());
    return this;
  }

  async getMm(handle: string): Promise<MmRow | null> {
    return this.mms.get(handle) ?? null;
  }
  async listMms(): Promise<MmRow[]> {
    return [...this.mms.values()];
  }
  async engagementsFor(handle: string): Promise<EngagementRow[]> {
    return this.engagements.get(handle) ?? [];
  }
  async epochSeriesFor(handle: string): Promise<EpochPointRow[]> {
    return this.epochs.get(handle) ?? [];
  }
}

const vega = getProfile("vega-mm")!;

describe("DbProfileRepository", () => {
  it("round-trips the read-model projection exactly (store rows -> profile)", async () => {
    const repo = new DbProfileRepository(new FakeStore().add(vega));
    expect(await repo.get("vega-mm")).toEqual(vega);
  });

  it("returns undefined for an unknown handle", async () => {
    const repo = new DbProfileRepository(new FakeStore().add(vega));
    expect(await repo.get("nope")).toBeUndefined();
  });

  it("list() assembles every stored profile", async () => {
    const repo = new DbProfileRepository(new FakeStore().add(vega));
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(vega);
  });

  it("derives tierCounts from the engagement rows (A:2, B:3, C:1 for vega)", async () => {
    const repo = new DbProfileRepository(new FakeStore().add(vega));
    const got = await repo.get("vega-mm");
    expect(got!.tierCounts).toEqual({ A: 2, B: 3, C: 1 });
  });

  it("sorts the epoch series oldest->newest regardless of row order", async () => {
    const repo = new DbProfileRepository(new FakeStore().add(vega).scrambleEpochs("vega-mm"));
    const got = await repo.get("vega-mm");
    const epochs = got!.epochSeries.map((s) => s.epoch);
    expect(epochs).toEqual([...epochs].sort((a, b) => a - b));
    expect(got).toEqual(vega);
  });

  it("splits sandbox engagements from headline ones", async () => {
    const repo = new DbProfileRepository(new FakeStore().add(vega));
    const got = await repo.get("vega-mm");
    expect(got!.engagements.every((e) => !e.sandbox)).toBe(true);
    expect(got!.sandbox.every((e) => e.sandbox)).toBe(true);
    expect(got!.sandbox.map((e) => e.id)).toEqual(["rec_sbx_01"]);
  });

  it("handles a profile with no engagements (empty tierCounts, empty lists)", async () => {
    const bare: MmProfile = {
      handle: "bare",
      displayName: "Bare MM",
      headlineUptime: 0,
      tierCounts: { A: 0, B: 0, C: 0 },
      epochSeries: [],
      engagements: [],
      sandbox: [],
    };
    const repo = new DbProfileRepository(new FakeStore().add(bare));
    expect(await repo.get("bare")).toEqual(bare);
  });
});
