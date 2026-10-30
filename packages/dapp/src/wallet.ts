// @mmr/dapp — Headless wallet for the deploy process.
//
// A Midnight wallet is three sub-wallets (shielded / unshielded / DUST) derived
// from one seed and unified behind a WalletFacade. This module builds that from
// DEPLOY_SEED and adapts it to midnight-js's WalletProvider + MidnightProvider.
//
// Ledger types come from @midnight-ntwrk/midnight-js-protocol/ledger, never from
// @midnight-ntwrk/ledger-v8 directly: the protocol package re-exports the exact
// copies midnight-js compiles against, and a second copy breaks `instanceof`.

import {
  DustSecretKey,
  LedgerParameters,
  ZswapSecretKeys,
  type CoinPublicKey,
  type EncPublicKey,
  type FinalizedTransaction,
} from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import type {
  MidnightProvider,
  UnboundTransaction,
  WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import {
  DustWallet,
  HDWallet,
  NoOpTransactionHistoryStorage,
  PublicKey,
  Roles,
  ShieldedWallet,
  UnshieldedWallet,
  WalletFacade,
  createKeystore,
  type UnshieldedKeystore,
} from "@midnightntwrk/wallet-sdk";
import { mnemonicToSeedSync, validateMnemonic } from "bip39";
import * as Rx from "rxjs";
import type { DappConfig } from "./config.js";

/** A 24-word mnemonic becomes its BIP-39 seed; a hex string is used as-is. */
function toSeedBytes(secret: string): Uint8Array {
  if (/^(0x)?[0-9a-fA-F]{64,128}$/.test(secret)) {
    return Uint8Array.from(Buffer.from(secret.replace(/^0x/, ""), "hex"));
  }
  const words = secret.trim().split(/\s+/);
  if (words.length < 12) {
    throw new Error("DEPLOY_SEED must be a BIP-39 mnemonic (12/24 words) or a hex seed.");
  }
  const mnemonic = words.join(" ");
  if (!validateMnemonic(mnemonic)) {
    throw new Error("DEPLOY_SEED is not a valid BIP-39 mnemonic (checksum failed).");
  }
  return Uint8Array.from(mnemonicToSeedSync(mnemonic));
}

export interface HeadlessWallet {
  readonly facade: WalletFacade;
  /** Implements both WalletProvider and MidnightProvider; pass as both. */
  readonly provider: WalletProvider & MidnightProvider;
  readonly shieldedAddress: string;
  readonly nightBalance: bigint;
  readonly dustBalance: bigint;
  stop(): Promise<void>;
}

/** Builds, starts and syncs the deploy wallet, then adapts it to midnight-js. */
export async function buildHeadlessWallet(cfg: DappConfig): Promise<HeadlessWallet> {
  const hd = HDWallet.fromSeed(toSeedBytes(cfg.deploySeed));
  if (hd.type !== "seedOk") throw new Error(`Invalid deploy seed: ${String(hd.error)}`);
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== "keysDerived") throw new Error("HD key derivation failed");
  hd.hdWallet.clear();

  const shieldedSecretKeys = ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);
  const dustSecretKey = DustSecretKey.fromSeed(derived.keys[Roles.Dust]);
  const keystore: UnshieldedKeystore = createKeystore(
    derived.keys[Roles.NightExternal],
    getNetworkId(),
  );

  const connection = {
    networkId: getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: cfg.indexerUrl,
      indexerWsUrl: cfg.indexerWsUrl,
    },
    provingServerUrl: new URL(cfg.proofServerUrl),
    relayURL: new URL(cfg.nodeUrl.replace(/^http/, "ws")),
    // A deploy process keeps no history; the chain is the record.
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
  };
  const configuration = {
    ...connection,
    costParameters: {
      // A DUST spend has no refund, so this overhead is spent in full.
      additionalFeeOverhead: 300_000_000_000_000n, // 0.3 DUST
      feeBlocksMargin: 5,
    },
  };

  const facade = await WalletFacade.init({
    configuration,
    shielded: (c) => ShieldedWallet(c).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (c) => UnshieldedWallet(c).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
    dust: (c) =>
      DustWallet(c).startWithSecretKey(
        dustSecretKey,
        LedgerParameters.initialParameters().dust,
      ),
  });
  await facade.start(shieldedSecretKeys, dustSecretKey);

  const state = await waitForSync(facade, cfg);

  const provider: WalletProvider & MidnightProvider = {
    getCoinPublicKey(): CoinPublicKey {
      return shieldedSecretKeys.coinPublicKey;
    },
    getEncryptionPublicKey(): EncPublicKey {
      return shieldedSecretKeys.encryptionPublicKey;
    },
    async balanceTx(tx: UnboundTransaction, ttl?: Date): Promise<FinalizedTransaction> {
      const recipe = await facade.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys, dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 60 * 60 * 1000) },
      );
      // Balancing may add unshielded inputs; the node rejects those unsigned.
      const signed = await facade.signRecipe(recipe, (payload) => keystore.signData(payload));
      return facade.finalizeRecipe(signed);
    },
    submitTx(tx: FinalizedTransaction): Promise<string> {
      return facade.submitTransaction(tx);
    },
  };

  return {
    facade,
    provider,
    shieldedAddress: String(await facade.shielded.getAddress()),
    nightBalance: readNight(state),
    dustBalance: readDust(state),
    stop: () => facade.stop(),
  };
}

/**
 * Waits for the wallet to finish syncing, logging progress and failing with a
 * clear message instead of hanging forever. A fresh wallet on a public network
 * can take a long time to reach `isSynced`, so this is bounded, not patient.
 */
async function waitForSync(facade: WalletFacade, cfg: DappConfig) {
  const timeoutMs = cfg.syncTimeoutMs;
  const started = Date.now();
  let lastLogged = 0;
  return Rx.firstValueFrom(
    facade.state().pipe(
      Rx.tap((s) => {
        const elapsed = Date.now() - started;
        if (elapsed - lastLogged >= 15_000) {
          lastLogged = elapsed;
          console.log(
            `  …syncing (${Math.round(elapsed / 1000)}s) synced=${s.isSynced} ` +
              `shielded=${progress(s.shielded)} unshielded=${progress(s.unshielded)} dust=${progress(s.dust)}`,
          );
        }
      }),
      Rx.filter((s) => s.isSynced),
      Rx.timeout({
        first: timeoutMs,
        with: () =>
          Rx.throwError(
            () =>
              new Error(
                `Wallet did not reach a synced state within ${Math.round(timeoutMs / 1000)}s. ` +
                  `Check the indexer (${cfg.indexerUrl}) and node relay are reachable, or raise ` +
                  `MMR_SYNC_TIMEOUT_MS. A brand-new wallet syncs from genesis and is slow.`,
              ),
          ),
      }),
    ),
  );
}

/**
 * Renders one sub-wallet's sync position as "applied/target". Shielded and DUST
 * report appliedIndex/highestRelevantWalletIndex; unshielded reports
 * appliedId/highestTransactionId. Names vary by SDK build, hence the probing.
 */
function progress(section: unknown): string {
  const s = section as Record<string, unknown> | null | undefined;
  if (!s) return "?";
  const p = (s.syncProgress ?? s.progress ?? s) as Record<string, unknown>;
  const applied = p.appliedIndex ?? p.appliedId;
  const target = p.highestRelevantWalletIndex ?? p.highestTransactionId ?? p.highestIndex;
  if (applied === undefined && target === undefined) return "n/a";
  return `${String(applied ?? "?")}/${String(target ?? "?")}`;
}

/** Balance readers kept defensive: the facade's state shape varies by SDK build. */
function readNight(state: unknown): bigint {
  const s = state as { unshielded?: { balances?: Record<string, bigint> } };
  const balances = s.unshielded?.balances ?? {};
  return Object.values(balances).reduce((a, b) => a + BigInt(b), 0n);
}

function readDust(state: unknown): bigint {
  const s = state as { dust?: { walletBalance?: (at: Date) => bigint } };
  try {
    return s.dust?.walletBalance?.(new Date()) ?? 0n;
  } catch {
    return 0n;
  }
}
