// @mmr/dapp — create the market maker's engagement file for the deployed contract.
//
//   MMR_POOL=0x… MMR_PAIR="TOKEN/QUOTE" MMR_WALLETS=0x…,0x… \
//   MMR_TERMS='{"bandBps":"200","depthTarget":"…",…}' pnpm --filter @mmr/dapp engagement:new
//
// MMR_ENGAGEMENT_FILE writes another file in deployments/ (default <network>-engagement.json).
//
// Fresh random secrets and salts, real commitments, sealed with a passphrase derived from
// DEPLOY_SEED into deployments/<network>-engagement.json; only the ciphertext and the
// commitments (which registration puts on chain anyway) are readable in the file. The
// lifecycle then registers it. Refuses to replace an existing engagement file.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { termsFromJson, type TermsJson } from "@mmr/engagement-file";
import { loadConfig } from "./config.js";
import { createEngagement, writeEngagementRecord } from "./engagement.js";
import { toMasterSeed } from "./wallet.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const here = dirname(fileURLToPath(import.meta.url));
  const deployment = JSON.parse(readFileSync(resolve(here, "..", "deployments", `${cfg.networkId}.json`), "utf8")) as {
    contractAddress?: string;
  };
  if (!deployment.contractAddress) throw new Error("deploy the contract first");
  // MMR_ENGAGEMENT_FILE names another file in deployments/ (a second engagement).
  const file = resolve(here, "..", "deployments", process.env.MMR_ENGAGEMENT_FILE ?? `${cfg.networkId}-engagement.json`);
  if (existsSync(file)) throw new Error(`${file} exists; an engagement file is never replaced`);

  const pool = required("MMR_POOL").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(pool)) throw new Error("MMR_POOL is not an address");
  const wallets = required("MMR_WALLETS").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  // The pool is committed with the terms (DD-38): always the engagement's pool.
  const terms = termsFromJson({
    epochsTotal: "30", ...(JSON.parse(required("MMR_TERMS")) as Partial<TermsJson>), pool: BigInt(pool).toString(),
  } as TermsJson);

  const record = await createEngagement(toMasterSeed(cfg.deploySeed), {
    network: cfg.networkId,
    contractAddress: deployment.contractAddress,
    label: process.env.MMR_ENGAGEMENT_LABEL ?? `${cfg.networkId}-1`,
    chain: Number(process.env.MMR_CHAIN ?? 8453),
    tier: Number(process.env.MMR_TIER ?? 1),
    bond: Number(process.env.MMR_BOND ?? 10_000),
    pool: { address: pool, pair: required("MMR_PAIR") },
    client: process.env.MMR_CLIENT ?? "sample client",
    wallets,
    terms,
  });
  writeEngagementRecord(file, record);
  console.log(`engagement file written: ${file}`);
  console.log(`  wallet commitment  ${record.file.hint.walletCommit}`);
  console.log(`  terms commitment   ${record.file.hint.termsCommit}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
