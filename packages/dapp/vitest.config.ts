import { defineConfig } from "vitest/config";

// The end-to-end test runs the compiled contract's circuits in JS (seconds, not the
// 5 s default).
export default defineConfig({
  test: {
    testTimeout: 180_000,
    include: ["src/**/*.test.ts"],
  },
});
