// @mmr/dapp — the market maker's own commands for one engagement, from its sealed file.
//
//   pnpm --filter @mmr/dapp mm <command> [engagement file]
//
//   status     the engagement's public state on chain
//   register   mint test bond tokens if the wallet holds too few, then register: the wallet
//              and terms commitments, and the public tier, chain, bond and the client's
//              Midnight key (MMR_BENEFICIARY; the demo derives one from the seed)
//   bond       post the bond: a shielded coin the contract holds (owner only)
//   activate   start the clock; day 1 is the next UTC day (owner only)
//   run        everything due for an active engagement: proveFunding, then for each ended
//              day proveEpoch, settleEpoch and releaseEpoch as their windows open
//   claim      add the engagement's credited days to the market maker's public record, once:
//              waits until every day has been released (MM_CLAIM_EARLY=1 claims what is
//              credited so far, and the engagement can never be claimed again)
//   void       an engagement never activated: once its 72-hour funding window has passed,
//              voidUnfunded returns the bond to its owner (anyone may call it)
//   profile    the market maker's profile id: what it shares so others can read its
//              claimed record (the web app's /record/<id>); a claim adds to it
//
// It runs on the market maker's own machine, with its own Midnight wallet and a local proof
// server: MM_SEED is the market maker's seed (its wallet pays the fees; carry salts and the
// profile id derive from it). Without MM_SEED the demo's deploy seed is used, and says so.
//
// The engagement file is either one the wizard or `mmr-agent create` made (opened with
// MMR_ENGAGEMENT_PASSPHRASE; its registration names tier, chain, bond and the client's key)
// or an operator record in deployments/ (sealed with a passphrase derived from the seed;
// the default is deployments/<network>-engagement.json). The scheduled lifecycle job runs
// the attesters and carries the live demonstration engagement. Each command reads the
// contract's state first and says when it has nothing to do. Every transaction is recorded
// next to the file (<name>-lifecycle.json; public data only).

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as rt from "@midnight-ntwrk/compact-runtime";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { ZswapSecretKeys } from "@midnight-ntwrk/midnight-js-protocol/v9";
import { WalletSeeds } from "@midnightntwrk/wallet-sdk";
import { ledger } from "@mmr/contracts/epoch_proof";
import * as Rx from "rxjs";
import { deriveSecret } from "./committee.js";
import { loadConfig } from "./config.js";
import { PRIVATE_STATE_ID, compiledEpochProofFrom, compiledTestBondToken } from "./contract.js";
import { FILE_FORMAT, openFile, type EngagementFile } from "@mmr/engagement-file";
import { openEngagement, privateInputs, readEngagementRecord } from "./engagement.js";
import { claimInputs, runDueSteps } from "./mm-steps.js";
import { useEnvProxy } from "./net.js";
import { buildProviders } from "./providers.js";
import { type EngagementPrivate, walletVector } from "./real-witness.js";
import { buildHeadlessWallet, toMasterSeed } from "./wallet.js";

const DAY = 86_400n;
const FUNDING_WINDOW = 259_200n; // 72 h, as in the contract
const STATUS = ["Registered", "Running", "Running", "Completed", "Voided", "Defaulted"];
const COMMANDS = ["status", "register", "bond", "activate", "run", "claim", "void", "profile"] as const;
type Command = (typeof COMMANDS)[number];

interface Step { step: string; txId: string; blockHeight: number | undefined; seconds: number; at: string }

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const bytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const now = () => BigInt(Math.floor(Date.now() / 1000));
const iso = (t: bigint) => new Date(Number(t) * 1000).toISOString();
const dayLabel = (d: bigint) => iso(d * DAY).slice(0, 10);
/** The market maker's profile secret (the claim's profileSecret witness), derived from its seed. */
export const profileSecret = (seed: Uint8Array): Uint8Array => deriveSecret(seed, "profile");

interface LoadedEngagement {
  label: string;
  chain: number;
  tier: number;
  bond: number;
  /** The client's Midnight coin key named by the registration, when the file states one. */
  beneficiary?: string;
  engagementSecret: Uint8Array;
  priv: EngagementPrivate;
  commitments: { walletCommit: string; termsCommit: string };
}

/** Open either kind of engagement file: the wizard's or agent's, or an operator record. */
async function loadEngagement(path: string, seed: Uint8Array, contractAddress: string): Promise<LoadedEngagement> {
  if (!existsSync(path)) throw new Error(`no engagement file at ${path}`);
  const json = JSON.parse(readFileSync(path, "utf8")) as { format?: string };
  if (json.format === FILE_FORMAT) {
    const pass = process.env.MMR_ENGAGEMENT_PASSPHRASE;
    if (!pass) throw new Error("set MMR_ENGAGEMENT_PASSPHRASE to open this engagement file");
    const opening = await openFile(json as EngagementFile, pass);
    const reg = opening.registration;
    if (!reg) throw new Error("this engagement file states no registration (tier, chain, bond, client key)");
    return {
      label: opening.label ?? opening.commitments.termsCommit.slice(2, 10),
      chain: reg.chainId, tier: reg.tier, bond: Number(reg.bond), beneficiary: reg.beneficiary,
      commitments: opening.commitments, ...privateInputs(opening),
    };
  }
  const record = readEngagementRecord(path)!;
  if (record.contractAddress !== contractAddress) {
    throw new Error(`the engagement file is for contract ${record.contractAddress}, not ${contractAddress}`);
  }
  const opened = await openEngagement(seed, record);
  return {
    label: record.label, chain: record.chain, tier: record.tier, bond: record.bond,
    commitments: opened.opening.commitments, engagementSecret: opened.engagementSecret, priv: opened.priv,
  };
}

async function main(): Promise<void> {
  useEnvProxy();
  const command = process.argv[2] as Command;
  if (!COMMANDS.includes(command)) throw new Error(`usage: mm <${COMMANDS.join("|")}> [engagement file]`);
  // A market maker sets only MM_SEED; it then stands in for the deploy seed the config asks for.
  if (process.env.MM_SEED && !process.env.DEPLOY_SEED && !process.env.MIDNIGHT_WALLET_SEED) process.env.DEPLOY_SEED = process.env.MM_SEED;
  const base = loadConfig();
  // The market maker's own seed; the demo falls back to the deploy seed.
  const cfg = { ...base, deploySeed: process.env.MM_SEED || base.deploySeed };
  if (!process.env.MM_SEED) console.log("(no MM_SEED: using the demo's deploy seed, which also holds the attester keys)");
  const here = dirname(fileURLToPath(import.meta.url));
  const deployments = resolve(here, "..", "deployments");
  const deployment = JSON.parse(readFileSync(resolve(deployments, `${cfg.networkId}.json`), "utf8")) as {
    contractAddress: string;
    bondToken: { contractAddress: string; color: string };
  };
  const seed = toMasterSeed(cfg.deploySeed);
  if (command === "profile") {
    // The contract's profileId(secret) = persistentHash(secret); claims add to its counters.
    const profileId = rt.persistentHash(new rt.CompactTypeBytes(32), profileSecret(seed));
    return console.log(`profile id ${hex(profileId)}`);
  }
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[3] ?? resolve(deployments, `${cfg.networkId}-engagement.json`));
  const eng = await loadEngagement(path, seed, deployment.contractAddress);
  const id = rt.persistentHash(new rt.CompactTypeBytes(32), eng.engagementSecret);
  const [CHAIN, TIER, BOND] = [BigInt(eng.chain), BigInt(eng.tier), BigInt(eng.bond)];
  const engRecord = { label: eng.label, tier: eng.tier, chain: eng.chain, bond: eng.bond };

  const recordFile = path.replace(/(-engagement)?\.json$/, "-lifecycle.json");
  const record: { network: string; contractAddress: string; engagementId: string; tier: number; chain: number; bond: number; steps: Step[] } =
    existsSync(recordFile)
      ? JSON.parse(readFileSync(recordFile, "utf8"))
      : { network: cfg.networkId, contractAddress: deployment.contractAddress, engagementId: hex(id), tier: engRecord.tier, chain: engRecord.chain, bond: engRecord.bond, steps: [] };

  const readLedger = async () => {
    const res = await fetch(cfg.indexerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `{ contractAction(address: "${deployment.contractAddress}") { state } }` }),
    });
    const state = ((await res.json()) as { data: { contractAction: { state: string } } }).data.contractAction.state;
    return ledger(rt.ContractState.deserialize(bytes(state)).data);
  };

  console.log(`mmr mm ${command} — engagement ${hex(id).slice(0, 8)}…${hex(id).slice(-4)} (${engRecord.label})`);
  let led = await readLedger();
  const registered = led.status.member(id);
  if (command === "status") {
    if (!registered) return console.log("  not registered");
    console.log(`  status      ${STATUS[Number(led.status.lookup(id))]}`);
    console.log(`  registered  ${iso(led.registeredAt.lookup(id) as bigint)}`);
    console.log(`  bond        ${led.bondValue.member(id) ? `${led.bondValue.lookup(id)} held` : "not posted"} (required ${led.bondRequired.lookup(id)})`);
    if (led.startDay.member(id)) console.log(`  day 1       ${dayLabel(led.startDay.lookup(id) as bigint)}`);
    else console.log(`  void opens  ${iso((led.registeredAt.lookup(id) as bigint) + FUNDING_WINDOW)} if it is never activated`);
    return;
  }

  // What each command needs on chain first, and whether it has anything to do.
  const status = registered ? STATUS[Number(led.status.lookup(id))] : undefined;
  if (command === "register" && registered) return console.log("  already registered");
  if (command !== "register" && !registered) throw new Error("not registered: run `mm register` first");
  if (command === "bond" && led.escrowed.member(id)) return console.log("  bond already posted");
  if (command === "activate" && led.startDay.member(id)) return console.log(`  already active; day 1 is ${dayLabel(led.startDay.lookup(id) as bigint)}`);
  if (command === "run" && !led.startDay.member(id)) return console.log("  not active yet: run `mm activate` first");
  const claim = command === "claim" ? claimInputs(led, id, eng.priv.terms.min_uptime_buckets) : undefined;
  if (claim) {
    if (claim.credited === 0) return console.log("  no credited day yet: a day is credited when it is released, 66 hours after it ends");
    if (claim.released < 30 && process.env.MM_CLAIM_EARLY !== "1") {
      return console.log(`  ${claim.released} of 30 days released; a claim counts once, so it waits for the last release (MM_CLAIM_EARLY=1 claims the ${claim.credited} credited so far)`);
    }
    console.log(`  claiming ${claim.credited} credited day(s), ${claim.epochsPassed} met the terms`);
  }
  if (command === "void") {
    if (status !== "Registered") return console.log(`  nothing to void: the engagement is ${status}`);
    const opens = (led.registeredAt.lookup(id) as bigint) + FUNDING_WINDOW;
    if (now() < opens) return console.log(`  the funding window is open until ${iso(opens)}; void after that`);
  }

  const stepsBefore = record.steps.length;
  console.log("\nbuilding + syncing wallet…");
  const wallet = await buildHeadlessWallet(cfg);
  const inputs = new Map<string, unknown>();
  const setInputs = (values: Record<string, unknown>) => {
    inputs.clear();
    for (const [k, v] of Object.entries(values)) inputs.set(k, v);
  };
  try {
    const providers = buildProviders(cfg, wallet, wallet.unshieldedAddress);
    const contract = await findDeployedContract(providers, {
      contractAddress: deployment.contractAddress,
      compiledContract: compiledEpochProofFrom(cfg.zkConfigPath, (name: string) => inputs.get(name)),
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: {},
    });
    const run = async (step: string, call: () => Promise<{ public: { txId: string; blockHeight?: number | bigint } }>) => {
      const started = Date.now();
      console.log(`\n${step}…`);
      const res = await call();
      const s: Step = {
        step, txId: res.public.txId,
        blockHeight: res.public.blockHeight === undefined ? undefined : Number(res.public.blockHeight),
        seconds: Math.round((Date.now() - started) / 100) / 10, at: new Date().toISOString(),
      };
      record.steps.push(s);
      writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
      console.log(`  tx ${s.txId}  block ${s.blockHeight}  ${s.seconds}s`);
    };

    if (command === "register") {
      const color = deployment.bondToken.color;
      const balance = (s: Awaited<ReturnType<typeof wallet.synced>>) =>
        BigInt((s.shielded as { balances?: Record<string, bigint> }).balances?.[color] ?? 0n);
      if (balance(await wallet.synced()) < BOND) {
        const tokenProviders = buildProviders<"mint">(cfg, wallet, wallet.unshieldedAddress, cfg.bondTokenZkConfigPath);
        const token = await findDeployedContract(tokenProviders, {
          contractAddress: deployment.bondToken.contractAddress,
          compiledContract: compiledTestBondToken(cfg.bondTokenZkConfigPath),
        });
        const myCoinKey = bytes(String(wallet.walletProvider.getCoinPublicKey()));
        await run("mint bond tokens", () => token.callTx.mint({ bytes: myCoinKey }, BOND, Uint8Array.from(randomBytes(32))));
        console.log("  waiting for the wallet to see the minted coin…");
        await Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((s) => s.isSynced && balance(s) >= BOND)));
      }
      // The client's key: from the engagement's registration (wizard, agent), MMR_BENEFICIARY,
      // or, for the demo's operator records, a demo client key derived from the seed.
      const beneficiary = eng.beneficiary
        ? bytes(eng.beneficiary)
        : process.env.MMR_BENEFICIARY
          ? bytes(process.env.MMR_BENEFICIARY)
          : bytes(String(ZswapSecretKeys.fromSeed(WalletSeeds.fromMasterSeed(deriveSecret(seed, `client:${engRecord.label}`)).shielded).coinPublicKey));
      if (beneficiary.length !== 32) throw new Error("MMR_BENEFICIARY must be a 32-byte hex Midnight coin public key");
      setInputs({
        engagementSecret: eng.engagementSecret, committedWallets: walletVector(eng.priv.wallets),
        walletSalt: eng.priv.walletSalt, terms: eng.priv.terms, termsSalt: eng.priv.termsSalt,
      });
      await run("register", () => contract.callTx.register(TIER, CHAIN, BOND, { bytes: beneficiary }, now() - 5n));
      led = await readLedger();
      if (`0x${hex(led.walletCommit.lookup(id) as Uint8Array)}` !== eng.commitments.walletCommit
          || `0x${hex(led.termsCommit.lookup(id) as Uint8Array)}` !== eng.commitments.termsCommit) {
        throw new Error("the registered commitments differ from the engagement file's");
      }
      console.log(`  void opens ${iso((led.registeredAt.lookup(id) as bigint) + FUNDING_WINDOW)} if it is never activated`);
    } else if (command === "bond") {
      setInputs({
        engagementSecret: eng.engagementSecret,
        bondCoin: { nonce: Uint8Array.from(randomBytes(32)), color: bytes(deployment.bondToken.color), value: BOND },
      });
      await run("postBond", () => contract.callTx.postBond(id));
    } else if (command === "activate") {
      const ts = now() - 5n;
      setInputs({ engagementSecret: eng.engagementSecret });
      await run("activate", () => contract.callTx.activate(id, ts / DAY + 1n, ts));
    } else if (command === "run") {
      await runDueSteps({
        id, chain: CHAIN, bond: BOND, engagementSecret: eng.engagementSecret, priv: eng.priv,
        carrySalt: (e) => deriveSecret(seed, `carry-salt:${engRecord.label}:${e}`),
        readLedger, setInputs, run, contract,
      });
    } else if (command === "claim" && claim) {
      setInputs({
        engagementSecret: eng.engagementSecret, profileSecret: profileSecret(seed),
        terms: eng.priv.terms, termsSalt: eng.priv.termsSalt,
        claimRecordPresent: claim.present, claimRecordPaths: claim.paths,
      });
      await run("claim", () => contract.callTx.claim(id, claim.tier, claim.epochsPassed, 30n));
    } else if (command === "void") {
      setInputs({});
      await run("voidUnfunded", () => contract.callTx.voidUnfunded(id));
    }
    console.log(record.steps.length > stepsBefore ? `\nrecorded in ${recordFile}` : "\nno transaction was due");
  } finally {
    await wallet.stop();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("\nmm failed:", err);
    process.exit(1);
  },
);
