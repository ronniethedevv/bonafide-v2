// @mmr/dapp — the market maker's private engagement, kept as a sealed engagement file.
//
// The opening (wallets, terms, salts, the engagement secret) never appears in the clear
// in the repository: it is sealed with AES-GCM under a passphrase derived from
// DEPLOY_SEED (@mmr/engagement-file, the same format the web app's wizard saves), and
// the scheduled job opens it with the seed. The record's public part holds only what the
// chain shows anyway (chain, tier, bond) plus the pool, which this demo names openly.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  type EngagementFile, type EngagementOpening, type Terms,
  hexToBytes, newOpening, openFile, sealFile, termsFromJson,
} from "@mmr/engagement-file";
import type { TermsW } from "@mmr/contracts/harness";
import { parseAddr } from "@mmr/merkle";
import { deriveSecret } from "./committee.js";
import type { EngagementPrivate } from "./real-witness.js";

export interface EngagementRecord {
  network: string;
  contractAddress: string;
  /** Labels the secrets derived from the seed (carry salts) and the file passphrase. */
  label: string;
  chain: number;
  tier: number;
  bond: number;
  pool: { address: string; pair: string };
  createdAt: string;
  file: EngagementFile;
}

export interface OpenedEngagement {
  record: EngagementRecord;
  opening: EngagementOpening;
  priv: EngagementPrivate;
  engagementSecret: Uint8Array;
}

const passphrase = (seed: Uint8Array, label: string) => Buffer.from(deriveSecret(seed, `engagement-file:${label}`)).toString("hex");

export function toTermsW(t: Terms): TermsW {
  return {
    floor_price_P: t.floorPriceP, loan_L0: t.loanL0, quote_start_Q0: t.quoteStartQ0,
    disposal_D: t.disposalD, net_sell_S: t.netSellS, depth_target: t.depthTarget,
    roundtrip_share_ppm: t.roundtripSharePpm, band_bps: BigInt(t.bandBps),
    min_uptime_buckets: BigInt(t.minUptimeBuckets), epochs_total: BigInt(t.epochsTotal),
    pool: t.pool,
  };
}

/** Create and seal a new engagement; fresh random secrets, real commitments. */
export async function createEngagement(
  seed: Uint8Array,
  input: Omit<EngagementRecord, "createdAt" | "file"> & { wallets: string[]; terms: Terms; client: string },
): Promise<EngagementRecord> {
  const opening = await newOpening({
    pool: { chain: String(input.chain), address: input.pool.address.toLowerCase(), pair: input.pool.pair },
    client: { name: input.client },
    label: input.label,
    wallets: input.wallets,
    terms: input.terms,
    human: {},
  });
  const file = await sealFile(opening, passphrase(seed, input.label));
  return {
    network: input.network, contractAddress: input.contractAddress, label: input.label,
    chain: input.chain, tier: input.tier, bond: input.bond, pool: input.pool,
    createdAt: opening.createdAt, file,
  };
}

export function readEngagementRecord(path: string): EngagementRecord | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as EngagementRecord) : undefined;
}

export function writeEngagementRecord(path: string, r: EngagementRecord): void {
  writeFileSync(path, `${JSON.stringify(r, null, 2)}\n`);
}

/** Open the sealed file with the seed; checks the commitments it carries. */
export async function openEngagement(seed: Uint8Array, record: EngagementRecord): Promise<OpenedEngagement> {
  const opening = await openFile(record.file, passphrase(seed, record.label));
  return { record, opening, ...privateInputs(opening) };
}

/** The engagement secret and the circuits' private inputs, from an opened engagement file. */
export function privateInputs(opening: EngagementOpening): { engagementSecret: Uint8Array; priv: EngagementPrivate } {
  return {
    engagementSecret: hexToBytes(opening.secrets.engagementSecret, 32),
    priv: {
      poolAddr: parseAddr(opening.pool.address),
      wallets: opening.wallets.map(parseAddr),
      walletSalt: hexToBytes(opening.secrets.walletSalt, 32),
      terms: toTermsW(termsFromJson(opening.terms)),
      termsSalt: hexToBytes(opening.secrets.termsSalt, 32),
    },
  };
}
