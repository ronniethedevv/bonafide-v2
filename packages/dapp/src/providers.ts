// @mmr/dapp — Midnight.js 5 provider wiring for Preview.
//
// Six providers: private state (LevelDB), public data (indexer), ZK config
// (local keys), proof (local proof server), wallet (balancing) and midnight
// (submission), plus the network config every transaction is built with.

import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import type { MidnightProvider, WalletProvider } from "@midnight-ntwrk/midnight-js-types";
import type { DappConfig } from "./config.js";
import { PRIVATE_STATE_ID, type EpochProofCircuitId, type EpochProofPrivateState } from "./contract.js";

export function buildProviders<K extends string = EpochProofCircuitId>(
  cfg: DappConfig,
  wallet: { walletProvider: WalletProvider; midnightProvider: MidnightProvider },
  /** Scopes the private-state store; must be stable across runs for one wallet. */
  accountId: string,
  /** The contract's ZK assets: epoch_proof unless another contract is named. */
  zkConfigPath: string = cfg.zkConfigPath,
) {
  // Reads keys/, zkir/ and compiler/ under this directory.
  const zkConfigProvider = new NodeZkConfigProvider<K>(zkConfigPath);

  return {
    // Encrypted and account-scoped. This store holds the contract maintenance
    // signing key deployContract generates, which cannot be recovered from the
    // chain: the password and accountId must stay the same across runs.
    privateStateProvider: levelPrivateStateProvider<typeof PRIVATE_STATE_ID, EpochProofPrivateState>({
      privateStateStoreName: "mmr-epoch-proof-private-state",
      signingKeyStoreName: "mmr-epoch-proof-signing-keys",
      privateStoragePasswordProvider: async () => cfg.privateStatePassword,
      accountId,
    }),
    publicDataProvider: indexerPublicDataProvider(cfg.indexerUrl, cfg.indexerWsUrl),
    zkConfigProvider,
    // The 5-minute default is too short for the largest circuits on a laptop.
    proofProvider: httpClientProofProvider(cfg.proofServerUrl, zkConfigProvider, {
      timeout: cfg.proofTimeoutMs,
    }),
    walletProvider: wallet.walletProvider,
    midnightProvider: wallet.midnightProvider,
    config: { networkId: cfg.networkId, ttlSeconds: 60 * 60 },
  };
}

export type MmrProviders = ReturnType<typeof buildProviders>;
