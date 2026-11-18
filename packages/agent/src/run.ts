// The agent's daily step for one engagement and one epoch:
//   fetch public activity → keep the MM's committed wallets → capture the witness
//   → report "captured" → seal the client's figures → post them.
// Safe to re-run: a stored witness is reused, phases only move forward, and the server
// refuses a second figures envelope for the same epoch.

import { randomBytes } from "node:crypto";
import { contexts, openFile, seal, type EngagementFile, type EngagementOpening } from "@mmr/engagement-file";
import { DEFAULT_CONFIG } from "@mmr/indexer";
import { CompactHasher } from "@mmr/merkle";
import { FsWitnessStore, captureAndStore, filterToWallets, type EpochWitness } from "@mmr/witness";
import type { AgentApi, ServerEngagement } from "./api.js";
import { genesisCarrySalt, matchesServer, proverEngagement } from "./engagement.js";
import { figuresFromWitness } from "./figures.js";
import type { AgentHome } from "./home.js";
import type { ActivitySource } from "./sources.js";

export interface RunEpochArgs {
  api: AgentApi;
  home: AgentHome;
  registrationId: string;
  epoch: number;
  source: ActivitySource;
  passphrase: string;
  /** Whether the epoch has settled (attested + challenge window passed). Default false. */
  settled?: boolean;
}

export interface RunEpochResult {
  epoch: number;
  /** The witness already existed and was reused. */
  reused: boolean;
  phaseChanged: boolean;
  figuresPosted: boolean;
  met: boolean;
  bucketsAtTarget: number;
}

export async function loadEngagement(
  api: AgentApi,
  home: AgentHome,
  registrationId: string,
  passphrase: string,
): Promise<{ reg: ServerEngagement; opening: EngagementOpening; file: EngagementFile }> {
  const reg = (await api.engagements()).find((e) => e.id === registrationId);
  if (!reg) throw new Error(`engagement ${registrationId} isn't one of this market maker's engagements`);
  const file = home.readEngagementFile(registrationId);
  const opening = await openFile(file, passphrase);
  if (!matchesServer(opening, reg)) throw new Error(`the engagement file doesn't match ${registrationId}'s commitments on record`);
  return { reg, opening, file };
}

export async function runEpoch(a: RunEpochArgs): Promise<RunEpochResult> {
  if (!Number.isInteger(a.epoch) || a.epoch < 1 || a.epoch > 90) throw new Error("epoch must be 1 to 90");
  const { reg, opening } = await loadEngagement(a.api, a.home, a.registrationId, a.passphrase);
  if (!["accepted", "active"].includes(reg.status)) throw new Error(`${reg.id} is ${reg.status}: the client must accept it first`);
  if (!reg.clientInboxKey) throw new Error(`${reg.clientName} hasn't set up a private inbox, so their figures can't be sealed yet`);

  const engagement = proverEngagement(opening, reg.id);
  if (a.epoch > engagement.terms.epochsTotal) throw new Error(`the contract has ${engagement.terms.epochsTotal} epochs`);
  const store = new FsWitnessStore(a.home.witnessDir);
  let w: EpochWitness | undefined = store.get(reg.id, a.epoch);
  const reused = w !== undefined;
  if (!w) {
    const act = await a.source.activity(a.epoch);
    if (act.pool.toLowerCase() !== opening.pool.address.toLowerCase()) {
      throw new Error(`activity is for pool ${act.pool}, but the engagement is on ${opening.pool.address}`);
    }
    w = captureAndStore(store, {
      hasher: new CompactHasher(),
      engagement,
      activities: filterToWallets(engagement, act.activities),
      config: DEFAULT_CONFIG,
      range: { ...act.range, epoch: a.epoch },
      settled: a.settled ?? false,
      newSalt: new Uint8Array(randomBytes(32)),
      genesisSalt: genesisCarrySalt(opening),
    });
  }

  const phaseChanged = await a.api.reportPhase(reg.id, a.epoch, "captured");
  const figures = figuresFromWitness(w);
  const envelope = await seal(JSON.stringify(figures), reg.clientInboxKey, contexts.epoch(reg.id, a.epoch));
  const figuresPosted = await a.api.postFigures(reg.id, a.epoch, envelope);
  return { epoch: a.epoch, reused, phaseChanged, figuresPosted, met: figures.met, bucketsAtTarget: figures.bucketsAtTarget };
}
