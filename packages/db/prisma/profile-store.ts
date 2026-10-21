// Live ProfileStore over the generated Prisma client.
//
// [verify] This file imports @prisma/client, which exists only after
// `prisma generate`. It is intentionally OUTSIDE src/ so the package's `tsc`
// (include: src/**) never typechecks it before the client is generated — CI stays
// green without a database. Wire it up at deploy time:
//
//   1. add deps:   pnpm --filter @mmr/db add @prisma/client && pnpm --filter @mmr/db add -D prisma
//   2. set env:    DATABASE_URL=postgresql://...            (Neon/Supabase)
//   3. migrate:    pnpm --filter @mmr/db exec prisma migrate dev --name init
//   4. generate:   pnpm --filter @mmr/db exec prisma generate
//   5. use:        new DbProfileRepository(prismaProfileStore(new PrismaClient()))
//
// The projection worker writes display-ready rows, so this binding is a direct
// pass-through — Prisma columns already match the ProfileStore row fields (the
// enum-ish text columns are narrowed back to the read-model unions on read).

import { PrismaClient } from "@prisma/client";
import type { BondStatus, Tier } from "@mmr/read-model";
import type { EngagementRow, EpochPointRow, MmRow, ProfileStore } from "../src/store.js";

export function prismaProfileStore(prisma: PrismaClient): ProfileStore {
  return {
    async getMm(handle): Promise<MmRow | null> {
      const row = await prisma.mm.findUnique({ where: { handle } });
      return row
        ? { handle: row.handle, displayName: row.displayName, headlineUptime: row.headlineUptime }
        : null;
    },

    async listMms(): Promise<MmRow[]> {
      const rows = await prisma.mm.findMany();
      return rows.map((r) => ({ handle: r.handle, displayName: r.displayName, headlineUptime: r.headlineUptime }));
    },

    async engagementsFor(handle): Promise<EngagementRow[]> {
      const rows = await prisma.engagement.findMany({ where: { handle } });
      return rows.map((r) => ({
        recordId: r.recordId,
        handle: r.handle,
        tier: r.tier as Tier,
        sandbox: r.sandbox,
        epochsPassed: r.epochsPassed,
        epochsTotal: r.epochsTotal,
        kpiDepth: r.kpiDepth,
        kpiUptime: r.kpiUptime,
        kpiUtilization: r.kpiUtilization,
        kpiCustody: r.kpiCustody,
        kpiNoRoundTrips: r.kpiNoRoundTrips,
        custodyIntact: r.custodyIntact,
        bondPosted: r.bondPosted,
        bondStatus: r.bondStatus as BondStatus,
        completedAt: r.completedAt,
      }));
    },

    async epochSeriesFor(handle): Promise<EpochPointRow[]> {
      const rows = await prisma.epochPoint.findMany({ where: { handle } });
      return rows.map((r) => ({ handle: r.handle, epoch: r.epoch, uptime: r.uptime, depth: r.depth }));
    },
  };
}
