import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchLike } from "../http.js";
import { cachingFetch, isCacheable } from "./rpc-cache.js";

const URL_A = "https://base-mainnet.g.alchemy.com/v2/KEY";

function body(method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
}

/** A base fetch that counts calls and returns a canned JSON-RPC body. */
function counting(result: unknown, status = 200): { fetch: FetchLike; calls: () => number } {
  let n = 0;
  const fetch: FetchLike = async () => {
    n += 1;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status });
  };
  return { fetch, calls: () => n };
}

describe("isCacheable", () => {
  it("caches concrete-block calls, never head queries", () => {
    expect(isCacheable("eth_call", [{ to: "0x", data: "0x" }, "0x64"])).toBe(true);
    expect(isCacheable("eth_getLogs", [{ fromBlock: "0x1", toBlock: "0xa" }])).toBe(true);
    expect(isCacheable("eth_blockNumber", [])).toBe(false);
    expect(isCacheable("eth_getBlockByNumber", ["finalized", false])).toBe(false);
    expect(isCacheable("eth_getBlockByNumber", ["latest", false])).toBe(false);
    expect(isCacheable("", [])).toBe(false);
  });
});

describe("cachingFetch", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rpc-cache-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves a repeated pinned call from disk without a second network hit", async () => {
    const base = counting("0x2105");
    const f = cachingFetch(base.fetch, dir);
    const r1 = await f(URL_A, { method: "POST", body: body("eth_call", [{ to: "0x1" }, "0x64"]) });
    const r2 = await f(URL_A, { method: "POST", body: body("eth_call", [{ to: "0x1" }, "0x64"]) });
    expect(JSON.parse(await r1.text()).result).toBe("0x2105");
    expect(JSON.parse(await r2.text()).result).toBe("0x2105");
    expect(base.calls()).toBe(1); // second call hit the cache
  });

  it("does not cache the finalized-head query", async () => {
    const base = counting({ number: "0x64" });
    const f = cachingFetch(base.fetch, dir);
    await f(URL_A, { method: "POST", body: body("eth_getBlockByNumber", ["finalized", false]) });
    await f(URL_A, { method: "POST", body: body("eth_getBlockByNumber", ["finalized", false]) });
    expect(base.calls()).toBe(2);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("does not cache an error response", async () => {
    let n = 0;
    const base: FetchLike = async () => {
      n += 1;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "x" } }), {
        status: 200,
      });
    };
    const f = cachingFetch(base, dir);
    await f(URL_A, { method: "POST", body: body("eth_call", [{ to: "0x1" }, "0x64"]) });
    await f(URL_A, { method: "POST", body: body("eth_call", [{ to: "0x1" }, "0x64"]) });
    expect(n).toBe(2);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("keys by host, so different chains do not collide", async () => {
    const base = counting("0x1");
    const f = cachingFetch(base.fetch, dir);
    await f("https://eth-mainnet.g.alchemy.com/v2/KEY", { method: "POST", body: body("eth_chainId", []) });
    await f("https://base-mainnet.g.alchemy.com/v2/KEY", { method: "POST", body: body("eth_chainId", []) });
    expect(base.calls()).toBe(2); // distinct hosts -> distinct cache entries
  });
});
