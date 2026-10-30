// @mmr/dapp — public surface.
export { loadConfig, type DappConfig } from "./config.js";
export { attesterId, buildCommittee, generateAttesterSecrets } from "./committee.js";
export {
  PRIVATE_STATE_ID, compiledEpochProof, emptyPrivateState, witnesses,
  type EpochProofCircuitId, type EpochProofPrivateState,
} from "./contract.js";
export { buildProviders, type MmrProviders } from "./providers.js";
export { buildHeadlessWallet, type HeadlessWallet } from "./wallet.js";
