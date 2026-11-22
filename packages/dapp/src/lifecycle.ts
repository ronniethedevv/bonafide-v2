// @mmr/dapp — run one engagement's lifecycle on the deployed contract (Preview).
//
//   pnpm --filter @mmr/dapp lifecycle
//
// A sample engagement over the test harness's sample day (the same wallets, terms and
// day tree the contract tests use), driven through the live contract as real, proven
// transactions:
//
//   mint bond tokens → register → postBond → activate → publishRoot × 2 (day 1)
//   → proveFunding → then, for every day that has ended: publishRoot × 2, proveEpoch,
//   settleEpoch (inside the day's window), releaseEpoch (12 h after settlement)
//
// Each step first reads the contract's state from the indexer and is skipped if it
// already landed, so the script can be re-run at any time; steps whose time has not
// come say when it does and stop. Every transaction, with its proving-and-submission
// time, is recorded in deployments/<network>-lifecycle.json. Secrets (the engagement's,
// the attesters', the client's key) are derived from DEPLOY_SEED and never written.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as rt from "@midnight-ntwrk/compact-runtime";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { ZswapSecretKeys } from "@midnight-ntwrk/midnight-js-protocol/v9";
import { WalletSeeds } from "@midnightntwrk/wallet-sdk";
import { ledger } from "@mmr/contracts/epoch_proof";
import {
  FUNDED_A, buildScenario, cidBytes, epochKey, rootKey, type EpochRecordW,
} from "@mmr/contracts/harness";
import { CompactHasher } from "@mmr/merkle";
import { type CarryTotals, ZERO_CARRY, carryStep, genesisCarry } from "@mmr/prover";
import { nextTranche } from "@mmr/protocol";
import * as Rx from "rxjs";
import { deriveAttesterSecrets, deriveSecret } from "./committee.js";
import { loadConfig } from "./config.js";
import { useEnvProxy } from "./net.js";
import { PRIVATE_STATE_ID, compiledEpochProofFrom, compiledTestBondToken } from "./contract.js";
import { buildProviders } from "./providers.js";
import { buildHeadlessWallet, toMasterSeed } from "./wallet.js";

const DAY = 86_400n;
const CHALLENGE = 43_200n; // 12 h, as in releaseEpoch
const AFTER_END = 237_600n; // a day's settlement deadline, after it ends (attester, challenge, proving, grace)
const TIER = 1n; // A
const CHAIN = 8453n; // Base
const BOND = 10_000n; // tier A's minimum, in the bond token
const EPOCHS = 30;

interface Step { step: string; txId: string; blockHeight: number | undefined; seconds: number; at: string }
interface LifecycleRecord {
  network: string;
  contractAddress: string;
  sample: string;
  engagementId?: string;
  tier: number;
  chain: number;
  bond: number;
  startDay?: number;
  steps: Step[];
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const bytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const now = () => BigInt(Math.floor(Date.now() / 1000));
const dayLabel = (d: bigint) => new Date(Number(d * DAY) * 1000).toISOString().slice(0, 10);
const iso = (t: bigint) => new Date(Number(t) * 1000).toISOString();

async function main(): Promise<void> {
  useEnvProxy();
  const cfg = loadConfig();
  const here = dirname(fileURLToPath(import.meta.url));
  const deployment = JSON.parse(readFileSync(resolve(here, "..", "deployments", `${cfg.networkId}.json`), "utf8")) as {
    contractAddress: string;
    bondToken: { contractAddress: string; color: string };
  };
  const file = resolve(here, "..", "deployments", `${cfg.networkId}-lifecycle.json`);
  const record: LifecycleRecord = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as LifecycleRecord)
    : {
        network: cfg.networkId,
        contractAddress: deployment.contractAddress,
        sample:
          "A sample engagement over the contract tests' sample day tree (two wallets, one pool); " +
          "not real trading data.",
        tier: Number(TIER),
        chain: Number(CHAIN),
        bond: Number(BOND),
        steps: [],
      };
  const save = () => writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

  const seed = toMasterSeed(cfg.deploySeed);
  const engagementSecret = deriveSecret(seed, "engagement:sample-1");
  const attesters = deriveAttesterSecrets(seed);
  const clientKeys = ZswapSecretKeys.fromSeed(WalletSeeds.fromMasterSeed(deriveSecret(seed, "client:sample-1")).shielded);
  const scenario = buildScenario(undefined, 0, FUNDED_A); // epoch 1's tree shows the loan landing
  const w = scenario.witness;
  const root = scenario.rootOfRoots;
  const color = deployment.bondToken.color;

  console.log("mmr lifecycle — sample engagement on", cfg.networkId);
  console.log(`  contract       ${deployment.contractAddress}`);
  console.log("\nbuilding + syncing wallet…");
  const wallet = await buildHeadlessWallet(cfg);
  const myCoinKey = bytes(String(wallet.walletProvider.getCoinPublicKey()));

  // Witness values for the next call; each call sets the ones its circuit reads.
  const inputs = new Map<string, unknown>();
  const supply = (name: string) => inputs.get(name);
  const setInputs = (values: Record<string, unknown>) => {
    inputs.clear();
    for (const [k, v] of Object.entries(values)) inputs.set(k, v);
  };

  try {
    const providers = buildProviders(cfg, wallet, wallet.unshieldedAddress);
    const contract = await findDeployedContract(providers, {
      contractAddress: deployment.contractAddress,
      compiledContract: compiledEpochProofFrom(cfg.zkConfigPath, supply),
      privateStateId: PRIVATE_STATE_ID,
    });
    const tokenProviders = buildProviders<"mint">(cfg, wallet, wallet.unshieldedAddress, cfg.bondTokenZkConfigPath);
    const token = await findDeployedContract(tokenProviders, {
      contractAddress: deployment.bondToken.contractAddress,
      compiledContract: compiledTestBondToken(cfg.bondTokenZkConfigPath),
    });

    const readLedger = async () => {
      const res = await fetch(cfg.indexerUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: `{ contractAction(address: "${deployment.contractAddress}") { state } }` }),
      });
      const state = ((await res.json()) as { data: { contractAction: { state: string } } }).data.contractAction.state;
      return ledger(rt.ContractState.deserialize(bytes(state)).data);
    };
    const run = async (step: string, call: () => Promise<{ public: { txId: string; blockHeight?: number | bigint } }>) => {
      const started = Date.now();
      console.log(`\n${step}…`);
      const res = await call();
      const s: Step = {
        step,
        txId: res.public.txId,
        blockHeight: res.public.blockHeight === undefined ? undefined : Number(res.public.blockHeight),
        seconds: Math.round((Date.now() - started) / 100) / 10,
        at: new Date().toISOString(),
      };
      record.steps.push(s);
      save();
      console.log(`  tx ${s.txId}  block ${s.blockHeight}  ${s.seconds}s`);
      return res;
    };
    const synced = () => wallet.synced();

    // 1. Bond tokens for the market maker (the test token's mint).
    const balance = (s: Awaited<ReturnType<typeof synced>>) =>
      BigInt((s.shielded as { balances?: Record<string, bigint> }).balances?.[color] ?? 0n);
    let led = await readLedger();
    const id = rt.persistentHash(new rt.CompactTypeBytes(32), engagementSecret);
    const registered = led.status.member(id);
    if (!registered && balance(await synced()) < BOND) {
      await run("mint bond tokens", () =>
        token.callTx.mint({ bytes: myCoinKey }, BOND, Uint8Array.from(randomBytes(32))),
      );
      console.log("  waiting for the wallet to see the minted coin…");
      await Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((s) => s.isSynced && balance(s) >= BOND)));
    }

    // 2. Register: commitments to the wallets and terms; public tier, chain, bond, client key.
    if (!registered) {
      setInputs({
        engagementSecret, committedWallets: w.committedWallets, walletSalt: w.walletSalt,
        terms: w.terms, termsSalt: w.termsSalt,
      });
      await run("register", () =>
        contract.callTx.register(TIER, CHAIN, BOND, { bytes: bytes(String(clientKeys.coinPublicKey)) }, now() - 5n),
      );
      led = await readLedger();
    }
    record.engagementId = hex(id);
    save();
    console.log(`  engagement     ${hex(id)}`);

    // 3. Bond: a shielded coin of the bond token, held by the contract.
    if (!led.escrowed.member(id)) {
      setInputs({ bondCoin: { nonce: Uint8Array.from(randomBytes(32)), color: bytes(color), value: BOND } });
      await run("postBond", () => contract.callTx.postBond(id));
      led = await readLedger();
    }

    // 4. Activate: only the owner (engagement secret); day 1 is the next UTC day.
    if (!led.startDay.member(id)) {
      const ts = now() - 5n;
      setInputs({ engagementSecret });
      await run("activate", () => contract.callTx.activate(id, ts / DAY + 1n, ts));
      led = await readLedger();
    }
    const startDay = led.startDay.lookup(id) as bigint;
    record.startDay = Number(startDay);
    save();
    console.log(`  day 1          ${dayLabel(startDay)} (UTC)`);

    // 5. The committee publishes day 1's root: two of three members vote.
    const key = rootKey(CHAIN, startDay);
    for (const [i, secret] of attesters.slice(0, 2).entries()) {
      if (led.publishedRoot.member(key)) break;
      setInputs({ attesterSecret: secret });
      await run(`publishRoot (attester ${i + 1})`, () =>
        contract.callTx.publishRoot(CHAIN, startDay, root, cidBytes("sample-day-tree")),
      );
      led = await readLedger();
    }

    // 6. Funding: the loan reached the committed wallets, against day 1's root.
    const tree = {
      committedWallets: w.committedWallets, activeCount: w.activeCount, walletSalt: w.walletSalt,
      slotLeaves: w.slotLeaves, terms: w.terms, termsSalt: w.termsSalt,
      slotPaths: w.slotPaths, poolEntry: w.poolEntry, poolPath: w.poolPath,
    };
    if (!led.fundingProven.member(id)) {
      setInputs(tree);
      await run("proveFunding", () => contract.callTx.proveFunding(id, root));
      led = await readLedger();
    }

    // 7-9. Every day that has ended: publish its root, prove it (the outflow totals carry
    // from day to day as a salted commitment), settle it inside its window, and release its
    // share of the bond 12 hours after settlement. A day whose settlement window closed
    // unsettled is reported: it is then defaultable, which sends the bond to the client.
    const hasher = new CompactHasher();
    const members = w.slotLeaves.filter((l) => l.present);
    const sum = (f: (l: (typeof members)[number]) => bigint) => members.reduce((a, l) => a + f(l), 0n);
    const daySums: CarryTotals = {
      xferIn: sum((l) => l.xfer_in), xferOut: sum((l) => l.xfer_out), fromTreasury: sum((l) => l.from_treasury),
    };
    const saltFor = (e: bigint) => (e === 1n ? w.carryNewSalt : deriveSecret(seed, `carry-salt:sample-1:${e}`));
    const lastEnded = now() / DAY - startDay; // day e has ended once (startDay + e) days have passed
    const lastDay = lastEnded < 1n ? 1n : lastEnded > BigInt(EPOCHS) ? BigInt(EPOCHS) : lastEnded;
    let prevTotals: CarryTotals = ZERO_CARRY;
    let prevSalt = w.carryPrevSalt;
    let prevCommitment = genesisCarry(hasher, prevSalt);
    for (let e = 1n; e <= lastDay; e++) {
      const day = startDay + e - 1n;
      const ek = epochKey(id, e);
      const newSalt = saltFor(e);
      const step = carryStep(hasher, {
        prevCommitment, prevTotals, prevSalt, epochSums: daySums, newSalt, disposalD: w.terms.disposal_D,
      });

      const rk = rootKey(CHAIN, day);
      for (const [i, secret] of attesters.slice(0, 2).entries()) {
        if (led.publishedRoot.member(rk)) break;
        setInputs({ attesterSecret: secret });
        await run(`publishRoot day ${e} (attester ${i + 1})`, () =>
          contract.callTx.publishRoot(CHAIN, day, root, cidBytes("sample-day-tree")),
        );
        led = await readLedger();
      }

      if (!led.epochUptime.member(ek)) {
        const onChain = led.carryCommitment.member(id) ? hex(led.carryCommitment.lookup(id) as Uint8Array) : undefined;
        if (e > 1n && onChain !== hex(prevCommitment)) {
          throw new Error(`day ${e}: the on-chain outflow commitment does not continue from day ${e - 1n}`);
        }
        setInputs({
          ...tree, bidMin: w.bidMin, askMin: w.askMin, depthPaths: w.depthPaths,
          flowBuy: w.flowBuy, flowSell: w.flowSell,
          carryPrev: { xfer_in: prevTotals.xferIn, xfer_out: prevTotals.xferOut, from_treasury: prevTotals.fromTreasury },
          carryPrevSalt: prevSalt, carryNewSalt: newSalt,
        });
        await run(`proveEpoch (day ${e})`, () => contract.callTx.proveEpoch(id, root, e));
        led = await readLedger();
      }
      console.log(`  day ${e} (${dayLabel(day)}) uptime ${led.epochUptime.lookup(ek)} of 48 buckets`);

      const dayEnd = (startDay + e) * DAY;
      const deadline = dayEnd + AFTER_END;
      if (!led.settledAt.member(ek)) {
        if (now() < dayEnd) {
          console.log(`  settleEpoch for day ${e} opens when it ends: ${iso(dayEnd)}. Re-run then.`);
        } else if (now() >= deadline) {
          console.log(`  day ${e}'s settlement window closed at ${iso(deadline)} unsettled: it is defaultable.`);
        } else {
          const rec: EpochRecordW = {
            id, epoch: e, uptime: led.epochUptime.lookup(ek) as bigint,
            termsCommit: led.termsCommit.lookup(id) as Uint8Array, tier: led.tier.lookup(id) as bigint,
          };
          const path = led.epochRecords.findPathForLeaf(rec);
          if (!path) throw new Error(`day ${e}'s record is not in the contract's record tree`);
          setInputs({ settleRecordPath: path });
          await run(`settleEpoch (day ${e})`, () => contract.callTx.settleEpoch(id, e, now() - 5n));
          led = await readLedger();
        }
      }

      if (led.settledAt.member(ek) && !led.epochReleased.member(ek)) {
        const opens = (led.settledAt.lookup(ek) as bigint) + CHALLENGE;
        if (now() < opens) {
          console.log(`  releaseEpoch for day ${e} opens after the challenge window: ${iso(opens)}. Re-run then.`);
        } else {
          const released = led.releasedEpochs.member(id) ? Number(led.releasedEpochs.lookup(id)) : 0;
          setInputs({});
          await run(`releaseEpoch (day ${e})`, () =>
            contract.callTx.releaseEpoch(id, e, nextTranche(BOND, EPOCHS, released)),
          );
          led = await readLedger();
        }
      }
      prevTotals = step.newTotals;
      prevSalt = newSalt;
      prevCommitment = step.newCommitment;
    }
    console.log(`
recorded in ${file}`);
  } finally {
    await wallet.stop();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("\nlifecycle failed:", err);
    process.exit(1);
  },
);
