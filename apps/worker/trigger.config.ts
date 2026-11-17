import { defineConfig } from "@trigger.dev/sdk";

// Trigger.dev project for the background workers (apps/worker). The project ref is not a
// secret; the deploy token (TRIGGER_ACCESS_TOKEN) and task env vars are never committed.
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF || "proj_unset",
  dirs: ["./src/trigger"],
  runtime: "node",
  maxDuration: 6 * 60 * 60,
  retries: { enabledInDev: false },
  build: {
    // The Poseidon hasher loads WASM from the Midnight runtime; install it, don't bundle it.
    external: ["@midnight-ntwrk/compact-runtime", "@midnight-ntwrk/onchain-runtime-v3"],
  },
});
