// On-disk JSON-RPC cache for the live runner.
//
// Indexing one epoch is thousands of archive-RPC calls, so a dropped connection
// otherwise forces a restart from zero. Every call in an epoch build is pinned to a
// concrete historical block (balances, slot0, logs over a fixed block range), and that
// data is immutable — so its response can be cached on disk and a re-run resumes from
// the cache instead of re-fetching. Only the finalized-head query (eth_blockNumber /
// eth_getBlockByNumber "finalized") is time-varying and is never cached; neither are
// errors or rate-limit responses, so a failed call is always retried for real.
//
// The cache is keyed by (host, method, params) — the host (not the full URL) so the key
// carries no API key and survives a key rotation. It only stores response bodies, which
// never contain the key.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FetchLike } from "../http.js";

const BLOCK_TAGS = ["finalized", "latest", "pending", "earliest", "safe"];

/** True when a request is pinned to concrete historical state and so safe to cache. */
export function isCacheable(method: string, params: unknown): boolean {
  if (method === "" || method === "eth_blockNumber") return false;
  const s = JSON.stringify(params ?? []);
  return !BLOCK_TAGS.some((t) => s.includes(`"${t}"`));
}

function hostOf(input: string): string {
  try {
    return new URL(input).host;
  } catch {
    return "";
  }
}

function keyFor(input: string, method: string, params: unknown): string {
  return createHash("sha256")
    .update(`${hostOf(input)}\n${method}\n${JSON.stringify(params ?? [])}`)
    .digest("hex");
}

/**
 * Wrap a FetchLike with a persistent JSON-RPC cache under `dir`. A cache hit returns the
 * stored response with no network call, so a re-run after a dropped connection resumes
 * where it left off; the determinism second pass then reads entirely from cache.
 */
export function cachingFetch(base: FetchLike, dir: string): FetchLike {
  mkdirSync(dir, { recursive: true });
  return async (input, init) => {
    let method = "";
    let params: unknown = [];
    try {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: unknown };
      method = body.method ?? "";
      params = body.params ?? [];
    } catch {
      // Not a JSON-RPC body we understand; pass straight through, uncached.
    }

    if (!isCacheable(method, params)) return base(input, init);

    const file = join(dir, `${keyFor(input, method, params)}.json`);
    if (existsSync(file)) {
      return new Response(readFileSync(file, "utf8"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const res = await base(input, init);
    const text = await res.text();
    if (res.ok) {
      try {
        const env = JSON.parse(text) as { error?: unknown; result?: unknown };
        if (!env.error && "result" in env) writeFileSync(file, text);
      } catch {
        // Non-JSON success body: don't cache it.
      }
    }
    return new Response(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  };
}
