// A market maker's public record on Midnight: the per-tier counters its claims add to.
//
// A claim proves, from the credited days of one finished engagement, how many of its 30
// days met the terms, and adds them to counters keyed by the market maker's profile id and
// the tier. The profile id (the hash of a secret only the market maker holds) is what it
// shares to point a counterparty here; nothing on chain links a profile to its engagements.

import "server-only";
import * as rt from "@midnight-ntwrk/compact-runtime";
import { contractState } from "./engagement";

export interface TierRecord {
  tier: number;
  name: string;
  /** Engagements claimed under this tier. */
  engagements: number;
  /** Days that met the terms, of daysTotal (30 per claimed engagement). */
  daysMet: number;
  daysTotal: number;
}

export interface ProfileRecord {
  profileId: string;
  tiers: TierRecord[];
  /** Claims on the whole contract, by any market maker. */
  claimsOnContract: number;
  readAt: string;
}

const PROFILE_TIER = {
  alignment: () => [...new rt.CompactTypeBytes(32).alignment(), ...new rt.CompactTypeUnsignedInteger(255n, 1).alignment()],
  toValue: (v: { profile: Uint8Array; tier: bigint }) => [
    ...new rt.CompactTypeBytes(32).toValue(v.profile),
    ...new rt.CompactTypeUnsignedInteger(255n, 1).toValue(v.tier),
  ],
  fromValue: () => {
    throw new Error("unused");
  },
} as unknown as rt.CompactType<{ profile: Uint8Array; tier: bigint }>;

/** The contract's per-tier counter key: persistentHash(ProfileTier { profile, tier }). */
export const profileTierKey = (profile: Uint8Array, tier: bigint): Uint8Array => rt.persistentHash(PROFILE_TIER, { profile, tier });

const NAMES = ["", "A", "B", "C"];

/** The record of a profile id (64 hex characters), or null for a malformed id. */
export async function readProfileRecord(profileIdHex: string): Promise<ProfileRecord | null> {
  const idHex = profileIdHex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(idHex)) return null;
  const profile = Uint8Array.from(Buffer.from(idHex, "hex"));
  const led = await contractState();
  const count = (m: { member(k: Uint8Array): boolean; lookup(k: Uint8Array): { read(): bigint } }, k: Uint8Array) =>
    (m.member(k) ? Number(m.lookup(k).read()) : 0);
  const tiers = [1, 2, 3].map((tier): TierRecord => {
    const k = profileTierKey(profile, BigInt(tier));
    return { tier, name: NAMES[tier]!, engagements: count(led.completedCount, k), daysMet: count(led.kpiHits, k), daysTotal: count(led.kpiTotal, k) };
  });
  return { profileId: idHex, tiers, claimsOnContract: Number(led.profileNullifiers.size()), readAt: new Date().toISOString() };
}
