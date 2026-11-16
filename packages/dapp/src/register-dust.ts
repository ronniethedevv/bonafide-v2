// @mmr/dapp — headless tNIGHT -> tDUST registration.
//
//   pnpm --filter @mmr/dapp run register-dust
//
// The faucet dispenses tNIGHT, but fees are paid in tDUST. tDUST only accrues
// to NIGHT UTXOs that have been *registered for dust generation*, designating a
// DUST address. This does that without Lace: build the wallet from the seed,
// report what is registered, register what is not, and wait for dust to appear.
//
// Reads the seed from packages/dapp/.env, falling back to the workspace-root
// .env (MIDNIGHT_WALLET_SEED). The seed is never printed.

import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import type { FacadeState, UtxoWithMeta, WalletFacade } from "@midnightntwrk/wallet-sdk";
import * as Rx from "rxjs";
import { loadConfig } from "./config.js";
import { buildHeadlessWallet, type HeadlessWallet } from "./wallet.js";

/** How long to keep polling for a non-zero DUST balance. */
const DUST_POLL_TIMEOUT_MS = 20 * 60 * 1000;
const DUST_POLL_INTERVAL_MS = 10_000;

/**
 * The SDK raises `InsufficientFundsError` (`_tag: "Wallet.InsufficientFunds"`)
 * when the registration cannot cover its own fee. The class is not exported
 * from the package index, so match it structurally rather than by `instanceof`.
 * There is no `InsufficientDustForFeeError` in this SDK version.
 */
function isInsufficientFunds(err: unknown): boolean {
  const e = err as { _tag?: unknown; message?: unknown } | null;
  if (!e) return false;
  if (e._tag === "Wallet.InsufficientFunds") return true;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return msg.includes("insufficient") && (msg.includes("dust") || msg.includes("fee"));
}

/**
 * The current DUST balance. `balance(time)` is a method on DustWalletState, not
 * on DustWalletAPI, so each read takes the latest state off the stream rather
 * than reusing the snapshot taken at build time.
 */
async function currentDust(facade: WalletFacade): Promise<bigint> {
  const dustState = await Rx.firstValueFrom(facade.dust.state);
  return dustState.balance(new Date());
}

/** The latest whole-facade state, for re-reading NIGHT after a submission. */
function currentState(facade: WalletFacade): Promise<FacadeState> {
  return Rx.firstValueFrom(facade.state());
}

function nightTotal(state: FacadeState): bigint {
  const balances = (state.unshielded as { balances?: Record<string, bigint> }).balances ?? {};
  return Object.values(balances).reduce((a, b) => a + BigInt(b), 0n);
}

/** Every NIGHT UTXO the wallet can spend, with its registration flag. */
function nightUtxos(state: FacadeState): readonly UtxoWithMeta[] {
  const u = state.unshielded as {
    availableCoins?: readonly UtxoWithMeta[];
    totalCoins?: readonly UtxoWithMeta[];
  };
  return u.availableCoins ?? u.totalCoins ?? [];
}

function describeUtxo(u: UtxoWithMeta, i: number): string {
  const utxo = u.utxo as unknown as { value?: bigint; intentHash?: unknown; outputNo?: number };
  const value = utxo.value !== undefined ? String(utxo.value) : "?";
  const flag = u.meta.registeredForDustGeneration ? "registered" : "NOT registered";
  return `    [${i}] value=${value.padStart(22)}  outputNo=${String(utxo.outputNo ?? "?").padStart(3)}  ${flag}`;
}

async function pollForDust(wallet: HeadlessWallet): Promise<bigint> {
  const deadline = Date.now() + DUST_POLL_TIMEOUT_MS;
  let last = -1n;
  for (;;) {
    const dust = await currentDust(wallet.facade);
    if (dust > 0n) return dust;
    if (dust !== last) {
      last = dust;
      console.log(`  …waiting for DUST to accrue (now ${dust})`);
    }
    if (Date.now() >= deadline) return dust;
    await new Promise((r) => setTimeout(r, DUST_POLL_INTERVAL_MS));
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  setNetworkId(cfg.networkId as Parameters<typeof setNetworkId>[0]);

  console.log("mmr register-dust — designate a DUST address for the NIGHT UTXOs");
  console.log(`  network   ${cfg.networkId}`);
  console.log(`  node      ${cfg.nodeUrl}`);
  console.log(`  indexer   ${cfg.indexerUrl}`);

  console.log("\nbuilding + syncing wallet… (a first sync replays ~280k indices)");
  const wallet = await buildHeadlessWallet(cfg);
  try {
    console.log(`  shielded addr   ${wallet.shieldedAddress}`);
    console.log(`  unshielded addr ${String(wallet.keystore.getBech32Address())}`);

    const night = nightTotal(wallet.state);
    const utxos = nightUtxos(wallet.state);
    let dust = await currentDust(wallet.facade);

    console.log(`\n  NIGHT balance   ${night}`);
    console.log(`  NIGHT UTXOs     ${utxos.length}`);
    utxos.forEach((u, i) => console.log(describeUtxo(u, i)));
    console.log(`  DUST balance    ${dust}`);

    const unregistered = utxos.filter((u) => !u.meta.registeredForDustGeneration);
    console.log(`  unregistered    ${unregistered.length}`);

    if (unregistered.length === 0) {
      console.log(
        dust > 0n
          ? "\nAll NIGHT UTXOs are registered and DUST is present — nothing to do."
          : "\nAll NIGHT UTXOs are registered but DUST is still 0; it accrues over time.",
      );
      if (dust === 0n) dust = await pollForDust(wallet);
      console.log(`\n  NIGHT ${night}\n  DUST  ${dust}`);
      return;
    }
    if (dust > 0n) {
      console.log("\nDUST is already non-zero; leaving the unregistered UTXOs alone.");
      console.log(`\n  NIGHT ${night}\n  DUST  ${dust}`);
      return;
    }

    // Registration must pay its own fee in DUST, so find out how much it needs
    // and wait for that much to be projected before submitting.
    const { fee } = await wallet.facade.estimateRegistration(unregistered);
    console.log(`\n  estimated registration fee: ${fee} DUST`);

    // Do NOT sign the recipe here. The registration carries its own signature,
    // supplied through the signDustRegistration callback below; calling
    // signRecipe as well adds a second signature and the node rejects the
    // transaction with Custom error 192, InputsSignaturesLengthMismatch.
    //
    // A first registration needs no DUST balance and no proof server: it pays
    // its fee from the retroactive DUST its own NIGHT UTXOs have accrued, so
    // finalizeRecipe resolves without proving.
    const submit = async (): Promise<string> => {
      const recipe = await wallet.facade.registerNightUtxosForDustGeneration(
        unregistered,
        wallet.keystore.getPublicKey(),
        (payload) => wallet.keystore.signData(payload),
      );
      const finalized = await wallet.facade.finalizeRecipe(recipe);
      return wallet.facade.submitTransaction(finalized);
    };

    // The wait comes first: registerNightUtxosForDustGeneration throws before
    // signing anything if the UTXO has not yet accrued `fee`. The accrual stops
    // at the UTXO's cap, so a UTXO whose cap is under `fee` never gets there.
    console.log(`  waiting for ${fee} retroactive DUST to accrue to the UTXO…`);
    await wallet.facade.waitForGeneratedDust(unregistered, fee, {
      timeoutMs: cfg.dustWaitTimeoutMs,
    });

    let txId: string;
    try {
      console.log("  submitting registration…");
      txId = await submit();
    } catch (err) {
      if (!isInsufficientFunds(err)) throw err;
      console.log("  still short of the fee — waiting again, then retrying once");
      await wallet.facade.waitForGeneratedDust(unregistered, fee, {
        timeoutMs: cfg.dustWaitTimeoutMs,
      });
      txId = await submit();
    }
    console.log(`  registration tx: ${txId}`);

    dust = await pollForDust(wallet);
    const after = await currentState(wallet.facade);
    console.log(`\n  NIGHT ${nightTotal(after)}\n  DUST  ${dust}`);
    if (dust === 0n) {
      throw new Error(
        `Registration submitted (${txId}) but DUST is still 0 after ` +
          `${Math.round(DUST_POLL_TIMEOUT_MS / 60000)} min. DUST accrues over time; re-run to check.`,
      );
    }
    console.log("\nDUST is available — the deploy can pay its fee now.");
  } finally {
    await wallet.stop();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("\nregister-dust failed:", err);
    process.exit(1);
  },
);
