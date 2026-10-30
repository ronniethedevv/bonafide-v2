// @mmr/dapp — deploy epoch_proof to Midnight Preview.
//
//   pnpm --filter @mmr/dapp deploy
//
// Fixes the 2-of-3 attester committee in the constructor, proves it on the local
// proof server, balances the fee from the DEPLOY_SEED wallet and submits. Writes
// the contract address to .deploy/<network>.json (gitignored). Secrets never
// leave this process: the attester ids are public, their secrets are not.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { buildCommittee, generateAttesterSecrets } from "./committee.js";
import { loadConfig } from "./config.js";
import { PRIVATE_STATE_ID, compiledEpochProof, emptyPrivateState } from "./contract.js";
import { buildProviders } from "./providers.js";
import { buildHeadlessWallet } from "./wallet.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

async function main(): Promise<void> {
  const cfg = loadConfig();

  // Must precede every address/key derivation and provider construction.
  setNetworkId(cfg.networkId as Parameters<typeof setNetworkId>[0]);

  console.log("mmr deploy — epoch_proof");
  console.log(`  network        ${cfg.networkId}`);
  console.log(`  node           ${cfg.nodeUrl}`);
  console.log(`  indexer        ${cfg.indexerUrl}`);
  console.log(`  proof server   ${cfg.proofServerUrl}`);
  console.log(`  zk assets      ${cfg.zkConfigPath}`);
  console.log(`  proof timeout  ${Math.round(cfg.proofTimeoutMs / 60000)} min`);

  // I8 / DD-26: the committee is fixed at deploy and cannot change afterwards.
  const secrets = generateAttesterSecrets(3);
  const committee = buildCommittee(secrets);
  console.log("  committee (2-of-3 attester ids)");
  committee.forEach((id, i) => console.log(`    [${i}] ${hex(id)}`));

  console.log("\nbuilding + syncing wallet…");
  const wallet = await buildHeadlessWallet(cfg);
  console.log(`  shielded addr  ${wallet.shieldedAddress}`);
  console.log(`  NIGHT          ${wallet.nightBalance}`);
  console.log(`  DUST           ${wallet.dustBalance}`);
  if (wallet.dustBalance === 0n) {
    // A warning, not a gate: these balance readers probe a state shape that
    // varies by SDK build, so the wallet's own balancer is the authority on
    // whether a fee can actually be paid.
    console.warn(
      "  ! read DUST balance as 0. If balancing fails below, fund with tNIGHT, " +
        "register the UTXOs to designate a DUST address, and wait for tDUST to accrue.",
    );
  }

  const providers = buildProviders(cfg, wallet.provider, wallet.shieldedAddress);
  const compiled = compiledEpochProof(cfg.zkConfigPath);

  console.log("\nproving + submitting deploy tx (constructor)…");
  const started = Date.now();
  try {
    const deployed = await deployContract(providers, {
      compiledContract: compiled,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: emptyPrivateState,
      args: [committee], // constructor(members: Vector<3, Bytes<32>>)
    });
    const elapsedMs = Date.now() - started;

    const { contractAddress, txId, blockHeight } = deployed.deployTxData.public;
    console.log(`\n  contract address  ${contractAddress}`);
    console.log(`  deploy tx hash    ${txId}`);
    console.log(`  block height      ${blockHeight}`);
    console.log(`  proof + submit    ${(elapsedMs / 1000).toFixed(1)}s`);

    const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".deploy");
    mkdirSync(out, { recursive: true });
    const file = resolve(out, `${cfg.networkId}.json`);
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          network: cfg.networkId,
          contractAddress,
          txId,
          blockHeight: Number(blockHeight ?? 0),
          deployedAt: new Date().toISOString(),
          // Public ids only — the secrets stay in the interact process.
          committee: committee.map(hex),
          elapsedMs,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`  recorded in       ${file}`);
  } finally {
    await wallet.stop();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("\ndeploy failed:", err);
    process.exit(1);
  },
);
