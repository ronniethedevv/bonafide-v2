// Uniswap v3 ChainProvider (Base + Ethereum).
//
// Unit 1: the chain-agnostic foundation — identity + finality + RPC wiring, real and
// testable. Unit 3 fills the data-extraction methods one at a time, each verified
// against the live chain: price samples (2a) are done; pool discovery and per-address
// activity still require live verification of Uniswap v3 tick/liquidity math, so they
// stay behind a typed NotImplementedError rather than returning fabricated data.

import type {
  AddressActivity,
  ChainProvider,
  EpochRange,
  PoolDescriptor,
  PriceSample,
} from "../provider.js";
import { resolveChain, type ChainConfig } from "../chains.js";
import { DEFAULT_CONFIG } from "../config.js";
import { JsonRpcClient, type BlockHeader, type EvmRpc } from "./rpc.js";
import type { FetchLike } from "../http.js";
import {
  PriceError,
  lastBlockAtOrBefore,
  orientPool,
  priceQ96FromSqrt,
  sampleTimes,
} from "./price.js";

/** 4-byte selectors of the pool views read here. */
const SEL = { slot0: "0x3850c7bd", token0: "0x0dfe1681", token1: "0xd21220a7" } as const;

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
    /** Spacing of price samples in seconds; feeds the reference price, so fixed per epoch. */
    private readonly priceSampleSeconds: number = DEFAULT_CONFIG.bucketSeconds,
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

  /**
   * Spot price (Q96, raw quote per raw base; see price.ts) at every sample time in
   * [startTs, endTs], read from slot0 at the last block in [startBlock, endBlock] whose
   * timestamp is ≤ that time. Times before startBlock's timestamp have no in-range
   * state and are not sampled. Inputs are only (pool, block): no clocks.
   */
  async poolPriceSamples(pool: PoolDescriptor, range: EpochRange): Promise<PriceSample[]> {
    const addr = toAddr(pool.poolAddr);
    // Fail loudly if the descriptor does not describe this pool.
    const [t0, t1] = await Promise.all([
      this.rpc.call(addr, SEL.token0, range.endBlock),
      this.rpc.call(addr, SEL.token1, range.endBlock),
    ]);
    if (word(t0, 0) !== pool.token0 || word(t1, 0) !== pool.token1) {
      throw new PriceError(`pool ${addr} tokens do not match its descriptor`);
    }
    const orientation = orientPool(this.cfg.quoteAssets, pool.token0, pool.token1);

    const headers = new Map<number, Promise<BlockHeader>>();
    const header = (n: number): Promise<BlockHeader> => {
      let h = headers.get(n);
      if (!h) headers.set(n, (h = this.rpc.blockHeader(n)));
      return h;
    };

    const samples: PriceSample[] = [];
    let lo = range.startBlock;
    for (const ts of sampleTimes(range.startTs, range.endTs, this.priceSampleSeconds)) {
      const block = await lastBlockAtOrBefore(header, ts, lo, range.endBlock);
      if (block === null) continue;
      lo = block; // sample times ascend, so their blocks do too
      const sqrtPriceX96 = word(await this.rpc.call(addr, SEL.slot0, block), 0);
      samples.push({ ts, price: priceQ96FromSqrt(sqrtPriceX96, orientation) });
    }
    if (samples.length === 0) throw new PriceError(`no block in range for pool ${addr}`);
    return samples;
  }
}

function toAddr(a: bigint): string {
  return `0x${a.toString(16).padStart(40, "0")}`;
}

/** The i-th 32-byte word of hex-encoded return data, as an unsigned integer. */
function word(hex: string, i: number): bigint {
  const w = hex.slice(2 + 64 * i, 2 + 64 * (i + 1));
  if (!/^0x/.test(hex) || w.length !== 64) throw new PriceError(`short eth_call return: ${hex}`);
  return BigInt(`0x${w}`);
}

export interface ProviderOptions {
  /** RPC url; defaults to the chain's configured env var. */
  readonly rpcUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
  readonly env?: Record<string, string | undefined>;
  /** Price sample spacing in seconds (default: the indexer's bucket length). */
  readonly priceSampleSeconds?: number;
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
  return new UniswapV3ChainProvider(cfg, rpc, opts.priceSampleSeconds);
}
