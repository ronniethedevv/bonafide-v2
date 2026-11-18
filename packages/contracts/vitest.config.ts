import { defineConfig } from "vitest/config";

// The KATs execute the compiled circuits in JS. A 30-epoch engagement (DD-35) proves and
// settles every epoch in its setup, which takes tens of seconds and longer when CI runs
// other packages' tests alongside, so the defaults (5 s per test, 10 s per hook) are too low.
export default defineConfig({
  test: {
    testTimeout: 180_000,
    hookTimeout: 900_000,
  },
});
