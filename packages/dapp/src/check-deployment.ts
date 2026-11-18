// @mmr/dapp — check the deployed contract against Midnight's public indexer.
//
//   pnpm --filter @mmr/dapp check-deployment
//
// Reads epoch_proof's current state for the address in deployments/<network>.json from the
// network's public indexer (no wallet, no key, no proof server), decodes it with the ledger,
// and lists every circuit that has a verifier key on chain. If the contract has been built
// locally (`pnpm --filter @mmr/contracts compact:build`), it also compares each on-chain key
// byte for byte with the local build: a different source gives different keys.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Ledger from "@midnight-ntwrk/midnight-js-protocol/v9";

const here = dirname(fileURLToPath(import.meta.url));
const network = process.env.NETWORK_ID ?? "preview";
const indexer = process.env.MIDNIGHT_INDEXER_URL ?? "https://indexer.preview.midnight.network/api/v4/graphql";
const keysDir = resolve(here, "../../contracts/dist/epoch_proof/keys");

/** A locally built verifier key, in the tagged form (`midnight:verifier-key[vN]:…`) the ledger returns. */
function localKey(circuit: string): Uint8Array | undefined {
  const file = resolve(keysDir, `${circuit}.verifier`);
  return existsSync(file) ? Uint8Array.from(readFileSync(file)) : undefined;
}

async function main(): Promise<void> {
  const record = JSON.parse(readFileSync(resolve(here, "..", "deployments", `${network}.json`), "utf8")) as {
    contractAddress: string;
    circuits: string[];
  };
  const res = await fetch(indexer, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: `{ contractAction(address: "${record.contractAddress}") { __typename state } }` }),
  });
  const body = (await res.json()) as { data?: { contractAction?: { __typename: string; state: string } | null } };
  const action = body.data?.contractAction;
  if (!action) throw new Error(`no contract at ${record.contractAddress} on ${network}`);

  const state = Ledger.ContractState.deserialize(Uint8Array.from(Buffer.from(action.state, "hex")));
  const onChain = state.operations().map(String).sort();
  console.log(`epoch_proof on ${network}: ${record.contractAddress}`);
  console.log(`latest action: ${action.__typename}`);

  let mismatches = 0;
  let compared = 0;
  for (const circuit of onChain) {
    const key = state.operation(circuit)?.verifierKey;
    const local = localKey(circuit);
    let verdict = "no local build to compare";
    if (local) {
      compared++;
      const same = !!key && key.length === local.length && key.every((b, i) => b === local[i]);
      if (!same) mismatches++;
      verdict = same ? "matches the local build" : "DIFFERS from the local build";
    }
    console.log(`  ${circuit.padEnd(18)} ${key?.length ?? 0} B key  ${verdict}`);
  }
  const missing = record.circuits.filter((c) => !onChain.includes(c));
  console.log(`\n${onChain.length} circuits with verifier keys on chain` + (missing.length ? `; missing: ${missing.join(", ")}` : ""));
  if (compared) console.log(`${compared - mismatches} of ${compared} keys identical to the local build`);
  if (missing.length || mismatches) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
