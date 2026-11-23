// Data access for the sample profiles in server components: the bundled read-model
// fixtures (illustrative firms and records). Live engagements are read from the contract
// itself (lib/chain).

import {
  getProfile as fixtureGetProfile,
  listProfiles as fixtureListProfiles,
  totalCompleted,
  type MmProfile,
} from "@mmr/read-model";

/**
 * Profiles that come from the bundled sample fixtures (illustrative firms and records),
 * as opposed to records from real completed engagements. Every listed profile is a
 * sample until real engagements are claimed.
 */
const SAMPLE_HANDLES = new Set(fixtureListProfiles().map((p) => p.handle));
export function isSampleProfile(handle: string): boolean {
  return SAMPLE_HANDLES.has(handle);
}

export interface ProfileSummary {
  handle: string;
  displayName: string;
  headlineUptime: number;
  completed: number;
}

export async function fetchProfiles(): Promise<ProfileSummary[]> {
  return fixtureListProfiles().map((p) => ({
    handle: p.handle,
    displayName: p.displayName,
    headlineUptime: p.headlineUptime,
    completed: totalCompleted(p),
  }));
}

export async function fetchProfile(handle: string): Promise<MmProfile | undefined> {
  return fixtureGetProfile(handle);
}
