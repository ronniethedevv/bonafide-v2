// Data access for server components. When API_URL is set, fetch from the backend;
// otherwise fall back to the bundled fixtures so the app still builds and runs
// offline. Same return shapes either way (the API serves the shared read model).

import {
  getProfile as fixtureGetProfile,
  listProfiles as fixtureListProfiles,
  totalCompleted,
  type MmProfile,
} from "@mmr/read-model";

const API_URL = process.env.API_URL;

export interface ProfileSummary {
  handle: string;
  displayName: string;
  headlineUptime: number;
  completed: number;
}

export async function fetchProfiles(): Promise<ProfileSummary[]> {
  if (API_URL) {
    const res = await fetch(`${API_URL}/api/mm`, { cache: "no-store" });
    if (!res.ok) throw new Error(`API /api/mm ${res.status}`);
    return (await res.json()) as ProfileSummary[];
  }
  return fixtureListProfiles().map((p) => ({
    handle: p.handle,
    displayName: p.displayName,
    headlineUptime: p.headlineUptime,
    completed: totalCompleted(p),
  }));
}

export async function fetchProfile(handle: string): Promise<MmProfile | undefined> {
  if (API_URL) {
    const res = await fetch(`${API_URL}/api/mm/${encodeURIComponent(handle)}`, {
      cache: "no-store",
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`API /api/mm/${handle} ${res.status}`);
    return (await res.json()) as MmProfile;
  }
  return fixtureGetProfile(handle);
}
