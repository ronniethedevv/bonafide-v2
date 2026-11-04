// Proxy-aware fetch for the archive-RPC client.
//
// Node's built-in `fetch` ignores HTTPS_PROXY, so in an environment where outbound
// HTTPS is only reachable through a proxy (e.g. a managed cloud session), the archive
// RPC is unreachable through the global fetch even when the URL and key are correct.
// When a proxy is configured we route requests through undici's ProxyAgent; with no
// proxy set (a host with direct egress, e.g. a laptop) we return the global fetch
// unchanged, so nothing about the direct-network path changes.
//
// This touches transport only — never the request/response bytes — so it cannot affect
// a computed root.

import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { FetchLike } from "../http.js";

/** The proxy URL from the usual env vars, or undefined for direct egress. */
export function proxyFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy ?? undefined;
}

/**
 * A `FetchLike` that reaches the RPC through the configured proxy when one is set,
 * and is the plain global fetch otherwise. One ProxyAgent is created and reused.
 */
export function rpcFetch(env: Record<string, string | undefined> = process.env): FetchLike {
  const proxy = proxyFromEnv(env);
  if (!proxy) return (input, init) => fetch(input, init);
  const dispatcher = new ProxyAgent(proxy);
  return (input, init) =>
    undiciFetch(input, { ...(init ?? {}), dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}
