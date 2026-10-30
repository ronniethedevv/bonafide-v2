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
  };
}
