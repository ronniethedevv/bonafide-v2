// @mmr/dapp — standalone `register` sanity check against the ALREADY-DEPLOYED contract.
//
//   pnpm --filter @mmr/dapp exec tsx src/register-check.ts
//
// Deploys NOTHING. It attaches to the contract batch-deploy-run.ts already landed on
// Preview and proves exactly one cheap circuit, to separate two failure modes before the
// heavy proveEpoch inside interact.ts is ever attempted:
//
//   submits            -> the onchain-runtime-v3@3.0.0 dedupe + our ZKIR are good.
//   400 "bad input"    -> the proof server rejects our ZKIR; recompile the circuits
//                         without --feature-zkir-v3 (i.e. ZKIR v2) and re-run this.
//
// The register path is lifted from batch-deploy-run.ts, whose own in-process run of it
// never completed (.deploy/preview.json has findDeployedContract: "ok" but no
// sanityCheck key). The engagement secret is randomised per run, because register
// asserts its derived id is not already in the status map — so this is re-runnable, and
// it never consumes the fixed demo id interact.ts registers for the full lifecycle.

import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { loadConfig } from "./config.js";
import { PRIVATE_STATE_ID, compiledEpochProof, emptyPrivateState } from "./contract.js";
import type { EpochProofPrivateState } from "./contract.js";
import { buildProviders } from "./providers.js";
import { buildHeadlessWallet } from "./wallet.js";

/** The contract already on Preview — passed explicitly so this can never redeploy. */
const CONTRACT_ADDRESS =
  process.env.MMR_CONTRACT_ADDRESS?.trim() ||
  "48e2cfceccd0a7b771f5bb71337455f2df03540aadcaf0bc3687d310e52d9eb6";

/** epoch_proof commits the wallet vector over a fixed 16 slots. */
const SLOTS = 16;
const fill32 = (b: number) => new Uint8Array(32).fill(b);

/**
 * The only witness slots `register` reads. Values mirror the KAT scenario
 * (packages/contracts/test/harness.ts): register merely persistentCommits the wallet
 * vector and the terms, so nothing here is checked against chain state — only
 * terms.epochs_total must be within 1..90 (M3b).
 */
function registerWitnessState(): EpochProofPrivateState {
  const committedWallets = new Array<bigint>(SLOTS).fill(0n);
  committedWallets[0] = 0x1111_1111_1111_1111n;
  return {
    engagementSecret: crypto.getRandomValues(new Uint8Array(32)),
    committedWallets,
    walletSalt: fill32(0x5a),
    terms: {
      floor_price_P: 2n, loan_L0: 1_000n, quote_start_Q0: 5n,
      disposal_D: 100n, net_sell_S: 100n, depth_target: 10n,
      roundtrip_share_ppm: 500_000n, band_bps: 50n,
      min_uptime_buckets: 40n, epochs_total: 3n,
    },
    termsSalt: fill32(0x7e),
  };
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

async function main(): Promise<void> {
  const cfg = loadConfig();
  // Must precede every address/key derivation and provider construction.
  setNetworkId(cfg.networkId as Parameters<typeof setNetworkId>[0]);

  console.log("mmr register-check — one cheap circuit, no deploy");
  console.log(`  network        ${cfg.networkId}`);
  console.log(`  contract       ${CONTRACT_ADDRESS}`);
  console.log(`  node           ${cfg.nodeUrl}`);
  console.log(`  indexer        ${cfg.indexerUrl}`);
  console.log(`  proof server   ${cfg.proofServerUrl}`);
  console.log(`  zk assets      ${cfg.zkConfigPath}`);

  console.log("\nbuilding + syncing wallet… (this is the slow part)");
  const wallet = await buildHeadlessWallet(cfg);
  try {
    console.log(`  shielded addr  ${wallet.shieldedAddress}`);
    console.log(`  NIGHT          ${wallet.nightBalance}`);
    console.log(`  DUST           ${wallet.dustBalance}`);

    const providers = buildProviders(cfg, wallet.provider, wallet.shieldedAddress);
    const compiled = compiledEpochProof(cfg.zkConfigPath);

    console.log("\nattaching with findDeployedContract()…");
    const found = await findDeployedContract(providers, {
      contractAddress: CONTRACT_ADDRESS,
      compiledContract: compiled,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: emptyPrivateState,
    });
    console.log(`  attached to    ${found.deployTxData.public.contractAddress}`);

    // Stage the register witnesses. Spread over emptyPrivateState so no slot from an
    // earlier run leaks in; contract.ts's witness closures throw on anything unset.
    const bag = registerWitnessState();
    await providers.privateStateProvider.set(PRIVATE_STATE_ID, {
      ...emptyPrivateState,
      ...bag,
    });
    console.log(`  engagement sec ${hex(bag.engagementSecret!).slice(0, 16)}… (random, re-runnable)`);

    // H3: register asserts blockTime >= ts > blockTime - 600, so date it slightly in the
    // past to absorb proof build + inclusion time.
    const registeredTs = BigInt(Math.floor(Date.now() / 1000) - 60);

    console.log("\nproving + submitting register(1, now-60s)…");
    const started = Date.now();
    const reg = await found.callTx.register(1n, registeredTs);
    const ms = Date.now() - started;

    console.log(`\n  ✓ register tx  ${reg.public.txId}`);
    console.log(`    block height ${String(reg.public.blockHeight ?? "?")}`);
    console.log(`    proof+submit ${(ms / 1000).toFixed(1)}s`);
    const id =
      (reg as { private?: { result?: Uint8Array } }).private?.result ??
      (reg as unknown as { public?: { result?: Uint8Array } }).public?.result;
    if (id instanceof Uint8Array) console.log(`    engagement id ${hex(id)}`);

    console.log("\nPASS — runtime fix + ZKIR accepted. Safe to run `interact`.");
  } finally {
    await wallet.stop();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("\nregister-check FAILED:", err);
    process.exit(1);
  },
);
