// Render a tear sheet to a real PDF or PNG using headless Chromium. This is the
// generation half of the spec's "exportable tear sheet" deliverable; storage is a
// separate concern (see store.ts). No mock — it drives a real browser.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireChrome } from "./chrome.js";

const run = promisify(execFile);

async function runChrome(args: string[]): Promise<void> {
  const chrome = requireChrome();
  const profile = await mkdtemp(join(tmpdir(), "mmr-chrome-"));
  try {
    await run(
      chrome,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        // CI containers (e.g. GitHub runners) give Chromium a tiny /dev/shm, which
        // makes rendering hang or crash; write shared memory to a regular temp file
        // instead. Without this the render can exceed the test timeout.
        "--disable-dev-shm-usage",
        `--user-data-dir=${profile}`,
        ...args,
      ],
      { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
    );
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

/** Render a page URL to a PDF at `outPath`. Returns outPath. */
export async function renderUrlToPdf(url: string, outPath: string): Promise<string> {
  await runChrome([`--print-to-pdf=${outPath}`, "--no-pdf-header-footer", url]);
  return outPath;
}

export interface PngOptions {
  width: number;
  height: number;
}

/** Render a page URL to a PNG at `outPath`. Returns outPath. */
export async function renderUrlToPng(
  url: string,
  outPath: string,
  opts: PngOptions = { width: 900, height: 1400 },
): Promise<string> {
  await runChrome([
    `--screenshot=${outPath}`,
    `--window-size=${opts.width},${opts.height}`,
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    url,
  ]);
  return outPath;
}

/** Render raw HTML to a PDF (writes it to a temp file and renders via file://). */
export async function renderHtmlToPdf(html: string, outPath: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mmr-html-"));
  const htmlPath = join(dir, "page.html");
  await writeFile(htmlPath, html, "utf8");
  try {
    await renderUrlToPdf(`file://${htmlPath}`, outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return outPath;
}

export type TearSheetFormat = "pdf" | "png";

export interface ExportOptions {
  /** Base URL of a running web app, e.g. http://localhost:3000. */
  baseUrl: string;
  handle: string;
  outPath: string;
  format?: TearSheetFormat;
}

/** Render a live tear-sheet page (`/mm/:handle/tear-sheet`) to PDF or PNG. */
export async function exportTearSheet(opts: ExportOptions): Promise<string> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/mm/${encodeURIComponent(opts.handle)}/tear-sheet`;
  return (opts.format ?? "pdf") === "png"
    ? renderUrlToPng(url, opts.outPath)
    : renderUrlToPdf(url, opts.outPath);
}
