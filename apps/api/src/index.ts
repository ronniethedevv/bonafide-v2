// Entry point: build the server with the default (fixture) repository and listen.
// Live swap: build the server with `{ repo: new DbProfileRepository(
// prismaProfileStore(new PrismaClient())) }` from @mmr/db once DATABASE_URL is set
// and the Prisma client is generated (see packages/db/prisma/profile-store.ts).

import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const app = buildServer({ logger: true });

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
