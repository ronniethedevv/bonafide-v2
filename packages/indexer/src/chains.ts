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
}

export interface ChainConfig {
  readonly chainId: number;
  readonly name: ChainName;
  /** Env var holding this chain's archive RPC URL (never hard-coded/committed). */
  readonly rpcEnvVar: string;
  readonly dexes: readonly DexConfig[];
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
    dexes: [{ kind: "uniswap-v3", factory: UNIV3.ethereum, initCodeHash: UNIV3_INIT_CODE_HASH }],
  },
  8453: {
    chainId: 8453,
    name: "base",
    rpcEnvVar: "BASE_ARCHIVE_RPC_URL",
    dexes: [{ kind: "uniswap-v3", factory: UNIV3.base, initCodeHash: UNIV3_INIT_CODE_HASH }],
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
