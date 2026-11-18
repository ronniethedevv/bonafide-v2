// @mmr/dapp — deploy to Midnight Preview (ledger 9).
//
//   pnpm --filter @mmr/contracts compact:build   (once: circuits + proving keys)
//   pnpm --filter @mmr/dapp deploy
//
// Two contracts, in order:
//   1. test_bond_token: a shielded token anyone can mint on Preview, because the
//      faucet only hands out unshielded tNIGHT and a bond is a shielded coin.
//   2. epoch_proof, with the 2-of-3 attester committee and that token's color as
//      its bond token (DD-35). Both are fixed for the contract's lifetime.
//
// epoch_proof is too big for one transaction: its constructor state and 12
// verifier keys write ~39 KB, and one transaction may use only ~65% of a block's
// 50 KB (Midnight's batched-deploy runbook). So it is deployed with the first
// DEPLOY_FIRST circuits' keys (~54% of a block) and the rest are added with signed
// maintenance updates, one per circuit (~6% each). The maintenance key is stored
// before the deploy is submitted, and the record is written after every step, so
// an interrupted run resumes: re-run and it inserts only the keys still missing.
//
// Pays fees in DUST from the DEPLOY_SEED wallet; records addresses in
// .deploy/<network>.json (gitignored). The attester secrets are derived from the
// seed and never leave this process; only their ids go on chain.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createUnprovenDeployTx,
  deployContract,
  submitInsertVerifierKeyTx,
  submitTx,
} from "@midnight-ntwrk/midnight-js-contracts";
import * as Ledger from "@midnight-ntwrk/midnight-js-protocol/v9";
import { sampleSigningKey } from "@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime";
import { LedgerTransaction, SucceedEntirely } from "@midnight-ntwrk/midnight-js-types";
import { buildCommittee, deriveAttesterSecrets } from "./committee.js";
import { loadConfig } from "./config.js";
import {
  BOND_TOKEN_DOMAIN,
  PRIVATE_STATE_ID,
  compiledEpochProof,
  compiledTestBondToken,
  emptyPrivateState,
  type EpochProofCircuitId,
  type EpochProofPrivateState,
} from "./contract.js";
import { buildProviders } from "./providers.js";
import { buildHeadlessWallet, toMasterSeed } from "./wallet.js";

/** The circuits a lifecycle needs first; their keys go in the deploy itself. */
const DEPLOY_FIRST: readonly EpochProofCircuitId[] = [
  "register", "postBond", "activate", "publishRoot", "disputeRoot", "proveFunding", "proveEpoch",
];
/** Added after the deploy, one maintenance update each. */
const INSERT_AFTER: readonly EpochProofCircuitId[] = [
  "settleEpoch", "releaseEpoch", "voidUnfunded", "defaultEngagement", "claim",
];

interface DeployRecord {
  network: string;
  bondToken?: { contractAddress: string; color: string; txId: string };
  contractAddress?: string;
  txId?: string;
  blockHeight?: number;
  committee?: string[];
  /** Circuits whose verifier key is on chain. */
  circuits?: string[];
  inserts?: { circuit: string; txId: string }[];
  deployedAt?: string;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const seconds = (since: number) => `${((Date.now() - since) / 1000).toFixed(1)}s`;

async function main(): Promise<void> {
  const cfg = loadConfig();
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".deploy");
  const file = resolve(out, `${cfg.networkId}.json`);
  const record: DeployRecord = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as DeployRecord)
    : { network: cfg.networkId };
  const save = () => {
    mkdirSync(out, { recursive: true });
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  };

  console.log("mmr deploy");
  console.log(`  network        ${cfg.networkId}`);
  console.log(`  node           ${cfg.nodeUrl}`);
  console.log(`  indexer        ${cfg.indexerUrl}`);
  console.log(`  proof server   ${cfg.proofServerUrl}`);
  console.log(`  record         ${file}`);

  // I8 / DD-26: the committee is fixed at deploy and cannot change afterwards.
  const committee = buildCommittee(deriveAttesterSecrets(toMasterSeed(cfg.deploySeed)));
  console.log("  committee (2-of-3 attester ids)");
  committee.forEach((id, i) => console.log(`    [${i}] ${hex(id)}`));

  console.log("\nbuilding + syncing wallet…");
  const wallet = await buildHeadlessWallet(cfg);
  console.log(`  address        ${wallet.unshieldedAddress}`);
  console.log(`  NIGHT          ${wallet.nightBalance}`);
  console.log(`  DUST           ${wallet.dustBalance}`);
  try {
    if (wallet.dustBalance === 0n) {
      throw new Error(
        "The wallet has no DUST to pay fees. Fund the address above from the Preview faucet, " +
          "then run `pnpm --filter @mmr/dapp register-dust` and deploy again.",
      );
    }

    // 1. The test bond token (once).
    if (!record.bondToken) {
      console.log("\ndeploying test_bond_token…");
      const started = Date.now();
      const tokenProviders = buildProviders<"mint">(cfg, wallet, wallet.unshieldedAddress, cfg.bondTokenZkConfigPath);
      const token = await deployContract(tokenProviders, {
        compiledContract: compiledTestBondToken(cfg.bondTokenZkConfigPath),
      });
      const tokenAddress = token.deployTxData.public.contractAddress;
      record.bondToken = {
        contractAddress: tokenAddress,
        color: Ledger.rawTokenType(BOND_TOKEN_DOMAIN, tokenAddress),
        txId: token.deployTxData.public.txId,
      };
      save();
      console.log(`  address        ${tokenAddress} (${seconds(started)})`);
    } else {
      console.log(`\ntest_bond_token already deployed at ${record.bondToken.contractAddress}`);
    }
    console.log(`  bond color     ${record.bondToken.color}`);

    const providers = buildProviders(cfg, wallet, wallet.unshieldedAddress);
    const compiled = compiledEpochProof(cfg.zkConfigPath);

    // 2. epoch_proof with the first circuits' keys (once).
    if (!record.contractAddress) {
      console.log(`\ndeploying epoch_proof with ${DEPLOY_FIRST.length} of 12 verifier keys…`);
      const started = Date.now();
      const full = await createUnprovenDeployTx(providers, {
        compiledContract: compiled,
        initialPrivateState: emptyPrivateState,
        signingKey: sampleSigningKey(), // the contract maintenance authority key
        args: [committee, Uint8Array.from(Buffer.from(record.bondToken.color, "hex"))], // constructor(members, token)
      });
      const tx = Ledger.Transaction.deserialize("signature", "pre-proof", "pre-binding", full.private.unprovenTx.serialize());
      const intent = [...(tx.intents?.values() ?? [])][0];
      const fullDeploy = intent?.actions[0];
      if (!intent || tx.intents?.size !== 1 || intent.actions.length !== 1 || !(fullDeploy instanceof Ledger.ContractDeploy)) {
        throw new Error("unexpected deploy transaction shape: expected one intent with one ContractDeploy");
      }
      const initial = fullDeploy.initialState;
      const subset = new Ledger.ContractState();
      subset.data = initial.data;
      subset.maintenanceAuthority = initial.maintenanceAuthority;
      subset.balance = initial.balance;
      for (const id of DEPLOY_FIRST) {
        const op = initial.operation(id);
        if (!op) throw new Error(`the compiled contract has no circuit ${id}`);
        subset.setOperation(id, op);
      }
      const deploy = new Ledger.ContractDeploy(subset);
      const address = deploy.address;
      const unproven = Ledger.Transaction.fromParts(cfg.networkId, undefined, undefined, Ledger.Intent.new(intent.ttl).addDeploy(deploy));

      // Store the maintenance key and the private state first: without the key the
      // remaining circuits could never be added.
      await providers.privateStateProvider.setSigningKey(address, full.private.signingKey);
      await providers.privateStateProvider.forContract(address).set(PRIVATE_STATE_ID, full.private.initialPrivateState as EpochProofPrivateState);

      const finalized = await submitTx(providers, { unprovenTx: LedgerTransaction.seal("v9", "Unproven", unproven) });
      if (finalized.status !== SucceedEntirely) throw new Error(`deploy landed with status ${finalized.status}`);
      Object.assign(record, {
        contractAddress: address,
        txId: finalized.txId,
        blockHeight: Number(finalized.blockHeight ?? 0),
        committee: committee.map(hex),
        circuits: [...DEPLOY_FIRST],
        inserts: [],
        deployedAt: new Date().toISOString(),
      });
      save();
      console.log(`  address        ${address}`);
      console.log(`  tx             ${finalized.txId} (${seconds(started)}, block ${finalized.blockHeight})`);
    } else {
      console.log(`\nepoch_proof already deployed at ${record.contractAddress}`);
    }

    // 3. The remaining verifier keys, one maintenance update each.
    const address = record.contractAddress;
    if (!address) throw new Error("no epoch_proof address recorded");
    for (const id of INSERT_AFTER) {
      if (record.circuits?.includes(id)) continue;
      const started = Date.now();
      const vk = await providers.zkConfigProvider.getVerifierKey(id);
      const res = await submitInsertVerifierKeyTx(providers, compiled, address, id, vk);
      if (res.public.status !== SucceedEntirely) throw new Error(`inserting ${id} landed with status ${res.public.status}`);
      record.circuits = [...(record.circuits ?? []), id];
      record.inserts = [...(record.inserts ?? []), { circuit: id, txId: res.public.txId }];
      save();
      console.log(`  + ${id.padEnd(18)} ${res.public.txId} (${seconds(started)})`);
    }
    console.log(`\nepoch_proof live with ${record.circuits?.length} of 12 circuits; recorded in ${file}`);
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
