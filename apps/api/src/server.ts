// Read-model API (Fastify). Serves only the public projection — the same data the
// web app renders — from a ProfileRepository (fixture-backed today, DB-backed
// later). buildServer takes the repo so tests can inject a fake and use
// fastify.inject without opening a socket.

import Fastify, { type FastifyInstance } from "fastify";
import {
  type ProfileRepository,
  FixtureProfileRepository,
  totalCompleted,
} from "@mmr/read-model";

export interface BuildOptions {
  repo?: ProfileRepository;
  logger?: boolean;
}

export function buildServer(opts: BuildOptions = {}): FastifyInstance {
  const repo = opts.repo ?? new FixtureProfileRepository();
  const app = Fastify({ logger: opts.logger ?? false });

  app.get("/health", async () => ({ status: "ok" }));

  // Summary list for the landing page.
  app.get("/api/mm", async () => {
    const profiles = await repo.list();
    return profiles.map((p) => ({
      handle: p.handle,
      displayName: p.displayName,
      headlineUptime: p.headlineUptime,
      completed: totalCompleted(p),
      tierCounts: p.tierCounts,
    }));
  });

  // Full public profile.
  app.get<{ Params: { handle: string } }>("/api/mm/:handle", async (req, reply) => {
    const profile = await repo.get(req.params.handle);
    if (!profile) return reply.code(404).send({ error: "not found" });
    return profile;
  });

  // Just the epoch series (hero chart).
  app.get<{ Params: { handle: string } }>("/api/mm/:handle/epochs", async (req, reply) => {
    const profile = await repo.get(req.params.handle);
    if (!profile) return reply.code(404).send({ error: "not found" });
    return profile.epochSeries;
  });

  return app;
}
