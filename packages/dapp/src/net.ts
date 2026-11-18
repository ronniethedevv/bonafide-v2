// @mmr/dapp — honour HTTPS_PROXY for Node's built-in fetch and WebSocket.
//
// The wallet talks to the node and indexer over Node's built-in WebSocket, which uses
// Node's global network dispatcher. Loading the npm `undici` package (the indexer uses it)
// replaces that dispatcher with a plain agent that ignores proxy settings, so behind a
// proxy the wallet's connections fail. Call this after the imports: with HTTPS_PROXY set it
// installs a proxy-aware agent; without one it changes nothing.

import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

export function useEnvProxy(): void {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
}
