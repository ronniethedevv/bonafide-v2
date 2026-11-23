// Read one engagement's public state from the deployed epoch_proof contract on Midnight.
//
// The contract's state comes from Midnight's public indexer (no wallet, no key) and is
// decoded with the contract's own generated `ledger()`. Only what the chain holds is
// shown: status, tier, chain, bond, the schedule, and per day the attested root, the
// proven uptime, settlement, release and disputes. The wallets, the terms and the pool
// are not on chain, so they are not here.

import "server-only";
import * as rt from "@midnight-ntwrk/compact-runtime";
import { ledger } from "@mmr/contracts/epoch_proof";
import deployment from "../../../../../packages/dapp/deployments/preview.json";

const DAY = 86_400n;
const AFTER_END = 237_600n; // a day's deadline after it ends (settlement, disputes, release)
export const EPOCHS = 30;
const INDEXER = process.env.MIDNIGHT_INDEXER_URL ?? "https://indexer.preview.midnight.network/api/v4/graphql";

export const CONTRACT_ADDRESS: string = (deployment as { contractAddress: string }).contractAddress;
export const NETWORK = "Midnight Preview";

// The contract's Status enum, as shown: "Funded" is the contract's name for an activated
// engagement (bond posted, clock started), not a proven loan, so it reads "Running".
const STATUS = ["Registered", "Running", "Running", "Completed", "Voided", "Defaulted"] as const;
export type EngagementStatus = (typeof STATUS)[number];

/** A struct descriptor from (field, descriptor) pairs, as the compiler emits them. */
function structType<T extends object>(fields: readonly (readonly [keyof T & string, rt.CompactType<unknown>])[]): rt.CompactType<T> {
  return {
    alignment: () => fields.flatMap(([, d]) => d.alignment()),
    toValue: (v: T) => fields.flatMap(([k, d]) => d.toValue((v as Record<string, unknown>)[k])),
    fromValue: () => { throw new Error("unused"); },
  } as unknown as rt.CompactType<T>;
}
const U64 = new rt.CompactTypeUnsignedInteger((1n << 64n) - 1n, 8) as unknown as rt.CompactType<unknown>;
const BYTES32 = new rt.CompactTypeBytes(32) as unknown as rt.CompactType<unknown>;
const EPOCH_REF = structType<{ id: Uint8Array; epoch: bigint }>([["id", BYTES32], ["epoch", U64]]);
const ROOT_REF = structType<{ chain: bigint; day: bigint }>([["chain", U64], ["day", U64]]);
const epochKey = (id: Uint8Array, epoch: bigint) => rt.persistentHash(EPOCH_REF, { id, epoch });
const rootKey = (chain: bigint, day: bigint) => rt.persistentHash(ROOT_REF, { chain, day });

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const iso = (t: bigint) => new Date(Number(t) * 1000).toISOString();
const dayIso = (d: bigint) => iso(d * DAY).slice(0, 10);

export interface DayState {
  epoch: number;
  /** UTC date of the day. */
  date: string;
  ended: boolean;
  /** The day's deadline (end + 66 h): settlement and disputes close, releases open. */
  deadline: string;
  rootPublished: boolean;
  rootHex?: string;
  manifestCid?: string;
  disputed: boolean;
  /** Buckets (of 48) that met the depth target, once proven. */
  uptime?: number;
  settledAt?: string;
  released: boolean;
  /** Released undisputed: the day counts toward a claim. */
  credited: boolean;
}

export interface EngagementState {
  id: string;
  status: EngagementStatus;
  tier: number;
  chain: number;
  bondRequired: string;
  bondPosted?: string;
  /** The client's Midnight coin public key, fixed at registration: paid the bond on default. */
  beneficiary: string;
  registeredAt: string;
  activatedAt?: string;
  startDate?: string;
  fundingProven: boolean;
  releasedEpochs: number;
  releasedTotal: string;
  slashed: boolean;
  days: DayState[];
  readAt: string;
}

async function contractState(): Promise<ReturnType<typeof ledger>> {
  const res = await fetch(INDEXER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: `{ contractAction(address: "${CONTRACT_ADDRESS}") { state } }` }),
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Midnight indexer: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { contractAction?: { state: string } | null } };
  const state = body.data?.contractAction?.state;
  if (!state) throw new Error(`no contract at ${CONTRACT_ADDRESS}`);
  return ledger(rt.ContractState.deserialize(Uint8Array.from(Buffer.from(state, "hex"))).data);
}

/** The engagement's public state, or null when the id is not registered on the contract. */
export async function readEngagement(idHex: string): Promise<EngagementState | null> {
  if (!/^[0-9a-f]{64}$/i.test(idHex)) return null;
  const id = Uint8Array.from(Buffer.from(idHex, "hex"));
  const led = await contractState();
  if (!led.status.member(id)) return null;

  const chain = led.chainOf.lookup(id) as bigint;
  const started = led.startDay.member(id);
  const startDay = started ? (led.startDay.lookup(id) as bigint) : undefined;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const days: DayState[] = [];
  if (startDay !== undefined) {
    for (let e = 1n; e <= BigInt(EPOCHS); e++) {
      const day = startDay + e - 1n;
      const rk = rootKey(chain, day);
      const ek = epochKey(id, e);
      const published = led.publishedRoot.member(rk);
      const disputed = led.disputedRoot.member(rk);
      const released = led.epochReleased.member(ek);
      days.push({
        epoch: Number(e),
        date: dayIso(day),
        ended: now >= (day + 1n) * DAY,
        deadline: iso((day + 1n) * DAY + AFTER_END),
        rootPublished: published,
        ...(published ? {
          rootHex: hex(led.publishedRoot.lookup(rk) as Uint8Array),
          manifestCid: new TextDecoder().decode(led.publishedCid.lookup(rk) as Uint8Array).replace(/\0+$/, ""),
        } : {}),
        disputed,
        ...(led.epochUptime.member(ek) ? { uptime: Number(led.epochUptime.lookup(ek)) } : {}),
        ...(led.settledAt.member(ek) ? { settledAt: iso(led.settledAt.lookup(ek) as bigint) } : {}),
        released,
        credited: released && !disputed && led.settledAt.member(ek),
      });
    }
  }
  return {
    id: idHex.toLowerCase(),
    status: STATUS[Number(led.status.lookup(id))] ?? "Registered",
    tier: Number(led.tier.lookup(id)),
    chain: Number(chain),
    bondRequired: String(led.bondRequired.lookup(id)),
    beneficiary: hex((led.bondBeneficiary.lookup(id) as { bytes: Uint8Array }).bytes),
    ...(led.bondValue.member(id) ? { bondPosted: String(led.bondValue.lookup(id)) } : {}),
    registeredAt: iso(led.registeredAt.lookup(id) as bigint),
    ...(led.activatedAt.member(id) ? { activatedAt: iso(led.activatedAt.lookup(id) as bigint) } : {}),
    ...(startDay !== undefined ? { startDate: dayIso(startDay) } : {}),
    fundingProven: led.fundingProven.member(id),
    releasedEpochs: led.releasedEpochs.member(id) ? Number(led.releasedEpochs.lookup(id)) : 0,
    releasedTotal: led.releasedTotal.member(id) ? String(led.releasedTotal.lookup(id)) : "0",
    slashed: led.slashed.member(id) && Boolean(led.slashed.lookup(id)),
    days,
    readAt: new Date().toISOString(),
  };
}
