// The live demonstration on Midnight Preview: the engagement the scheduled job carries (from
// its committed record) and its market maker's public profile id (`mm profile`).

import lifecycle from "../../../../../packages/dapp/deployments/preview-lifecycle.json";

export const LIVE_ENGAGEMENT_ID: string = (lifecycle as { engagementId: string }).engagementId;
export const LIVE_PROFILE_ID = "609d764be4887f7618334da0365ad5814d1e581a851bd5ef1430d9ee051e566c";
