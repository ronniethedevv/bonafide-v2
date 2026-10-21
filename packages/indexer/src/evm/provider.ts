// Uniswap v3 ChainProvider (Base + Ethereum).
//
// Unit 1: the chain-agnostic foundation — identity + finality + RPC wiring, real and
// testable. The data-extraction methods (pool discovery, per-address activity, price
// samples) require live archive-RPC verification of Uniswap v3 tick/liquidity math to
// implement WITHOUT guessing, so they are staged behind a typed NotImplementedError
// rather than returning fabricated data. They land in the next units, each verified
// against live logs in a session with RPC access.

import type {
  AddressActivity,
  ChainProvider,
  EpochRange,
  PoolDescriptor,
  PriceSample,
} from "../provider.js";
import { resolveChain, type ChainConfig } from "../chains.js";
import { JsonRpcClient, type EvmRpc } from "./rpc.js";
import type { FetchLike } from "../http.js";

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (needs live archive-RPC verification)`);
    this.name = "NotImplementedError";
  }
}

export class UniswapV3ChainProvider implements ChainProvider {
  constructor(
    private readonly cfg: ChainConfig,
    private readonly rpc: EvmRpc,
  ) {}

  chainId(): number {
    return this.cfg.chainId;
  }

  async finalizedBlock(): Promise<number> {
    return this.rpc.finalizedBlockNumber();
  }

  /** Confirm the connected node actually serves this chain (catches a wrong URL). */
  async assertChainId(): Promise<void> {
    const got = await this.rpc.chainId();
    if (got !== this.cfg.chainId) {
      throw new Error(`RPC chainId ${got} does not match configured ${this.cfg.chainId}`);
    }
  }

  async poolsAboveFloor(_floor: bigint, _atBlock: number): Promise<PoolDescriptor[]> {
    throw new NotImplementedError("poolsAboveFloor");
  }

  async poolActivity(_pool: PoolDescriptor, _range: EpochRange): Promise<AddressActivity[]> {
    throw new NotImplementedError("poolActivity");
  }

  async poolPriceSamples(_pool: PoolDescriptor, _range: EpochRange): Promise<PriceSample[]> {
    throw new NotImplementedError("poolPriceSamples");
  }
}

export interface ProviderOptions {
  /** RPC url; defaults to the chain's configured env var. */
  readonly rpcUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
  readonly env?: Record<string, string | undefined>;
}

/** Build a provider for a supported chain, reading the RPC url from env by default. */
export function uniswapV3Provider(chainId: number, opts: ProviderOptions = {}): UniswapV3ChainProvider {
  const cfg = resolveChain(chainId);
  const env = opts.env ?? process.env;
  const rpcUrl = opts.rpcUrl ?? env[cfg.rpcEnvVar];
  if (!rpcUrl) throw new Error(`${cfg.rpcEnvVar} is not set (RPC url for ${cfg.name})`);
  const rpc = new JsonRpcClient({
    url: rpcUrl,
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    ...(opts.fetchImpl === undefined ? {} : { fetchImpl: opts.fetchImpl }),
  });
  return new UniswapV3ChainProvider(cfg, rpc);
}
