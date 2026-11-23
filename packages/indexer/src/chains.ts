// Supported EVM chains and their Uniswap v3 deployments.
//
// The indexer is per-chain (an engagement names its chain; roots are computed per
// chain, so a Base pool and an Ethereum pool can never collide — the circuit opens
// one chain's rootOfRoots and is unchanged). Uniswap v3 has identical contract ABIs
// on both chains; only the factory address differs, so one provider serves both.
// Aerodrome Slipstream (Base-only) is a separate DEX/provider added later.
//
// The factory addresses and the canonical pool init-code hash are fixed, public
// protocol constants; [verify] against the live chain in a session with RPC access.

export type ChainName = "ethereum" | "base";

export interface DexConfig {
  readonly kind: "uniswap-v3";
  /** UniswapV3Factory address (lowercase for case-insensitive compares). */
  readonly factory: string;
  /** keccak256 of the pool creation bytecode; same for canonical Uniswap v3. */
  readonly initCodeHash: string;
  /** NonfungiblePositionManager (LP positions as NFTs). */
  readonly positionManager: string;
  /** QuoterV2 (swap simulation; measures pool depth for the floor, DD-23). */
  readonly quoterV2: string;
}

export interface ChainConfig {
  readonly chainId: number;
  readonly name: ChainName;
  /** Env var holding this chain's archive RPC URL (never hard-coded/committed). */
  readonly rpcEnvVar: string;
  /** Optional wide-range eth_getLogs endpoint; blocks, state and receipts stay on rpcEnvVar. */
  readonly logsRpcEnvVar: string;
  readonly dexes: readonly DexConfig[];
  /**
   * Quote assets, ranked strongest first (lowercase). A pool's base token is the one
   * that is not a quote asset; if both are, the higher-ranked one is the quote. A pool
   * with no quote asset cannot be oriented and is not priced. Fixed per chain: it
   * decides the orientation of every price and amount that feeds a root.
   */
  readonly quoteAssets: readonly string[];
}

/** Canonical Uniswap v3 pool init-code hash (identical across canonical deployments). */
const UNIV3_INIT_CODE_HASH =
  "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";

const UNIV3: Record<ChainName, string> = {
  ethereum: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
  base: "0x33128a8fc17869897dce68ed026d694621f6fdfd",
};

export const CHAINS: Readonly<Record<number, ChainConfig>> = {
  1: {
    chainId: 1,
    name: "ethereum",
    rpcEnvVar: "ETH_ARCHIVE_RPC_URL",
    logsRpcEnvVar: "ETH_LOGS_RPC_URL",
    // positionManager / quoterV2: name() and factory() checked live (factory = UNIV3.ethereum).
    dexes: [
      {
        kind: "uniswap-v3",
        factory: UNIV3.ethereum,
        initCodeHash: UNIV3_INIT_CODE_HASH,
        positionManager: "0xc36442b4a4522e871399cd717abdd847ab11fe88",
        quoterV2: "0x61ffe014ba17989e743c5f6cb21bf9697530b21e",
      },
    ],
    // USDC, USDT, WETH — symbol()/decimals() checked on mainnet (6, 6, 18).
    quoteAssets: [
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      "0xdac17f958d2ee523a2206206994597c13d831ec7",
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    ],
  },
  8453: {
    chainId: 8453,
    name: "base",
    rpcEnvVar: "BASE_ARCHIVE_RPC_URL",
    logsRpcEnvVar: "BASE_LOGS_RPC_URL",
    // positionManager / quoterV2: name() and factory() checked live (factory = UNIV3.base).
    dexes: [
      {
        kind: "uniswap-v3",
        factory: UNIV3.base,
        initCodeHash: UNIV3_INIT_CODE_HASH,
        positionManager: "0x03a520b32c04bf3beef7beb72e919cf822ed34f1",
        quoterV2: "0x3d4e44eb1374240ce5f1b871ab261cd16335b76a",
      },
    ],
    // USDC, USDbC (bridged), WETH — symbol()/decimals() checked on Base (6, 6, 18).
    quoteAssets: [
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
      "0x4200000000000000000000000000000000000006",
    ],
  },
};

export function resolveChain(chainId: number): ChainConfig {
  const cfg = CHAINS[chainId];
  if (!cfg) {
    const known = Object.keys(CHAINS).join(", ");
    throw new Error(`unsupported chainId ${chainId}; known chains: ${known}`);
  }
  return cfg;
}

export function isSupportedChain(chainId: number): boolean {
  return chainId in CHAINS;
}
