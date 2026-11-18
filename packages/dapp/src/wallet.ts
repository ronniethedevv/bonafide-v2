// @mmr/dapp — Headless wallet for the deploy process (wallet SDK 2, ledger 9).
//
// A Midnight wallet is three sub-wallets (shielded / unshielded / DUST) started
// from seeds derived from one master seed and unified behind a WalletFacade.
// This module builds that from DEPLOY_SEED and adapts it to Midnight.js 5's
// WalletProvider + MidnightProvider.
//
// Midnight.js and the wallet SDK each run their own copy of the ledger, so a
// transaction crosses between them as bytes: Midnight.js hands over a v9 handle,
// the wallet decodes it with its own ledger and answers with bytes.

import {
  createLedger9MidnightProvider,
  createLedger9WalletProvider,
  type MidnightProvider,
  type WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { ZswapSecretKeys } from "@midnight-ntwrk/midnight-js-protocol/v9";
import {
  DefaultForkSchedule,
  DustWallet,
  type FacadeState,
  NoOpTransactionHistoryStorage,
  ProtocolVersion,
  PublicKey,
  ShieldedWallet,
  UnshieldedWallet,
  WalletFacade,
  WalletSeeds,
  WalletTransaction,
  createKeystore,
  type UnshieldedKeystore,
} from "@midnightntwrk/wallet-sdk";
import * as WalletLedger from "@midnightntwrk/wallet-sdk/ledger/v9";
import { mnemonicToSeedSync, validateMnemonic } from "bip39";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Rx from "rxjs";
import type { DappConfig } from "./config.js";

/**
 * Where the synced wallet state is cached so a run doesn't re-sync from genesis.
 * Keyed by network; gitignored (`.wallet-state/`). The snapshot lists the
 * wallet's coins but holds no signing key, so it must stay private but is not a
 * secret key. Restore only against the same network the state was saved on.
 */
function walletStatePath(cfg: DappConfig): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", ".wallet-state", `${cfg.networkId}.v9.json`);
}

interface WalletSnapshot { shielded: string; unshielded: string; dust: string }

function loadSnapshot(path: string): WalletSnapshot | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const s = JSON.parse(readFileSync(path, "utf8")) as Partial<WalletSnapshot>;
    if (typeof s.shielded === "string" && typeof s.unshielded === "string" && typeof s.dust === "string") {
      return s as WalletSnapshot;
    }
  } catch {
    // Unreadable or partial snapshot: fall back to a fresh sync.
  }
  return undefined;
}

/** Best-effort snapshot save (atomic via temp + rename, mode 600). Never throws. */
async function saveSnapshot(facade: WalletFacade, path: string): Promise<void> {
  try {
    const snap: WalletSnapshot = {
      shielded: await facade.shielded.serializeState(),
      unshielded: await facade.unshielded.serializeState(),
      dust: await facade.dust.serializeState(),
    };
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(snap), { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    console.warn(`  ! could not save wallet state (non-fatal): ${String(err)}`);
  }
}

/** A 12/24-word mnemonic becomes its BIP-39 seed; a hex string is used as-is. */
export function toMasterSeed(secret: string): Uint8Array {
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
  readonly walletProvider: WalletProvider;
  readonly midnightProvider: MidnightProvider;
  /** Holds the NIGHT (unshielded) key: signs data and yields the verifying key. */
  readonly keystore: UnshieldedKeystore;
  /** The address the faucet pays tNIGHT to (mn_addr_<network>…). */
  readonly unshieldedAddress: string;
  readonly nightBalance: bigint;
  readonly dustBalance: bigint;
  /** The facade state as of the sync that `buildHeadlessWallet` waited for. */
  readonly state: FacadeState;
  /** Waits until the wallet is synced again and returns that state. */
  synced(): Promise<FacadeState>;
  stop(): Promise<void>;
}

/** The protocol version the wallet acts at right now (what it stamps transactions with). */
async function activeVersion(facade: WalletFacade) {
  return (await Rx.firstValueFrom(facade.state())).activeProtocolVersion;
}

/** Hands Midnight.js's transaction bytes to the wallet, decoded with the wallet's own ledger. */
async function adopt<S extends "Unbound" | "Finalized">(facade: WalletFacade, stage: S, bytes: Uint8Array) {
  const tx = WalletLedger.Transaction.deserialize(
    "signature",
    "proof",
    stage === "Unbound" ? "pre-binding" : "binding",
    bytes,
  );
  return WalletTransaction.adopt(stage, tx, await activeVersion(facade));
}

/** Reads the bytes of a finalized wallet transaction, for Midnight.js to seal. */
async function finalizedBytes(facade: WalletFacade, handle: Parameters<typeof WalletTransaction.unwrapWithin>[0]) {
  const epoch = ProtocolVersion.epochOf(await activeVersion(facade), DefaultForkSchedule.v9);
  const unwrapped = WalletTransaction.unwrapWithin(handle, epoch);
  if (unwrapped._tag === "Left") throw unwrapped.left;
  return (unwrapped.right as { serialize(): Uint8Array }).serialize();
}

/** Builds, starts and syncs the deploy wallet, then adapts it to Midnight.js. */
export async function buildHeadlessWallet(cfg: DappConfig): Promise<HeadlessWallet> {
  const seeds = WalletSeeds.fromMasterSeed(toMasterSeed(cfg.deploySeed));
  const networkId = cfg.networkId as Parameters<typeof createKeystore>[1];
  const keystore = createKeystore({ kind: "schnorr", secret: seeds.unshielded }, networkId);
  const shieldedKeys = ZswapSecretKeys.fromSeed(seeds.shielded);

  const configuration = {
    networkId,
    forks: DefaultForkSchedule,
    indexerClientConnection: {
      indexerHttpUrl: cfg.indexerUrl,
      indexerWsUrl: cfg.indexerWsUrl,
    },
    provingServerUrl: new URL(cfg.proofServerUrl),
    relayURL: new URL(cfg.nodeUrl.replace(/^http/, "ws")),
    // A deploy process keeps no history; the chain is the record.
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
    costParameters: {
      // A DUST spend has no refund, so any overhead is spent in full; it also
      // raises what a first DUST registration must wait to accrue. Default 0.
      additionalFeeOverhead: cfg.additionalFeeOverhead,
      feeBlocksMargin: 5,
    },
  };

  // Resume from a cached snapshot when one exists; fall back to a fresh sync if
  // there is none or the restore fails.
  const statePath = walletStatePath(cfg);
  const initFacade = (saved: WalletSnapshot | undefined) =>
    WalletFacade.init({
      configuration,
      shielded: (c) => (saved ? ShieldedWallet(c).restore(saved.shielded) : ShieldedWallet(c).startWithSeed(seeds.shielded)),
      unshielded: (c) =>
        saved ? UnshieldedWallet(c).restore(saved.unshielded) : UnshieldedWallet(c).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
      dust: (c) => (saved ? DustWallet(c).restore(saved.dust) : DustWallet(c).startWithSeed(seeds.dust)),
    });

  const saved = loadSnapshot(statePath);
  let facade: WalletFacade;
  try {
    if (saved) console.log("  restoring wallet state from cache…");
    facade = await initFacade(saved);
    await facade.start(seeds);
  } catch (err) {
    if (!saved) throw err;
    console.warn(`  ! cached wallet state unusable (${String(err)}); syncing fresh`);
    rmSync(statePath, { force: true });
    facade = await initFacade(undefined);
    await facade.start(seeds);
  }

  let state: FacadeState;
  try {
    state = await waitForSync(facade, cfg);
  } catch (err) {
    if (saved) {
      rmSync(statePath, { force: true });
      throw new Error(`${String(err)}\n  (dropped the cached wallet state at ${statePath}; re-run to sync fresh.)`);
    }
    throw err;
  }
  await saveSnapshot(facade, statePath);

  const walletProvider = createLedger9WalletProvider({
    getCoinPublicKey: () => shieldedKeys.coinPublicKey,
    getEncryptionPublicKey: () => shieldedKeys.encryptionPublicKey,
    async balanceTx(tx, ttl) {
      const recipe = await facade.balanceUnboundTransaction(await adopt(facade, "Unbound", tx.serialize()), {
        ttl: ttl ?? new Date(Date.now() + 60 * 60 * 1000),
      });
      // Balancing may add unshielded inputs; the node rejects those unsigned.
      const signed = await facade.signRecipe(recipe, (payload) => keystore.signDataAsync(payload));
      return finalizedBytes(facade, await facade.finalizeRecipe(signed));
    },
  });
  const midnightProvider = createLedger9MidnightProvider(async (tx) =>
    String(await facade.submitTransaction(await adopt(facade, "Finalized", tx.serialize()))),
  );

  return {
    facade,
    walletProvider,
    midnightProvider,
    keystore,
    unshieldedAddress: String(keystore.getBech32Address()),
    nightBalance: readNight(state),
    dustBalance: readDust(state),
    state,
    synced: () => waitForSync(facade, cfg),
    // Save on shutdown too, so a run's catch-up progress is cached for the next one.
    stop: async () => {
      await saveSnapshot(facade, statePath);
      await facade.stop();
    },
  };
}

/**
 * Waits for the wallet to finish syncing, logging progress and failing with a
 * clear message instead of hanging forever.
 */
async function waitForSync(facade: WalletFacade, cfg: DappConfig): Promise<FacadeState> {
  const timeoutMs = cfg.syncTimeoutMs;
  const started = Date.now();
  let lastLogged = 0;
  return Rx.firstValueFrom(
    facade.state().pipe(
      Rx.tap((s) => {
        const elapsed = Date.now() - started;
        if (elapsed - lastLogged >= 15_000) {
          lastLogged = elapsed;
          console.log(`  …syncing (${Math.round(elapsed / 1000)}s) synced=${s.isSynced}`);
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
                  `Check the indexer (${cfg.indexerUrl}) and node are reachable, or raise MMR_SYNC_TIMEOUT_MS.`,
              ),
          ),
      }),
    ),
  );
}

/** NIGHT held unshielded, summed over token types (tNIGHT on Preview). */
export function readNight(state: FacadeState): bigint {
  const balances = (state.unshielded as { balances?: Record<string, bigint> }).balances ?? {};
  return Object.values(balances).reduce((a, b) => a + BigInt(b), 0n);
}

/** Spendable DUST right now. */
export function readDust(state: FacadeState): bigint {
  try {
    return state.dust.balance(new Date());
  } catch {
    return 0n;
  }
}
