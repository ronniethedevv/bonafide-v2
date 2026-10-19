// Entry point: build the server with the default (fixture) repository and listen.
// Swap FixtureProfileRepository for a DB-backed repo here once the data layer lands.

import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const app = buildServer({ logger: true });

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
