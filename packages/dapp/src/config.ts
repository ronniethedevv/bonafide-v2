// @mmr/dapp — Environment configuration loader.
//
// Reads packages/dapp/.env first (the runbook's Phase-0 location), then falls
// back to the workspace-root .env so an existing root config keeps working.
// Every non-secret key has a Preview-support-matrix fallback; the seed has
// none, because a wrong seed silently deploys from an empty wallet.

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** packages/dapp/.env wins; the root .env fills whatever it left unset. */
config({ path: resolve(here, "..", ".env") });
config({ path: resolve(here, "../../..", ".env") });

export interface DappConfig {
  /** One of: undeployed | devnet | testnet | preview | preprod | mainnet. */
  networkId: string;
  /** Midnight node RPC URL (HTTP); the relay URL is derived from it. */
  nodeUrl: string;
  /** Midnight indexer GraphQL URL. */
  indexerUrl: string;
  /** Midnight indexer GraphQL WebSocket URL. */
  indexerWsUrl: string;
  /** Local proof server URL (Docker, port 6300). */
  proofServerUrl: string;
  /** Directory holding keys/*.prover|.verifier + zkir/*.bzkir for epoch_proof. */
  zkConfigPath: string;
  /** Per-circuit proof timeout, ms. proveEpoch at k=20 blows past the 5-min default. */
  proofTimeoutMs: number;
  /**
   * How long to wait for the wallet to reach a synced state, ms. A first sync
   * on Preview replays ~280k wallet indices from genesis (measured ~130/s
   * shielded, ~60/s dust), so it runs 40-80 min; later runs are only faster if
   * the wallet state is persisted.
   */
  syncTimeoutMs: number;
  /** 24-word BIP-39 mnemonic (or 64-char hex seed) for the deploy wallet. */
  deploySeed: string;
  /** Encrypts the LevelDB private-state store (which holds contract signing keys). */
  privateStatePassword: string;
  /**
   * Amount added to every fee the wallet declares. A DUST spend has no refund,
   * so this is spent in full on ordinary fees; `feeBlocksMargin` already covers
   * price rises, and the SDK default is 0n. It also inflates what a first
   * registration must wait to accrue, since `estimateRegistration` includes it,
   * so keep it 0 unless a fee is actually coming up short.
   */
  additionalFeeOverhead: bigint;
  /** How long to wait for retroactive DUST to accrue to a NIGHT UTXO, ms. */
  dustWaitTimeoutMs: number;
}

function env(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

function requireEnv(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.trim() !== "") return v.trim();
  }
  throw new Error(
    `Missing deploy seed. Set one of ${keys.join(" / ")} in packages/dapp/.env ` +
      `(gitignored — never commit it). See .env.example.`,
  );
}

export function loadConfig(): DappConfig {
  const indexerUrl = env(
    "MIDNIGHT_INDEXER_URL",
    "https://indexer.preview.midnight.network/api/v4/graphql",
  );
  return {
    networkId: env("NETWORK_ID", env("MIDNIGHT_NETWORK", "preview")),
    nodeUrl: env("MIDNIGHT_NODE_URL", env("MIDNIGHT_NODE_RPC_URL", "https://rpc.preview.midnight.network")),
    indexerUrl,
    indexerWsUrl: env("MIDNIGHT_INDEXER_WS_URL", indexerUrl.replace(/^http/, "ws") + "/ws"),
    proofServerUrl: env("PROOF_SERVER_URL", env("MIDNIGHT_PROOF_SERVER_URL", "http://localhost:6300")),
    zkConfigPath: env(
      "MMR_ZK_CONFIG_PATH",
      resolve(here, "../../contracts/dist/epoch_proof"),
    ),
    proofTimeoutMs: Number(env("MMR_PROOF_TIMEOUT_MS", String(45 * 60 * 1000))),
    syncTimeoutMs: Number(env("MMR_SYNC_TIMEOUT_MS", String(90 * 60 * 1000))),
    deploySeed: requireEnv("DEPLOY_SEED", "MIDNIGHT_WALLET_SEED"),
    privateStatePassword: env("PRIVATE_STATE_PASSWORD", "mmr-local-private-state"),
    additionalFeeOverhead: BigInt(env("MMR_ADDITIONAL_FEE_OVERHEAD", "0")),
    dustWaitTimeoutMs: Number(env("MMR_DUST_WAIT_TIMEOUT_MS", String(30 * 60 * 1000))),
  };
}
