// @mmr/dapp — run the engagement's lifecycle on the deployed contract (Preview), on real
// Base data.
//
//   pnpm --filter @mmr/dapp lifecycle
//
// Two roles, one process (one seed holds every key in this demo):
//
//   Attesters: for every day the daily indexer stored, fetch its manifest and pool trees
//   from IPFS and recompute the root (the watcher's check). A root that recomputes gets
//   two of three committee votes (publishRoot). A published root that does not recompute
//   gets dispute votes instead, while the day's dispute window is open.
//
//   Market maker: the engagement in deployments/<network>-engagement.json (a sealed
//   engagement file, opened with the seed): mint bond tokens → register → postBond →
//   activate → proveFunding against an attested day from registration through day 1 →
//   then for every day that has ended, in order: proveEpoch from that day's published
//   tree and series (outflow totals carried day to day as a salted commitment),
//   settleEpoch inside the day's window, releaseEpoch once the day's dispute window has
//   closed (settled: credited; disputed: neutral).
//
// Each step reads the contract's state first and is skipped if it already landed, so the
// script can run at any time; steps whose time has not come say when. Every transaction
// is recorded in deployments/<network>-lifecycle.json (public data only). Secrets are
// derived from DEPLOY_SEED or read from the sealed file and never written.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as rt from "@midnight-ntwrk/compact-runtime";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { ZswapSecretKeys } from "@midnight-ntwrk/midnight-js-protocol/v9";
import { WalletSeeds } from "@midnightntwrk/wallet-sdk";
import { ledger } from "@mmr/contracts/epoch_proof";
import { cidBytes, epochKey, rootKey, type CarryTotalsW, type EpochRecordW } from "@mmr/contracts/harness";
import { CompactHasher } from "@mmr/merkle";
import { carryStep, genesisCarry } from "@mmr/prover";
import { nextTranche } from "@mmr/protocol";
import * as Rx from "rxjs";
import { deriveAttesterSecrets, deriveSecret } from "./committee.js";
import { loadConfig } from "./config.js";
import { PRIVATE_STATE_ID, compiledEpochProofFrom, compiledTestBondToken } from "./contract.js";
import { openEngagement, readEngagementRecord } from "./engagement.js";
import { indexedDays } from "./indexed-days.js";
import { useEnvProxy } from "./net.js";
import { buildProviders } from "./providers.js";
import { type PublishedDay, loadPublishedDay, loadSeries } from "./published.js";
import { realWitness, walletVector } from "./real-witness.js";
import { buildHeadlessWallet, toMasterSeed } from "./wallet.js";

const DAY = 86_400n;
const AFTER_END = 237_600n; // a day's deadline after it ends: settlement, disputes, release
const EPOCHS = 30;

interface Step { step: string; txId: string; blockHeight: number | undefined; seconds: number; at: string }
interface Note { at: string; note: string }
interface LifecycleRecord {
  network: string;
  contractAddress: string;
  engagementId?: string;
  tier: number;
  chain: number;
  bond: number;
  pool: { address: string; pair: string };
  startDay?: number;
  steps: Step[];
  /** Days that could not be proven or voted on, and why (public facts). */
  notes?: Note[];
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const bytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const now = () => BigInt(Math.floor(Date.now() / 1000));
const dayLabel = (d: bigint | number) => new Date(Number(BigInt(d) * DAY) * 1000).toISOString().slice(0, 10);
const iso = (t: bigint) => new Date(Number(t) * 1000).toISOString();
const deadlineOf = (day: bigint) => (day + 1n) * DAY + AFTER_END;
const cidOf = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0+$/, "");

async function main(): Promise<void> {
  useEnvProxy();
  const cfg = loadConfig();
  const here = dirname(fileURLToPath(import.meta.url));
  const out = (name: string) => resolve(here, "..", "deployments", name);
  const deployment = JSON.parse(readFileSync(out(`${cfg.networkId}.json`), "utf8")) as {
    contractAddress: string;
    bondToken: { contractAddress: string; color: string };
  };
  const seed = toMasterSeed(cfg.deploySeed);
  const engRecord = readEngagementRecord(out(`${cfg.networkId}-engagement.json`));
  if (!engRecord) throw new Error("no engagement: create one with `pnpm --filter @mmr/dapp engagement:new`");
  if (engRecord.contractAddress !== deployment.contractAddress) {
    throw new Error(`the engagement file is for contract ${engRecord.contractAddress}, not ${deployment.contractAddress}`);
  }
  const eng = await openEngagement(seed, engRecord);
  const CHAIN = BigInt(engRecord.chain);
  const TIER = BigInt(engRecord.tier);
  const BOND = BigInt(engRecord.bond);

  const file = out(`${cfg.networkId}-lifecycle.json`);
  const record: LifecycleRecord = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as LifecycleRecord)
    : {
        network: cfg.networkId, contractAddress: deployment.contractAddress,
        tier: engRecord.tier, chain: engRecord.chain, bond: engRecord.bond, pool: engRecord.pool, steps: [],
      };
  const save = () => writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  const note = (text: string) => {
    console.log(`  ${text}`);
    if (!(record.notes ?? []).some((n) => n.note === text)) {
      record.notes = [...(record.notes ?? []), { at: new Date().toISOString(), note: text }];
      save();
    }
  };

  const attesters = deriveAttesterSecrets(seed);
  const clientKeys = ZswapSecretKeys.fromSeed(WalletSeeds.fromMasterSeed(deriveSecret(seed, `client:${engRecord.label}`)).shielded);
  const color = deployment.bondToken.color;

  console.log(`mmr lifecycle — ${engRecord.pool.pair} on chain ${engRecord.chain}, ${cfg.networkId}`);
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
      // The witnesses read `inputs`, not the private state, so a fresh machine (the
      // scheduled job) attaches without a store.
      initialPrivateState: {},
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

    let led = await readLedger();
    const id = rt.persistentHash(new rt.CompactTypeBytes(32), eng.engagementSecret);
    const registered = led.status.member(id);
    const today = now() / DAY;

    // --- Attesters -------------------------------------------------------------------
    // Days from registration (or the 3 days before, until it registers) to yesterday,
    // and no further than the engagement's last day once it has started.
    const regDay = registered ? (led.registeredAt.lookup(id) as bigint) / DAY : today - 3n;
    const lastDay = led.startDay.member(id) ? (led.startDay.lookup(id) as bigint) + BigInt(EPOCHS) - 1n : today;
    const toDay = today - 1n < lastDay ? today - 1n : lastDay;
    const loaded = new Map<number, PublishedDay>();
    const days = await indexedDays(engRecord.chain, Number(regDay), Number(toDay));
    console.log(toDay < regDay
      ? `\nattesters: no day to attest yet (the first is ${dayLabel(regDay)})`
      : `\nattesters: ${days.length} indexed day(s) from ${dayLabel(regDay)} to ${dayLabel(toDay)}`);
    for (const d of days) {
      const day = BigInt(d.day);
      const rk = rootKey(CHAIN, day);
      if (!led.publishedRoot.member(rk)) {
        const check = await loadPublishedDay(d.manifestCid, d.rootHex);
        if (!check.ok) {
          note(`${dayLabel(day)}: no vote, the published data does not recompute (${check.reason})`);
          continue;
        }
        loaded.set(d.day, check.day);
        for (const [i, secret] of attesters.slice(0, 2).entries()) {
          if (led.publishedRoot.member(rk)) break;
          setInputs({ attesterSecret: secret });
          await run(`publishRoot ${dayLabel(day)} (attester ${i + 1})`, () =>
            contract.callTx.publishRoot(CHAIN, day, bytes(check.day.rootHex), cidBytes(d.manifestCid)),
          );
          led = await readLedger();
        }
      } else if (!led.disputedRoot.member(rk) && now() < deadlineOf(day)) {
        // Watch a published root: recompute it from the CID published with it.
        const onChainRoot = `0x${hex(led.publishedRoot.lookup(rk) as Uint8Array)}`;
        const check = await loadPublishedDay(cidOf(led.publishedCid.lookup(rk) as Uint8Array), onChainRoot);
        if (check.ok) {
          loaded.set(d.day, check.day);
        } else {
          note(`${dayLabel(day)}: the published root does not recompute (${check.reason}); disputing`);
          for (const [i, secret] of attesters.slice(0, 2).entries()) {
            if (led.disputedRoot.member(rk)) break;
            setInputs({ attesterSecret: secret });
            await run(`disputeRoot ${dayLabel(day)} (attester ${i + 1})`, () => contract.callTx.disputeRoot(CHAIN, day));
            led = await readLedger();
          }
        }
      }
    }
    /** The published, recomputed data of a day whose root is on chain (cached per run). */
    const published = async (day: bigint): Promise<PublishedDay | undefined> => {
      const rk = rootKey(CHAIN, day);
      if (!led.publishedRoot.member(rk)) return undefined;
      const cached = loaded.get(Number(day));
      if (cached) return cached;
      const onChainRoot = `0x${hex(led.publishedRoot.lookup(rk) as Uint8Array)}`;
      const check = await loadPublishedDay(cidOf(led.publishedCid.lookup(rk) as Uint8Array), onChainRoot);
      if (!check.ok) throw new Error(`${dayLabel(day)}: the published root does not recompute (${check.reason})`);
      loaded.set(Number(day), check.day);
      return check.day;
    };

    // --- Market maker ----------------------------------------------------------------
    const regInputs = {
      engagementSecret: eng.engagementSecret,
      committedWallets: walletVector(eng.priv.wallets),
      walletSalt: eng.priv.walletSalt, terms: eng.priv.terms, termsSalt: eng.priv.termsSalt,
    };

    // 1. Bond tokens for the market maker (the test token's mint).
    const synced = () => wallet.synced();
    const balance = (s: Awaited<ReturnType<typeof synced>>) =>
      BigInt((s.shielded as { balances?: Record<string, bigint> }).balances?.[color] ?? 0n);
    if (!registered && balance(await synced()) < BOND) {
      await run("mint bond tokens", () => token.callTx.mint({ bytes: myCoinKey }, BOND, Uint8Array.from(randomBytes(32))));
      console.log("  waiting for the wallet to see the minted coin…");
      await Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((s) => s.isSynced && balance(s) >= BOND)));
    }

    // 2. Register: commitments to the wallets and terms; public tier, chain, bond, client key.
    if (!registered) {
      setInputs(regInputs);
      await run("register", () =>
        contract.callTx.register(TIER, CHAIN, BOND, { bytes: bytes(String(clientKeys.coinPublicKey)) }, now() - 5n),
      );
      led = await readLedger();
    }
    const opening = eng.opening;
    if (`0x${hex(led.walletCommit.lookup(id) as Uint8Array)}` !== opening.commitments.walletCommit
        || `0x${hex(led.termsCommit.lookup(id) as Uint8Array)}` !== opening.commitments.termsCommit) {
      throw new Error("the registered commitments differ from the engagement file's");
    }
    record.engagementId = hex(id);
    save();
    console.log(`\n  engagement     ${hex(id)}`);

    // 3. Bond: a shielded coin of the bond token, held by the contract (owner only).
    if (!led.escrowed.member(id)) {
      setInputs({
        engagementSecret: eng.engagementSecret,
        bondCoin: { nonce: Uint8Array.from(randomBytes(32)), color: bytes(color), value: BOND },
      });
      await run("postBond", () => contract.callTx.postBond(id));
      led = await readLedger();
    }

    // 4. Activate: only the owner; day 1 is the next UTC day.
    if (!led.startDay.member(id)) {
      const ts = now() - 5n;
      setInputs({ engagementSecret: eng.engagementSecret });
      await run("activate", () => contract.callTx.activate(id, ts / DAY + 1n, ts));
      led = await readLedger();
    }
    const startDay = led.startDay.lookup(id) as bigint;
    record.startDay = Number(startDay);
    save();
    console.log(`  day 1          ${dayLabel(startDay)} (UTC)`);

    // 5. Funding: against any attested, undisputed day from registration through day 1.
    if (!led.fundingProven.member(id)) {
      const reg = (led.registeredAt.lookup(id) as bigint) / DAY;
      let done = false;
      for (let d = reg; d <= startDay && !done; d++) {
        if (led.disputedRoot.member(rootKey(CHAIN, d))) continue;
        const day = await published(d);
        if (!day) continue;
        const rw = realWitness(day, eng.priv, undefined);
        setInputs({ ...regInputs, ...rw.witness });
        await run(`proveFunding (${dayLabel(d)})`, () => contract.callTx.proveFunding(id, d, rw.rootOfRoots));
        led = await readLedger();
        done = true;
      }
      if (!done) console.log(`  proveFunding waits for an attested day from ${dayLabel(reg)} to ${dayLabel(startDay)}`);
    }

    // 6. Every day that has ended, in order. The outflow totals carry from one proven day
    // to the next as a salted commitment, so days are proven in order; a day that cannot
    // be proven (its root disputed, its window closed, or a failed check) is skipped.
    const hasher = new CompactHasher();
    const saltFor = (e: bigint) => deriveSecret(seed, `carry-salt:${engRecord.label}:${e}`);
    const ended = today - startDay; // day e has ended once startDay + e days have passed
    const last = ended > BigInt(EPOCHS) ? BigInt(EPOCHS) : ended;
    let prev: CarryTotalsW = { xfer_in: 0n, xfer_out: 0n, from_treasury: 0n };
    let prevSalt: Uint8Array = new Uint8Array(32);
    let prevCommitment = genesisCarry(hasher, prevSalt);
    for (let e = 1n; e <= last; e++) {
      const day = startDay + e - 1n;
      const ek = epochKey(id, e);
      const rk = rootKey(CHAIN, day);
      const deadline = deadlineOf(day);
      const label = `day ${e} (${dayLabel(day)})`;

      if (!led.epochUptime.member(ek)) {
        if (led.disputedRoot.member(rk)) {
          console.log(`  ${label}: root disputed, neutral`);
        } else if (!led.publishedRoot.member(rk)) {
          if (now() >= deadline) note(`${label}: no root was attested before its deadline; not provable`);
          else { console.log(`  ${label}: waiting for its attested root`); break; }
        } else if (now() >= deadline) {
          console.log(`  ${label}: deadline passed unproven`);
        } else if (!led.fundingProven.member(id)) {
          console.log(`  ${label}: waits for proveFunding`);
          break;
        } else {
          const pd = (await published(day))!;
          const newSalt = saltFor(e);
          const rw = realWitness(pd, eng.priv, await loadSeries(pd, eng.priv.poolAddr), { prev, prevSalt, newSalt });
          const onChain = led.carryCommitment.member(id) ? hex(led.carryCommitment.lookup(id) as Uint8Array) : undefined;
          if (onChain !== undefined && onChain !== hex(prevCommitment)) {
            throw new Error(`${label}: the on-chain outflow commitment does not continue from the last proven day`);
          }
          setInputs({ ...regInputs, ...rw.witness });
          try {
            await run(`proveEpoch (${label})`, () => contract.callTx.proveEpoch(id, rw.rootOfRoots, e));
            led = await readLedger();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!/failed assert/.test(msg)) throw err;
            note(`${label}: not provable: ${msg.replace(/^[\s\S]*failed assert:\s*/, "").split("\n")[0]}`);
          }
        }
      }

      if (led.epochUptime.member(ek)) {
        // Continue the carry chain over this proven day (recomputed from its public data).
        const pd = (await published(day))!;
        const sums = realWitness(pd, eng.priv, undefined).sums;
        const step = carryStep(hasher, {
          prevCommitment,
          prevTotals: { xferIn: prev.xfer_in, xferOut: prev.xfer_out, fromTreasury: prev.from_treasury },
          prevSalt,
          epochSums: { xferIn: sums.xfer_in, xferOut: sums.xfer_out, fromTreasury: sums.from_treasury },
          newSalt: saltFor(e),
          disposalD: eng.priv.terms.disposal_D,
        });
        prev = { xfer_in: step.newTotals.xferIn, xfer_out: step.newTotals.xferOut, from_treasury: step.newTotals.fromTreasury };
        prevSalt = saltFor(e);
        prevCommitment = step.newCommitment;
        console.log(`  ${label}: uptime ${led.epochUptime.lookup(ek)} of 48 buckets`);

        // Settle inside the window.
        const dayEnd = (day + 1n) * DAY;
        if (!led.settledAt.member(ek) && !led.disputedRoot.member(rk)) {
          if (now() < dayEnd) console.log(`  ${label}: settleEpoch opens ${iso(dayEnd)}`);
          else if (now() >= deadline) console.log(`  ${label}: settlement window closed unsettled; defaultable`);
          else {
            const rec: EpochRecordW = {
              id, epoch: e, uptime: led.epochUptime.lookup(ek) as bigint,
              termsCommit: led.termsCommit.lookup(id) as Uint8Array, tier: led.tier.lookup(id) as bigint,
            };
            const path = led.epochRecords.findPathForLeaf(rec);
            if (!path) throw new Error(`${label}: its record is not in the contract's record tree`);
            setInputs({ settleRecordPath: path });
            await run(`settleEpoch (${label})`, () => contract.callTx.settleEpoch(id, e, now() - 5n));
            led = await readLedger();
          }
        }
      }

      // Release once the day's dispute window has closed: settled (credited) or disputed (neutral).
      if ((led.settledAt.member(ek) || led.disputedRoot.member(rk)) && !led.epochReleased.member(ek)) {
        if (now() < deadline) console.log(`  ${label}: releaseEpoch opens ${iso(deadline)}`);
        else {
          const released = led.releasedEpochs.member(id) ? Number(led.releasedEpochs.lookup(id)) : 0;
          setInputs({});
          await run(`releaseEpoch (${label})`, () => contract.callTx.releaseEpoch(id, e, nextTranche(BOND, EPOCHS, released)));
          led = await readLedger();
        }
      }
    }
    console.log(`\nrecorded in ${file}`);
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
