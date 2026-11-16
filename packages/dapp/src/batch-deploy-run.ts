// @mmr/dapp — batched deploy of epoch_proof (runbook Phase 3.5).
//
//   pnpm --filter @mmr/dapp run batch-deploy                  # dry run, submits nothing
//   MMR_BATCH_EXECUTE=1 pnpm --filter @mmr/dapp run batch-deploy
//
// A single deploy carries one verifier key per exported circuit, and all 11 of
// epoch_proof's together overflow the per-block write budget — the node rejects
// it with 1010 "would exhaust the block limits". This deploys the subset that
// fits, then adds each remaining key with its own maintenance update.
//
// The planning and submission logic is the servicedesk runbook's batch-deploy.ts,
// used verbatim; this file only wires it to the same providers, compiled contract,
// private state and `[committee]` constructor arg that deploy.ts uses, so a batched
// deploy produces the same contract a normal deployContract() would have.
//
// On execute it then does the two follow-ups the runbook asks for, in this same
// process so the ~25 min wallet sync is paid once: confirm findDeployedContract()
// attaches now that all 11 keys are on chain (Phase 3 step 5), and prove the cheap
// `register` circuit as the proof-server sanity check (Phase 3 step 6).
//
// Resume after an interruption with MMR_BATCH_CONTRACT_ADDRESS=<printed address>:
// it inserts only the circuits still missing on chain. Never re-run with
// MMR_BATCH_EXECUTE=1 and no address after batch 1 landed — that samples a new
// nonce and deploys a second partial contract.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { batchDeploy } from "../scripts/batch-deploy.js";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { buildCommittee, generateAttesterSecrets } from "./committee.js";
import { loadConfig } from "./config.js";
import { PRIVATE_STATE_ID, compiledEpochProof, emptyPrivateState } from "./contract.js";
import { buildProviders } from "./providers.js";
import { buildHeadlessWallet } from "./wallet.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/**
 * `register` is cheap to prove, so Phase 3's proof-server sanity check uses it.
 * Landing it in batch 1 means that check works before the inserts finish.
 */
const PRIORITY_CIRCUITS = ["register"] as const;

/** epoch_proof commits the wallet vector over a fixed 16 slots. */
const SLOTS = 16;

const fill32 = (b: number) => new Uint8Array(32).fill(b);

/**
 * The witness slots `register` reads: engagement secret, the committed wallet
 * vector + its salt, and the terms + their salt. Shapes mirror
 * packages/contracts/test/harness.ts. The engagement secret is randomised because
 * register asserts its derived id is not already on the status map, so a fixed
 * secret would make the sanity check single-use.
 */
function registerWitnessState() {
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

async function main(): Promise<void> {
  const cfg = loadConfig();

  // Must precede every address/key derivation and provider construction.
  setNetworkId(cfg.networkId as Parameters<typeof setNetworkId>[0]);

  const execute = process.env.MMR_BATCH_EXECUTE === "1";
  const resumeAddress = process.env.MMR_BATCH_CONTRACT_ADDRESS?.trim() || undefined;

  console.log("mmr batch-deploy — epoch_proof (runbook Phase 3.5)");
  console.log(`  mode           ${execute ? "EXECUTE (submits txs)" : "DRY RUN (submits nothing)"}`);
  console.log(`  network        ${cfg.networkId}`);
  console.log(`  node           ${cfg.nodeUrl}`);
  console.log(`  indexer        ${cfg.indexerUrl}`);
  console.log(`  proof server   ${cfg.proofServerUrl}`);
  console.log(`  zk assets      ${cfg.zkConfigPath}`);
  console.log(`  priority       ${PRIORITY_CIRCUITS.join(", ")}`);
  if (resumeAddress) console.log(`  resuming       ${resumeAddress}`);

  // I8 / DD-26: the committee is fixed at deploy and cannot change afterwards.
  // Deterministic, so this rebuilds the same committee deploy.ts would have.
  const committee = buildCommittee(generateAttesterSecrets(3));
  console.log("  committee (2-of-3 attester ids)");
  committee.forEach((id, i) => console.log(`    [${i}] ${hex(id)}`));

  console.log("\nbuilding + syncing wallet…");
  const wallet = await buildHeadlessWallet(cfg);
  try {
    console.log(`  shielded addr  ${wallet.shieldedAddress}`);
    console.log(`  NIGHT          ${wallet.nightBalance}`);
    console.log(`  DUST           ${wallet.dustBalance}`);

    const providers = buildProviders(cfg, wallet.provider, wallet.shieldedAddress);
    const compiled = compiledEpochProof(cfg.zkConfigPath);

    // batchDeploy reports tx details only through its log callback — its result
    // type carries circuit names, not hashes — so capture every line and parse
    // the hashes out of the transcript.
    const transcript: string[] = [];
    const log = (line: string) => {
      transcript.push(line);
      console.log(line);
    };

    console.log(`\n${execute ? "executing" : "planning"} batched deploy…`);
    const started = Date.now();
    const result = await batchDeploy(providers, {
      compiledContract: compiled,
      args: [committee], // constructor(members: Vector<3, Bytes<32>>)
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: emptyPrivateState,
      priorityCircuits: PRIORITY_CIRCUITS,
      // Omitted entirely when absent: exactOptionalPropertyTypes rejects an
      // explicit `undefined`, and batchDeploy keys the deploy-vs-resume branch
      // off the property being absent.
      ...(resumeAddress ? { contractAddress: resumeAddress } : {}),
      execute,
      log,
    });
    const elapsedMs = Date.now() - started;

    // batch 1: "batch 1 finalized in block <h> (tx <id>)"
    const batchOne = transcript
      .map((l) => /batch 1 finalized in block (\d+) \(tx (\S+)\)/.exec(l))
      .find((m): m is RegExpExecArray => m !== null);
    // inserts: "  + <circuit> inserted (block <h>) [n/m]" — block height only,
    // the verbatim script does not log the insert tx hashes.
    const inserts = transcript
      .map((l) => /^\s*\+ (\S+) inserted \(block (\d+)\)/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ circuit: m[1]!, blockHeight: Number(m[2]) }));

    console.log("\n  plan");
    console.log(`    contract address    ${result.contractAddress ?? "(none)"}`);
    console.log(`    batch 1 (deploy)    ${result.deployed.length} circuits${result.deployed.length ? `: ${result.deployed.join(", ")}` : ""}`);
    console.log(`    single inserts      ${result.inserted.length}${result.inserted.length ? `: ${result.inserted.join(", ")}` : ""}`);
    console.log(`    already on chain    ${result.alreadyOnChain.length}${result.alreadyOnChain.length ? `: ${result.alreadyOnChain.join(", ")}` : ""}`);
    console.log(`    executed            ${result.executed}`);
    console.log(`    elapsed             ${(elapsedMs / 1000).toFixed(1)}s`);

    if (!result.executed) {
      console.log(
        "\nDry run — nothing was submitted. The address above is re-sampled on a real run.\n" +
          "Re-run with MMR_BATCH_EXECUTE=1 to submit.",
      );
      return;
    }

    // Persist before the follow-ups: if findDeployedContract or the sanity check
    // fails, the address and hashes must already be on disk or the contract is
    // orphaned (its CMA key is only in the private-state store).
    const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".deploy");
    mkdirSync(out, { recursive: true });
    const file = resolve(out, `${cfg.networkId}.json`);
    const record: Record<string, unknown> = {
      network: cfg.networkId,
      contractAddress: result.contractAddress,
      deployedAt: new Date().toISOString(),
      batched: true,
      batch1: {
        circuits: result.deployed,
        txId: batchOne?.[2] ?? null,
        blockHeight: batchOne ? Number(batchOne[1]) : null,
      },
      // Block heights only: batch-deploy.ts logs no tx hash for the inserts, and
      // it is used verbatim.
      inserts,
      alreadyOnChain: result.alreadyOnChain,
      // Public ids only — the secrets stay in the interact process.
      committee: committee.map(hex),
      elapsedMs,
      transcript,
    };
    const write = () => writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    write();
    console.log(`\n  recorded in       ${file}`);

    // Phase 3 step 5 — all 11 keys are on chain, so the normal attach must work.
    console.log("\nconfirming findDeployedContract()…");
    const found = await findDeployedContract(providers, {
      contractAddress: result.contractAddress!,
      compiledContract: compiled,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: emptyPrivateState,
    });
    console.log(`  attached to       ${found.deployTxData.public.contractAddress}`);
    record["findDeployedContract"] = "ok";
    write();

    // Phase 3 step 6 — prove one cheap circuit to confirm the proof server
    // accepts our ZKIR format, before anything reaches the heavy proveEpoch.
    console.log("\nproof-server sanity check: proving `register`…");
    await providers.privateStateProvider.set(PRIVATE_STATE_ID, registerWitnessState() as never);
    // H3: register asserts blockTime >= registeredTs > blockTime - 600, so date
    // it slightly in the past to absorb proof-build and inclusion time.
    const registeredTs = BigInt(Math.floor(Date.now() / 1000) - 60);
    const regStarted = Date.now();
    const reg = await found.callTx.register(1n, registeredTs);
    const regMs = Date.now() - regStarted;
    console.log(`  register tx       ${reg.public.txId}`);
    console.log(`  block height      ${reg.public.blockHeight}`);
    console.log(`  proof + submit    ${(regMs / 1000).toFixed(1)}s`);
    record["sanityCheck"] = {
      circuit: "register",
      txId: reg.public.txId,
      blockHeight: Number(reg.public.blockHeight ?? 0),
      elapsedMs: regMs,
    };
    write();

    console.log("\nAll 11 circuits keyed, attach confirmed, proof server verified.");
    console.log(`  recorded in       ${file}`);
  } finally {
    await wallet.stop();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("\nbatch-deploy failed:", err);
    process.exit(1);
  },
);
