// Uniswap v3 ChainProvider (Base + Ethereum).
//
// Unit 1: the chain-agnostic foundation — identity + finality + RPC wiring, real and
// testable. Unit 3 fills the data-extraction methods one at a time, each verified
// against the live chain: price samples (2a), pool discovery (2b) and per-address
// activity (2c) are implemented.

import type {
  ActivityParams,
  AddressActivity,
  ChainProvider,
  EpochRange,
  PoolDescriptor,
  PriceSample,
} from "../provider.js";
import { resolveChain, type ChainConfig } from "../chains.js";
import { JsonRpcClient, type BlockHeader, type EvmRpc } from "./rpc.js";
import { FEE_TIERS, computePoolAddress, sortTokens } from "./pool.js";
import { SELECTOR, multicall, type Call } from "./multicall.js";
import { bandEdges } from "./tickmath.js";
import { extractPoolActivity, type ActivityOptions } from "./activity.js";
import type { PoolDepthFloor } from "../config.js";
import type { FetchLike } from "../http.js";
import {
  PriceError,
  lastBlockAtOrBefore,
  orientPool,
  priceQ96FromSqrt,
} from "./price.js";

const SEL = SELECTOR;

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryError";
  }
}

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
    private readonly activityOptions: ActivityOptions = {},
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

  /**
   * DD-21: pair enumeration, no log scan. For each base token × quote asset × fee tier,
   * read factory.getPool at `atBlock` (Multicall3, one pinned block) and require any
   * deployed pool to sit at its CREATE2 address. Deployed pools are kept when
   * initialized (sqrtPriceX96 ≠ 0) and their quote-denominated depth meets the floor
   * for their quote asset (DD-23).
   */
  async poolsAboveFloor(
    floor: PoolDepthFloor,
    atBlock: number,
    baseTokens: readonly string[],
  ): Promise<PoolDescriptor[]> {
    const quotes = this.cfg.quoteAssets;
    const candidates: { token0: string; token1: string; expected: string; factory: string; fee: number }[] = [];
    for (const dex of this.cfg.dexes) {
      for (const base of baseTokens) {
        if (quotes.includes(base.toLowerCase())) {
          throw new DiscoveryError(`base token ${base} is a quote asset on chain ${this.cfg.chainId}`);
        }
        for (const quote of quotes) {
          for (const fee of FEE_TIERS) {
            const [token0, token1] = sortTokens(base, quote);
            const expected = computePoolAddress(dex.factory, { tokenA: base, tokenB: quote, fee }, dex.initCodeHash);
            candidates.push({ token0, token1, expected, factory: dex.factory, fee });
          }
        }
      }
    }
    const got = await multicall(
      this.rpc,
      candidates.map((c) => ({
        target: c.factory,
        data: `${SEL.getPool}${hexWord(BigInt(c.token0))}${hexWord(BigInt(c.token1))}${hexWord(BigInt(c.fee))}`,
      })),
      atBlock,
    );
    const deployed = candidates.filter((c, i) => {
      const addr = word(got[i]!, 0);
      if (addr === 0n) return false;
      if (addr !== BigInt(c.expected)) {
        throw new DiscoveryError(`factory.getPool returned 0x${addr.toString(16)}, CREATE2 gives ${c.expected}`);
      }
      return true;
    });

    const state = await multicall(
      this.rpc,
      deployed.flatMap((c): Call[] => [
        { target: c.expected, data: SEL.liquidity },
        { target: c.expected, data: SEL.slot0 },
      ]),
      atBlock,
    );
    const live = deployed
      .map((c, i) => ({ ...c, liquidity: word(state[2 * i]!, 0), sqrtPriceX96: word(state[2 * i + 1]!, 0) }))
      .filter((c) => c.sqrtPriceX96 !== 0n);

    // DD-23 floor: quote-denominated depth min(bid, ask) within ±floor.bandBps, from
    // QuoterV2 at atBlock — bid = quote out selling base to the bid edge; ask = quote in
    // (net of the pool fee) buying base to the ask edge. Only pools whose quote asset
    // has a floor are measured.
    const floored = live
      .map((c) => {
        const o = orientPool(quotes, BigInt(c.token0), BigInt(c.token1));
        const quote = o.baseIsToken0 ? c.token1 : c.token0;
        return { ...c, o, quote, base: o.baseIsToken0 ? c.token0 : c.token1, min: floor.minQuote[quote] ?? 0n };
      })
      .filter((c) => c.min > 0n);
    const quoter = this.cfg.dexes[0]!.quoterV2;
    const quotes2 = await multicall(
      this.rpc,
      floored.flatMap((c): Call[] => {
        const e = bandEdges(c.sqrtPriceX96, floor.bandBps, c.o.baseIsToken0);
        const params = (tin: string, tout: string, limit: bigint): string =>
          hexWord(BigInt(tin)) + hexWord(BigInt(tout)) + hexWord(1n << 200n) + hexWord(BigInt(c.fee)) + hexWord(limit);
        return [
          { target: quoter, data: SEL.quoteExactInputSingle + params(c.base, c.quote, e.bidEdge) },
          { target: quoter, data: SEL.quoteExactOutputSingle + params(c.quote, c.base, e.askEdge) },
        ];
      }),
      atBlock,
    );
    const failing = new Set<string>();
    floored.forEach((c, i) => {
      const bid = word(quotes2[2 * i]!, 0);
      const ask = (word(quotes2[2 * i + 1]!, 0) * BigInt(1_000_000 - c.fee)) / 1_000_000n;
      if ((bid < ask ? bid : ask) < c.min) failing.add(c.expected);
    });

    return live
      .filter((c) => !failing.has(c.expected))
      .map(
        (c): PoolDescriptor => ({
          poolAddr: BigInt(c.expected),
          token0: BigInt(c.token0),
          token1: BigInt(c.token1),
          liquidity: c.liquidity,
          dex: "uniswap-v3",
        }),
      )
      .sort((a, b) => (a.poolAddr < b.poolAddr ? -1 : a.poolAddr > b.poolAddr ? 1 : 0));
  }

  /** Flows (DD-22), LP positions (DD-24) and quote-denominated depth (DD-23); see activity.ts. */
  async poolActivity(pool: PoolDescriptor, range: EpochRange, params: ActivityParams): Promise<AddressActivity[]> {
    return extractPoolActivity(this.rpc, this.cfg, pool, range, params, this.activityOptions);
  }

  /**
   * Spot price (Q96, raw quote per raw base; see price.ts) at each of `times`, read from
   * slot0 at the last block in [startBlock, endBlock] whose timestamp is ≤ that time.
   * Times before startBlock's timestamp have no in-range state and are not sampled.
   * Inputs are only (pool, block): no clocks.
   */
  async poolPriceSamples(
    pool: PoolDescriptor,
    range: EpochRange,
    times: readonly number[],
  ): Promise<PriceSample[]> {
    const addr = toAddr(pool.poolAddr);
    for (let i = 0; i < times.length; i++) {
      const t = times[i]!;
      if (t < range.startTs || t > range.endTs || (i > 0 && t <= times[i - 1]!)) {
        throw new PriceError("sample times must ascend strictly inside [startTs, endTs]");
      }
    }
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
    for (const ts of times) {
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

const hexWord = (v: bigint): string => v.toString(16).padStart(64, "0");

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
  /** Position-registry cache file (DD-24); without it each epoch rescans every NFT id. */
  readonly registryPath?: string;
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
  return new UniswapV3ChainProvider(cfg, rpc, opts.registryPath === undefined ? {} : { registryPath: opts.registryPath });
}
