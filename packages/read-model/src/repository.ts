// The data-access boundary the API depends on. The fixture implementation backs
// development today; a DB-backed implementation (PostgreSQL/Prisma per the
// architecture) slots in behind the same interface without touching the API.

import type { MmProfile } from "./read-model.js";
import { getProfile, listProfiles } from "./fixtures.js";

export interface ProfileRepository {
  list(): Promise<MmProfile[]>;
  get(handle: string): Promise<MmProfile | undefined>;
}

export class FixtureProfileRepository implements ProfileRepository {
  async list(): Promise<MmProfile[]> {
    return listProfiles();
  }
  async get(handle: string): Promise<MmProfile | undefined> {
    return getProfile(handle);
  }
}
