// @mmr/dapp — DISCRIMINATOR: is 117 (Malformed.NotNormalized) about epoch_proof's
// hand-built batched-deploy state, or about the 8.1.0-client -> 8.1.3-node call path
// for ANY contract?
//
//   pnpm --filter @mmr/dapp exec tsx src/counter-check.ts
//
// A trivial 1-circuit counter, deployed the NORMAL one-shot way (plain deployContract,
// no batching, no restrictDeployTo, no maintenance updates), then called. Same wallet,
// same providers, same proof server, same Compact 0.31.1 / ir-source[v2], same ledger-v8
// 8.1.0 client against the same node 1.0.400 (ledger 8.1.3).
//
//   increment SUCCEEDS -> the call path is fine; the fault is epoch_proof's batched
//                         deploy (restrictDeployTo + 3 verifier-key maintenance updates
//                         produced a state the 8.1.3 node won't accept calls against).
//   increment ALSO 117s -> the fault is the client/node call path for any contract,
//                          independent of how the contract was deployed.
//
// RESUMES by default: the deploy landed on 2026-11-01 (block 1547724) before the run was
// interrupted at the call, so this attaches to that contract with findDeployedContract
// instead of deploying a second one — a redundant deploy would only waste a proof and a
// fee. It deploys only if there is no record and no MMR_COUNTER_ADDRESS. Set
// MMR_COUNTER_FORCE_DEPLOY=1 to deploy a fresh one anyway.
//
// This touches nothing belonging to epoch_proof: its own private-state store, its own
// privateStateId, its own zk assets directory. epoch_proof is not redeployed or called.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { Contract } from "../scratch/counter-build/contract/index.js";
import { loadConfig } from "./config.js";
import { buildHeadlessWallet } from "./wallet.js";

/** Its own id and store, so epoch_proof's CMA signing key is never touched. */
const COUNTER_PRIVATE_STATE_ID = "mmrCounterPrivateState";
type CounterCircuitId = "increment";

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const cfg = loadConfig();
  setNetworkId(cfg.networkId as Parameters<typeof setNetworkId>[0]);

  // The counter's own compiled assets, NOT cfg.zkConfigPath (epoch_proof's).
  const zkPath = resolve(here, "..", "scratch", "counter-build");
  const file = resolve(here, "..", ".deploy", `${cfg.networkId}-counter.json`);

  // Prefer an explicit address, then the deploy record. Absent both -> deploy.
  const prior: Record<string, unknown> = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)
    : {};
  const force = process.env.MMR_COUNTER_FORCE_DEPLOY === "1";
  const existing = force
    ? undefined
    : process.env.MMR_COUNTER_ADDRESS?.trim() || (prior["contractAddress"] as string | undefined);

  console.log("mmr counter-check — 1-circuit contract, normal one-shot deploy");
  console.log(`  network        ${cfg.networkId}`);
  console.log(`  node           ${cfg.nodeUrl}`);
  console.log(`  indexer        ${cfg.indexerUrl}`);
  console.log(`  proof server   ${cfg.proofServerUrl}`);
  console.log(`  zk assets      ${zkPath}`);
  console.log(`  mode           ${existing ? `RESUME — attach to ${existing}, no deploy` : "DEPLOY a new counter"}`);

  console.log("\nbuilding + syncing wallet…");
  const wallet = await buildHeadlessWallet(cfg);
  try {
    console.log(`  shielded addr  ${wallet.shieldedAddress}`);
    console.log(`  NIGHT          ${wallet.nightBalance}`);
    console.log(`  DUST           ${wallet.dustBalance}`);

    const zkConfigProvider = new NodeZkConfigProvider<CounterCircuitId>(zkPath);
    const providers = {
      privateStateProvider: levelPrivateStateProvider<typeof COUNTER_PRIVATE_STATE_ID, Record<string, never>>({
        privateStateStoreName: "mmr-counter-private-state",
        privateStoragePasswordProvider: async () => cfg.privateStatePassword,
        accountId: wallet.shieldedAddress,
      }),
      publicDataProvider: indexerPublicDataProvider(cfg.indexerUrl, cfg.indexerWsUrl),
      zkConfigProvider,
      proofProvider: httpClientProofProvider(cfg.proofServerUrl, zkConfigProvider, {
        timeout: cfg.proofTimeoutMs,
      }),
      walletProvider: wallet.provider,
      midnightProvider: wallet.provider,
    };

    // The counter declares no witnesses and its constructor takes no arguments.
    const compiled = CompiledContract.make<Contract<Record<string, never>>>(
      "counter",
      Contract<Record<string, never>>,
    ).pipe(
      CompiledContract.withWitnesses({} as never),
      CompiledContract.withCompiledFileAssets(zkPath),
    );

    const record: Record<string, unknown> = {
      ...prior,
      network: cfg.networkId,
      purpose: "117 discriminator: one-shot deploy + call of a 1-circuit counter",
    };
    const write = () => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    };

    let contract: unknown;
    if (existing) {
      console.log(`\nattaching with findDeployedContract() — no deploy…`);
      contract = await findDeployedContract(providers as never, {
        contractAddress: existing,
        compiledContract: compiled,
        privateStateId: COUNTER_PRIVATE_STATE_ID,
        initialPrivateState: {},
      } as never);
      const addr = (contract as { deployTxData: { public: { contractAddress: string } } })
        .deployTxData.public.contractAddress;
      console.log(`  attached to    ${addr}`);
    } else {
      console.log("\nproving + submitting ONE-SHOT deploy (no batching)…");
      const dStart = Date.now();
      contract = await deployContract(providers as never, {
        compiledContract: compiled,
        privateStateId: COUNTER_PRIVATE_STATE_ID,
        initialPrivateState: {},
        args: [],
      } as never);
      const dMs = Date.now() - dStart;
      const pub = (contract as { deployTxData: { public: { contractAddress: string; txId: string; blockHeight?: unknown } } })
        .deployTxData.public;
      console.log(`\n  ✓ contract addr ${pub.contractAddress}`);
      console.log(`    deploy tx     ${pub.txId}`);
      console.log(`    block height  ${String(pub.blockHeight ?? "?")}`);
      console.log(`    proof+submit  ${(dMs / 1000).toFixed(1)}s`);
      record["contractAddress"] = pub.contractAddress;
      record["deployTxId"] = pub.txId;
      record["deployBlockHeight"] = Number(pub.blockHeight ?? 0);
      record["deployedAt"] = new Date().toISOString();
      record["batched"] = false;
      write();
    }

    // THE TEST: a call on a conventionally-deployed contract.
    console.log("\nproving + submitting increment() — this is the discriminator…");
    const cStart = Date.now();
    const res = await (contract as unknown as {
      callTx: { increment: () => Promise<{ public: { txId: string; blockHeight?: unknown } }> };
    }).callTx.increment();
    const cMs = Date.now() - cStart;

    console.log(`\n  ✓ increment tx  ${res.public.txId}`);
    console.log(`    block height  ${String(res.public.blockHeight ?? "?")}`);
    console.log(`    proof+submit  ${(cMs / 1000).toFixed(1)}s`);
    record["incrementTxId"] = res.public.txId;
    record["incrementBlockHeight"] = Number(res.public.blockHeight ?? 0);
    record["incrementAt"] = new Date().toISOString();
    record["verdict"] = "call succeeded — the 8.1.0-client -> 8.1.3-node call path is FINE";
    write();

    console.log("\nVERDICT: a normally-deployed contract accepts calls.");
    console.log("  => the 117 on epoch_proof is its hand-built batched deploy, not the circuits.");
    console.log(`  recorded in     ${file}`);
  } finally {
    await wallet.stop();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("\ncounter-check FAILED:", err);
    process.exit(1);
  },
);
