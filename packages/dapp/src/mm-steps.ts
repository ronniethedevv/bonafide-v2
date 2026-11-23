// @mmr/dapp — the market maker's day-by-day steps for one engagement, from the contract's
// state and the published data alone (no database, no attester key): what `mm run` does on
// the market maker's own machine.
//
//   1. proveFunding against any attested, undisputed day from registration through day 1
//   2. for every day that has ended, in order: proveEpoch from the day's published tree and
//      series (outflow totals carried day to day as a salted commitment), settleEpoch inside
//      the day's window, releaseEpoch once its dispute window has closed
//
// The scheduled lifecycle job carries the live demonstration engagement with the same steps;
// it is left unchanged while that run is live.

import { type CarryTotalsW, type EpochRecordW, epochKey, rootKey } from "@mmr/contracts/harness";
import type { ledger } from "@mmr/contracts/epoch_proof";
import { CompactHasher } from "@mmr/merkle";
import { carryStep, genesisCarry } from "@mmr/prover";
import { nextTranche } from "@mmr/protocol";
import { type PublishedDay, loadPublishedDay, loadSeries } from "./published.js";
import { type EngagementPrivate, realWitness, walletVector } from "./real-witness.js";

const DAY = 86_400n;
const AFTER_END = 237_600n; // a day's deadline after it ends: settlement, disputes, release
const EPOCHS = 30;

type Ledger = ReturnType<typeof ledger>;
type TxResult = { public: { txId: string; blockHeight?: number | bigint } };

/** What the steps need from the caller: the deployed contract, a ledger reader and a transaction runner. */
export interface MmContext {
  id: Uint8Array;
  chain: bigint;
  bond: bigint;
  engagementSecret: Uint8Array;
  priv: EngagementPrivate;
  /** The salt of the carried outflow totals after day e (deterministic, from the market maker's seed). */
  carrySalt: (e: bigint) => Uint8Array;
  readLedger: () => Promise<Ledger>;
  setInputs: (values: Record<string, unknown>) => void;
  run: (step: string, call: () => Promise<TxResult>) => Promise<unknown>;
  contract: {
    callTx: {
      proveFunding(id: Uint8Array, day: bigint, root: Uint8Array): Promise<TxResult>;
      proveEpoch(id: Uint8Array, root: Uint8Array, epoch: bigint): Promise<TxResult>;
      settleEpoch(id: Uint8Array, epoch: bigint, ts: bigint): Promise<TxResult>;
      releaseEpoch(id: Uint8Array, epoch: bigint, amount: bigint): Promise<TxResult>;
    };
  };
  log?: (line: string) => void;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const now = () => BigInt(Math.floor(Date.now() / 1000));
const dayLabel = (d: bigint) => new Date(Number(d * DAY) * 1000).toISOString().slice(0, 10);
const iso = (t: bigint) => new Date(Number(t) * 1000).toISOString();
const deadlineOf = (day: bigint) => (day + 1n) * DAY + AFTER_END;
const cidOf = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0+$/, "");

export async function runDueSteps(c: MmContext): Promise<void> {
  const log = c.log ?? ((l: string) => console.log(l));
  const { id, chain: CHAIN } = c;
  let led = await c.readLedger();
  if (!led.startDay.member(id)) return log("  not active yet: run `mm activate` first");
  const startDay = led.startDay.lookup(id) as bigint;
  const regInputs = {
    engagementSecret: c.engagementSecret,
    committedWallets: walletVector(c.priv.wallets),
    walletSalt: c.priv.walletSalt, terms: c.priv.terms, termsSalt: c.priv.termsSalt,
  };
  const loaded = new Map<bigint, PublishedDay>();
  /** The published, recomputed data of a day whose root is on chain. */
  const published = async (day: bigint): Promise<PublishedDay | undefined> => {
    const rk = rootKey(CHAIN, day);
    if (!led.publishedRoot.member(rk)) return undefined;
    const cached = loaded.get(day);
    if (cached) return cached;
    const onChainRoot = `0x${hex(led.publishedRoot.lookup(rk) as Uint8Array)}`;
    const check = await loadPublishedDay(cidOf(led.publishedCid.lookup(rk) as Uint8Array), onChainRoot);
    if (!check.ok) throw new Error(`${dayLabel(day)}: the published root does not recompute (${check.reason})`);
    loaded.set(day, check.day);
    return check.day;
  };

  // 1. Funding: against any attested, undisputed day from registration through day 1.
  if (!led.fundingProven.member(id)) {
    const reg = (led.registeredAt.lookup(id) as bigint) / DAY;
    let done = false;
    for (let d = reg; d <= startDay && !done; d++) {
      if (led.disputedRoot.member(rootKey(CHAIN, d))) continue;
      const day = await published(d);
      if (!day) continue;
      c.setInputs({ ...regInputs, ...realWitness(day, c.priv, undefined).witness });
      await c.run(`proveFunding (${dayLabel(d)})`, () => c.contract.callTx.proveFunding(id, d, realWitness(day, c.priv, undefined).rootOfRoots));
      led = await c.readLedger();
      done = true;
    }
    if (!done) log(`  proveFunding waits for an attested day from ${dayLabel(reg)} to ${dayLabel(startDay)}`);
  }

  // 2. Every day that has ended, in order (the outflow totals carry from day to day).
  const hasher = new CompactHasher();
  const ended = now() / DAY - startDay;
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
      if (led.disputedRoot.member(rk)) log(`  ${label}: root disputed, neutral`);
      else if (!led.publishedRoot.member(rk)) {
        if (now() >= deadline) log(`  ${label}: no root was attested before its deadline; not provable`);
        else { log(`  ${label}: waiting for its attested root`); break; }
      } else if (now() >= deadline) log(`  ${label}: deadline passed unproven`);
      else if (!led.fundingProven.member(id)) { log(`  ${label}: waits for proveFunding`); break; }
      else {
        const pd = (await published(day))!;
        const rw = realWitness(pd, c.priv, await loadSeries(pd, c.priv.poolAddr), { prev, prevSalt, newSalt: c.carrySalt(e) });
        const onChain = led.carryCommitment.member(id) ? hex(led.carryCommitment.lookup(id) as Uint8Array) : undefined;
        if (onChain !== undefined && onChain !== hex(prevCommitment)) {
          throw new Error(`${label}: the on-chain outflow commitment does not continue from the last proven day`);
        }
        c.setInputs({ ...regInputs, ...rw.witness });
        try {
          await c.run(`proveEpoch (${label})`, () => c.contract.callTx.proveEpoch(id, rw.rootOfRoots, e));
          led = await c.readLedger();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/failed assert/.test(msg)) throw err;
          log(`  ${label}: not provable: ${msg.replace(/^[\s\S]*failed assert:\s*/, "").split("\n")[0]}`);
        }
      }
    }

    if (led.epochUptime.member(ek)) {
      // Continue the carry chain over this proven day (recomputed from its public data).
      const sums = realWitness((await published(day))!, c.priv, undefined).sums;
      const step = carryStep(hasher, {
        prevCommitment,
        prevTotals: { xferIn: prev.xfer_in, xferOut: prev.xfer_out, fromTreasury: prev.from_treasury },
        prevSalt,
        epochSums: { xferIn: sums.xfer_in, xferOut: sums.xfer_out, fromTreasury: sums.from_treasury },
        newSalt: c.carrySalt(e),
        disposalD: c.priv.terms.disposal_D,
      });
      prev = { xfer_in: step.newTotals.xferIn, xfer_out: step.newTotals.xferOut, from_treasury: step.newTotals.fromTreasury };
      prevSalt = c.carrySalt(e);
      prevCommitment = step.newCommitment;
      log(`  ${label}: uptime ${led.epochUptime.lookup(ek)} of 48 buckets`);

      const dayEnd = (day + 1n) * DAY;
      if (!led.settledAt.member(ek) && !led.disputedRoot.member(rk)) {
        if (now() < dayEnd) log(`  ${label}: settleEpoch opens ${iso(dayEnd)}`);
        else if (now() >= deadline) log(`  ${label}: settlement window closed unsettled; defaultable`);
        else {
          const rec: EpochRecordW = {
            id, epoch: e, uptime: led.epochUptime.lookup(ek) as bigint,
            termsCommit: led.termsCommit.lookup(id) as Uint8Array, tier: led.tier.lookup(id) as bigint,
          };
          const path = led.epochRecords.findPathForLeaf(rec);
          if (!path) throw new Error(`${label}: its record is not in the contract's record tree`);
          c.setInputs({ settleRecordPath: path });
          await c.run(`settleEpoch (${label})`, () => c.contract.callTx.settleEpoch(id, e, now() - 5n));
          led = await c.readLedger();
        }
      }
    }

    // Release once the day's dispute window has closed: settled (credited) or disputed (neutral).
    if ((led.settledAt.member(ek) || led.disputedRoot.member(rk)) && !led.epochReleased.member(ek)) {
      if (now() < deadline) log(`  ${label}: releaseEpoch opens ${iso(deadline)}`);
      else {
        const released = led.releasedEpochs.member(id) ? Number(led.releasedEpochs.lookup(id)) : 0;
        c.setInputs({});
        await c.run(`releaseEpoch (${label})`, () => c.contract.callTx.releaseEpoch(id, e, nextTranche(c.bond, EPOCHS, released)));
        led = await c.readLedger();
      }
    }
  }
}

const GENESIS_RECORD: EpochRecordW = { id: new Uint8Array(32), epoch: 0n, uptime: 0n, termsCommit: new Uint8Array(32), tier: 0n };

export interface ClaimInputs {
  /** One flag per day: the day is credited (released, undisputed) and presented. */
  present: boolean[];
  /** One path per day into creditedRecords; an unpresented day carries the genesis record's. */
  paths: unknown[];
  /** Presented days whose uptime met the terms: what the claim adds to the profile. */
  epochsPassed: bigint;
  tier: bigint;
  credited: number;
  released: number;
}

/**
 * The claim's private inputs, read from the ledger: every credited day of the engagement
 * with its path into creditedRecords (only released, undisputed days reach it), and how
 * many of them met the terms' minimum uptime.
 */
export function claimInputs(led: Ledger, id: Uint8Array, minUptime: bigint): ClaimInputs {
  const genesis = led.creditedRecords.findPathForLeaf(GENESIS_RECORD);
  if (!genesis) throw new Error("the contract's genesis record is missing");
  const present: boolean[] = [];
  const paths: unknown[] = [];
  let passed = 0n;
  for (let e = 1n; e <= BigInt(EPOCHS); e++) {
    const ek = epochKey(id, e);
    const rec = led.settledRecord.member(ek) ? (led.settledRecord.lookup(ek) as EpochRecordW) : undefined;
    const path = rec && led.epochReleased.member(ek) ? led.creditedRecords.findPathForLeaf(rec) : undefined;
    present.push(path !== undefined);
    paths.push(path ?? genesis);
    if (path && rec!.uptime >= minUptime) passed++;
  }
  return {
    present, paths, epochsPassed: passed,
    tier: led.tier.lookup(id) as bigint,
    credited: present.filter(Boolean).length,
    released: led.releasedEpochs.member(id) ? Number(led.releasedEpochs.lookup(id)) : 0,
  };
}
