import { defineConfig } from "vitest/config";

// The KATs execute the compiled circuits in JS. A 30-epoch engagement (DD-35) proves and
// settles every epoch in its setup, which takes tens of seconds and longer when CI runs
// other packages' tests alongside, so the defaults (5 s per test, 10 s per hook) are too low.
//
// Files run one at a time: each runs compiled circuits flat out, and with every file in
// its own thread (while CI also runs other packages' tests) the runner's main process
// was starved and its worker RPC timed out ("Timeout calling onTaskUpdate").
export default defineConfig({
  test: {
    testTimeout: 180_000,
    hookTimeout: 900_000,
    fileParallelism: false,
  },
});
