// @mmr/dapp — midnight-js provider wiring for Preview.
//
// Six providers: private state (LevelDB), public data (indexer), ZK config
// (local keys), proof (local proof server), wallet (balancing) and midnight
// (submission). The last two are one headless-wallet object in both slots.

import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import type { MidnightProvider, WalletProvider } from "@midnight-ntwrk/midnight-js-types";
import type { DappConfig } from "./config.js";
import { PRIVATE_STATE_ID, type EpochProofCircuitId, type EpochProofPrivateState } from "./contract.js";

export function buildProviders(
  cfg: DappConfig,
  wallet: WalletProvider & MidnightProvider,
  /** Scopes the private-state store; must be stable across runs for one wallet. */
  accountId: string,
) {
  // Reads keys/<circuit>.prover|.verifier and zkir/<circuit>.bzkir under this dir.
  const zkConfigProvider = new NodeZkConfigProvider<EpochProofCircuitId>(cfg.zkConfigPath);

  return {
    // Encrypted + account-scoped. This store holds the contract maintenance
    // signing key deployContract generates, which cannot be recovered from the
    // chain -- the password and accountId must stay the same across runs.
    privateStateProvider: levelPrivateStateProvider<typeof PRIVATE_STATE_ID, EpochProofPrivateState>({
      privateStateStoreName: "mmr-epoch-proof-private-state",
      privateStoragePasswordProvider: async () => cfg.privateStatePassword,
      accountId,
    }),
    publicDataProvider: indexerPublicDataProvider(cfg.indexerUrl, cfg.indexerWsUrl),
    zkConfigProvider,
    // The 5-min default is far below a k=20 proveEpoch proof on a laptop.
    proofProvider: httpClientProofProvider(cfg.proofServerUrl, zkConfigProvider, {
      timeout: cfg.proofTimeoutMs,
    }),
    walletProvider: wallet,
    midnightProvider: wallet,
  };
}

export type MmrProviders = ReturnType<typeof buildProviders>;
