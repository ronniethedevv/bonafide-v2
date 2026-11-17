import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the web app's pure modules (auth, projections). Mirrors the "@/…" alias
// from tsconfig so tests import modules exactly as the app does.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
