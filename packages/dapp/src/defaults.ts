// @mmr/dapp — engagements a default can be declared on.
//
// Anyone may call defaultEngagement: it needs no private input. It succeeds for a running
// engagement once one of its days has an attested, undisputed root and was not settled
// before that day's deadline (the day's end + 66 hours), and it pays the whole bond the
// contract still holds to the client's key. The contract checks every rule again; this only
// finds the candidates, so that the scheduled job can declare defaults and no client has to.

import { epochKey, rootKey } from "@mmr/contracts/harness";

const DAY = 86_400n;
const AFTER_END = 237_600n; // a day's deadline after it ends, as in the contract
const RUNNING = 1; // Status.Funded: activated and running

interface MapLike<K, V> {
  member(key: K): boolean;
  lookup(key: K): V;
}

/** The parts of the contract's ledger the rules read (the compiled ledger satisfies it). */
export interface DefaultLedger {
  status: Iterable<[Uint8Array, number]>;
  startDay: MapLike<Uint8Array, bigint>;
  chainOf: MapLike<Uint8Array, bigint>;
  contractEpochs: MapLike<Uint8Array, bigint>;
  settledAt: MapLike<Uint8Array, bigint>;
  publishedRoot: MapLike<Uint8Array, Uint8Array>;
  disputedRoot: { member(key: Uint8Array): boolean };
  slashed: MapLike<Uint8Array, boolean>;
}

export interface DefaultCandidate {
  id: Uint8Array;
  /** The first day (epoch) that missed its deadline: one default pays out the whole bond. */
  epoch: bigint;
  /** Its UTC day number. */
  day: bigint;
}

/**
 * Running engagements with a day past its deadline, attested, undisputed and unsettled, at
 * `now` (seconds). Engagements in `skip` are left out.
 */
export function defaultCandidates(led: DefaultLedger, now: bigint, skip: readonly Uint8Array[] = []): DefaultCandidate[] {
  const skipped = new Set(skip.map(hex));
  const out: DefaultCandidate[] = [];
  for (const [id, status] of led.status) {
    if (Number(status) !== RUNNING || skipped.has(hex(id))) continue;
    if (led.slashed.member(id) && led.slashed.lookup(id)) continue;
    if (!led.startDay.member(id) || !led.chainOf.member(id)) continue;
    const start = led.startDay.lookup(id);
    const chain = led.chainOf.lookup(id);
    const epochs = led.contractEpochs.member(id) ? led.contractEpochs.lookup(id) : 30n;
    for (let e = 1n; e <= epochs; e++) {
      // Deadlines only grow with the day, so the first day still open ends the search.
      if (now < (start + e) * DAY + AFTER_END) break;
      const day = start + e - 1n;
      const rk = rootKey(chain, day);
      if (!led.publishedRoot.member(rk) || led.disputedRoot.member(rk)) continue;
      if (led.settledAt.member(epochKey(id, e))) continue;
      out.push({ id, epoch: e, day });
      break;
    }
  }
  return out;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
