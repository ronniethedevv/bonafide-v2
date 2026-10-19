import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome } from "./chrome.js";
import { renderHtmlToPdf } from "./export.js";
import { LocalFsStore } from "./store.js";

describe("LocalFsStore", () => {
  it("round-trips bytes to disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mmr-store-"));
    try {
      const store = new LocalFsStore(dir);
      const bytes = new TextEncoder().encode("hello");
      const path = await store.put("a/b/c.txt", bytes, "text/plain");
      expect(await readFile(path, "utf8")).toBe("hello");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Renders with a real browser — runs where Chromium exists (e.g. the dev
// container), skips automatically where it doesn't (e.g. plain CI). Not a mock:
// when it runs, it drives real Chromium and checks for a real PDF.
describe.skipIf(findChrome() === null)("renderHtmlToPdf (real Chromium)", () => {
  it("produces a valid PDF", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mmr-pdf-"));
    const out = join(dir, "out.pdf");
    try {
      await renderHtmlToPdf(
        "<!doctype html><html><body><h1>Tear sheet</h1><p>hello</p></body></html>",
        out,
      );
      const buf = await readFile(out);
      expect(buf.length).toBeGreaterThan(100);
      expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
