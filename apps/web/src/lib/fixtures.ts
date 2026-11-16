// Re-export the shared fixtures so web pages keep importing from "@/lib/fixtures".
// These back the UI until the API is wired in (see apps/api).
export { getProfile, listProfiles } from "@mmr/read-model";
