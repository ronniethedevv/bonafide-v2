# Built on Midnight

Which Midnight features the `epoch_proof` contract uses, and where. Every row names the code it
refers to in [`packages/contracts/src/epoch_proof.compact`](../packages/contracts/src/epoch_proof.compact).

## Why it needs Midnight

A market maker proves, in zero knowledge, that its liquidity met an engagement's terms each day
(depth, uptime, custody of the client's tokens, capped selling, no self-dealing volume) without
revealing its wallets, balances or order flow. It then earns a public record that cannot be traced
back to any one engagement. That needs private inputs bound to public evidence by a proof, a
shielded bond, and private membership in a public set: contracts with private state, zero-knowledge
circuits and shielded tokens. The whole protocol is one Compact contract on Midnight. Base and
Ethereum are only read, by the indexer; nothing is deployed to them.

## Midnight features used, and where

| Feature | How the contract uses it | Where |
|---|---|---|
| **Compact 0.36.1** (language 0.28.0, ledger 9) | One contract with 12 circuits: `register`, `postBond`, `activate`, `proveFunding`, `proveEpoch`, `settleEpoch`, `releaseEpoch`, `voidUnfunded`, `defaultEngagement`, `claim`, and the attester committee's `publishRoot` and `disputeRoot` | `epoch_proof.compact` |
| **`witness` and `disclose`** | Wallet addresses, per-wallet depth and flow, the terms and their salts, the carried totals and the engagement secret are witnesses. Only commitments, the day's uptime count, keys and the claim's nullifier are disclosed | `committedWallets`, `terms`, `bidMin`/`askMin`, `flowBuy`/`flowSell`, `engagementSecret` |
| **`transientHash`** (in-circuit hash) | Every in-circuit Merkle step: a wallet's path in the pool tree (depth 16), the pool's path to the day's root of roots (depth 10), and the depth-band tree (depth 2) | `verifyPath16`, `verifyPoolPath`, `verifyBandPath` |
| **`persistentCommit` and `persistentHash`** | Salted commitments to the wallet set, the terms (the pool included) and the totals carried from day to day; ledger keys for engagements, days and attested roots; the engagement id and the claim's nullifier | `proveEpoch`, `register`, `deriveEngagementId`, `rootKey`, `nullifier` |
| **`HistoricMerkleTree<20, EpochRecord>`** | `proveEpoch` adds each proven day to `epochRecords`; `settleEpoch` checks membership there. `releaseEpoch` adds each settled, undisputed day to `creditedRecords`, and `claim` proves its days by private Merkle paths, so the public profile entry does not say which engagement it came from | `epochRecords`, `creditedRecords`, `claim` |
| **Shielded tokens** (`receiveShielded`, `sendShielded`, `insertCoin`) | The bond is a shielded coin held by the contract. Each released day pays its share to the market maker; a default pays the rest to the client's Midnight key. On Preview the bond is a shielded test token, deployed with the contract | `postBond`, `payOut`, `releaseEpoch`, `defaultEngagement` |
| **`ownPublicKey` and `ZswapCoinPublicKey`** | The bond's owner is recorded when it is posted; the client's key is fixed at registration as the beneficiary | `bondOwner`, `bondBeneficiary` |
| **Block-time checks** (`blockTimeGte`, `blockTimeLt`) | The funding window, settlement after a day ends, the deadline 66 hours later (disputes close, releases open), defaults and voids are all checked against block time; no caller supplies a timestamp | `activate`, `settleEpoch`, `releaseEpoch`, `disputeRoot`, `dayDeadline` |
| **`Counter`, `Map` and `Set`** | Attester votes and dispute counts, attested roots, the nullifier set (an engagement is claimed once), and public counters per profile and tier | `rootVoteCount`, `disputeCount`, `publishedRoot`, `profileNullifiers`, `completedCount`, `kpiHits`, `kpiTotal` |
| **`@midnight-ntwrk/compact-runtime` 0.21.0** | The contract's 147 tests run the compiled circuits through Midnight's runtime: every hash, path check and assert executes | `packages/contracts/test/*.kat.test.ts` |
| **Midnight.js 5.0.1, wallet SDK 2.0.1, proof server 9.0.0** | Deployment, DUST registration, every on-chain call, and the scheduled lifecycle | `packages/dapp` |
| **Midnight's public indexer** | `check-deployment` and the live engagement page read and decode the contract's state with the contract's generated `ledger()`, with no wallet | `packages/dapp/src/check-deployment.ts`, `apps/web/src/lib/chain/engagement.ts` |

## What is checked, and how we know

- **The circuits.** The 147 tests give each circuit an honest witness, which must pass, and
  tampered witnesses, which must fail on the assert that guards them. The rules the circuits
  enforce, I1 to I10, are stated in
  [`packages/contracts/INVARIANTS.md`](../packages/contracts/INVARIANTS.md) with the circuit that
  enforces each. CI compiles the contract with a checksum-pinned compiler and runs every test.
- **The keys.** `compact:build` produces proving and verifying keys for all 12 circuits; the largest
  proving keys are `proveEpoch` and `claim` (344 MiB each) and `proveFunding` (86 MiB).
- **The deployment.** `epoch_proof` is on Preview at
  `4ff2c93db78baabc96e66b58eb4890f2ab2d7a7fc3f8930b6a89395de7f9a634` with all 12 verifier keys: 7
  in the deploy transaction and 5 added by maintenance transactions, because one transaction may
  write about 65% of a block. `pnpm --filter @mmr/dapp check-deployment` compares each on-chain key
  with a local build; all 12 match.
- **On chain.** A live engagement on Base data is registered, bonded and activated on this
  deployment, and a scheduled job carries it day by day
  ([`preview-lifecycle.json`](../packages/dapp/deployments/preview-lifecycle.json)). On an earlier
  deployment, a sample engagement ran 16 transactions covering registration, bond, activation,
  attester votes, funding, three daily proofs and two settlements
  ([`preview-v1-lifecycle.json`](../packages/dapp/deployments/preview-v1-lifecycle.json)).

## Limits

- In this demo one operator holds the three attester keys, derived from one seed; in production
  each attester is a separate party. The two-of-three threshold is enforced by the contract either
  way.
- The market maker pays its own DUST; there is no fee sponsor yet.
- `voidUnfunded` returned the second engagement's bond on chain on 26 November (block 281,418), and
  `releaseEpoch` released day 1's share of the live engagement's bond on 27 November (block
  298,875). `defaultEngagement`, `disputeRoot` and `claim` have run in the tests but not yet on
  chain: the first two run only when something goes wrong, and a claim needs all 30 days.
