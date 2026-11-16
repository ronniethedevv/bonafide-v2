// Live wiring: capture a witness from real chain data.
//
// The archive-RPC reader (@mmr/indexer ChainProvider) produces per-address activity for
// a pool over an epoch — the PUBLIC index. The MM turns that into their PRIVATE witness
// by filtering it to their own committed wallets and running the capture. Nobody else
// can do this filtering: which addresses are the MM's lives only in the committed
// Engagement (the chain sees a commitment, never the wallet set).
//
// This is the production replacement for the synthetic `activities` map in the demo:
// the only new input is a live ChainProvider + the pool descriptor.

import type {
  AddressActivity,
  ActivityParams,
  ChainProvider,
  EpochRange,
  IndexerConfig,
  PoolDescriptor,
} from "@mmr/indexer";
import type { Hasher } from "@mmr/merkle";
import type { Engagement } from "@mmr/prover";
import { captureEpochWitness, type CarryState, type EpochWitness } from "./epoch-witness.js";
import { captureAndStore, type WitnessStore } from "./store.js";

/** The committed wallet set of an engagement, as a lookup. */
export function committedWallets(engagement: Engagement): Set<bigint> {
  const mine = new Set<bigint>();
  for (let i = 0; i < engagement.wallets.activeCount; i++) mine.add(engagement.wallets.slots[i]!);
  return mine;
}

/** Keep only the activity rows belonging to the engagement's committed wallets. */
export function filterToWallets(
  engagement: Engagement,
  activities: readonly AddressActivity[],
): Map<bigint, AddressActivity> {
  const mine = committedWallets(engagement);
  const out = new Map<bigint, AddressActivity>();
  for (const a of activities) if (mine.has(a.addr)) out.set(a.addr, a);
  return out;
}

/** ActivityParams derived from the committed indexer config. */
export function activityParams(config: IndexerConfig): ActivityParams {
  return {
    bucketSeconds: config.bucketSeconds,
    bandsBps: config.bandsBps,
    treasuryAddresses: config.treasuryAddresses,
  };
}

export interface LiveCaptureArgs {
  readonly provider: ChainProvider;
  readonly hasher: Hasher;
  readonly engagement: Engagement;
  /** The engagement's pool, as discovered (poolsAboveFloor) or read directly. */
  readonly pool: PoolDescriptor;
  readonly config: IndexerConfig;
  readonly range: EpochRange;
  readonly settled: boolean;
  readonly newSalt: Uint8Array;
  readonly capturedAt?: string;
}

/** Pull the epoch's activity from the provider, filter to the MM's wallets, and capture. */
export async function captureLiveEpoch(
  args: LiveCaptureArgs & { readonly prevCarry: CarryState },
): Promise<EpochWitness> {
  if (args.pool.poolAddr !== args.engagement.poolAddr) {
    throw new Error(
      `pool ${"0x" + args.pool.poolAddr.toString(16)} does not match the engagement's pool ` +
        `${"0x" + args.engagement.poolAddr.toString(16)}`,
    );
  }
  const activities = await args.provider.poolActivity(args.pool, args.range, activityParams(args.config));
  const mine = filterToWallets(args.engagement, activities);
  return captureEpochWitness({
    hasher: args.hasher,
    engagement: args.engagement,
    activities: mine,
    config: args.config,
    range: args.range,
    settled: args.settled,
    prevCarry: args.prevCarry,
    newSalt: args.newSalt,
    ...(args.capturedAt === undefined ? {} : { capturedAt: args.capturedAt }),
  });
}

/**
 * Capture a live epoch straight into the store, chaining the carry-forward from the
 * previously stored epoch (or genesis for epoch 1). The production entry point: one
 * call per epoch as the contract runs.
 */
export async function captureLiveEpochToStore(
  store: WitnessStore,
  args: LiveCaptureArgs & { readonly genesisSalt: Uint8Array },
): Promise<EpochWitness> {
  if (args.pool.poolAddr !== args.engagement.poolAddr) {
    throw new Error(
      `pool ${"0x" + args.pool.poolAddr.toString(16)} does not match the engagement's pool ` +
        `${"0x" + args.engagement.poolAddr.toString(16)}`,
    );
  }
  const activities = await args.provider.poolActivity(args.pool, args.range, activityParams(args.config));
  const mine = filterToWallets(args.engagement, activities);
  return captureAndStore(store, {
    hasher: args.hasher,
    engagement: args.engagement,
    activities: mine,
    config: args.config,
    range: args.range,
    settled: args.settled,
    newSalt: args.newSalt,
    genesisSalt: args.genesisSalt,
    ...(args.capturedAt === undefined ? {} : { capturedAt: args.capturedAt }),
  });
}
