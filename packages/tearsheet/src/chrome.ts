// Locate a real Chromium/Chrome binary. No bundled browser; we use whatever is
// installed (set CHROME_PATH to override). Returns null when none is found so
// callers can skip gracefully rather than fail.

import { existsSync, readdirSync } from "node:fs";

const KNOWN = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

export function findChrome(): string | null {
  const env = process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;

  // Playwright-style browser cache (used in the Claude Code cloud container).
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  try {
    for (const d of readdirSync(root)) {
      if (d.startsWith("chromium-")) {
        const p = `${root}/${d}/chrome-linux/chrome`;
        if (existsSync(p)) return p;
      }
    }
  } catch {
    // root may not exist; fall through
  }

  for (const c of KNOWN) if (existsSync(c)) return c;
  return null;
}

export function requireChrome(): string {
  const c = findChrome();
  if (!c) {
    throw new Error("no Chromium/Chrome binary found; set CHROME_PATH to one");
  }
  return c;
}
