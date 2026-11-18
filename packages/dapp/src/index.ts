// @mmr/dapp — public surface.
export { loadConfig, type DappConfig } from "./config.js";
export { attesterId, buildCommittee, deriveAttesterSecrets } from "./committee.js";
export {
  BOND_TOKEN_DOMAIN, PRIVATE_STATE_ID, compiledEpochProof, compiledTestBondToken, emptyPrivateState, witnesses,
  type EpochProofCircuitId, type EpochProofPrivateState,
} from "./contract.js";
export { buildProviders, type MmrProviders } from "./providers.js";
export { buildHeadlessWallet, type HeadlessWallet } from "./wallet.js";
