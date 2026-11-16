# Built on Midnight

> A one-page map of exactly which Midnight primitives and tooling this project uses
> **in action**. Every row points at real code; nothing here is a mock or a diagram
> of intent.

## The one-line case

This is a thing you **cannot build on a transparent chain**: a market maker proves,
in zero knowledge, that it met per-epoch delivery terms (depth, uptime, custody, no
round-trips) **without revealing its wallets, balances, or order flow**, and earns a
public reputation record that **cannot be linked back to any specific engagement**.
That requires smart contracts with *private state* + ZK + *shielded assets* — i.e.
Midnight. The whole protocol tier is **Compact on Midnight**; Base is only read
(indexed), never written.

## Midnight tech used, and where

| Midnight primitive / tool | How this project uses it | Evidence |
|---|---|---|
| **Compact 0.31.1** (contract language) | The entire protocol lifecycle — `register → activate → proveEpoch → settleEpoch → releaseEpoch / voidUnfunded / defaultEngagement → claim` — is one Compact contract | `packages/contracts/src/epoch_proof.compact` |
| **`witness` + `disclose`** (private state) | Wallet addresses, balances, depth, and flow are private `witness`es that never touch the ledger; only the uptime count, commitments, and nullifier are `disclose()`d | `proveEpoch`, `claim` |
| **`transientHash`** (Poseidon, in-circuit) | Every in-circuit Merkle hash: the depth-16 pool tree, depth-10 root-of-roots, depth-2 depth-band tree, and the depth-20 `HistoricMerkleTree` | `verifyPath16`, `verifyPoolPath`, `verifyBandPath` |
| **`persistentHash` / `persistentCommit`** (SHA-256 ledger hash) | Salted wallet / terms / carry-forward commitments and epoch keys on the ledger | `commitWallets`, `commitTerms`, `CarryTotals` |
| **`HistoricMerkleTree<20, EpochRecord>`** | The private-membership backbone of the claim: `proveEpoch` appends each proven epoch; `claim` proves credit by private Merkle path, so the public profile is **unlinkable** to engagements (I10) | `epochRecords`, `claim` |
| **Zswap shielded tokens** (`ShieldedCoinInfo`, `receiveShielded`, `sendShielded`, `Map.insertCoin`) | The MM's performance bond is a **real shielded USDM coin** escrowed in the contract; release pays the owner in tranches, slash redirects to the client | `postBond`, `payOut`, `releaseEpoch` |
| **Block-time gates** (`blockTimeGte` / `blockTimeLt`) | All funding / settlement / grace windows are enforced against on-chain block time; anchors are ledger-stored and bounded when written (no forgeable caller timestamps) | `activate`, `settleEpoch`, `releaseEpoch` |
| **Identity-point check (I9)** | Authorization is "prove knowledge of a secret," and the Jubjub identity point is explicitly rejected as a key | `assertNotIdentity` |
| **`Counter`, `Map`, `Set` ledger types** | Monotonic public profile counters, commitment maps, and the nullifier set (once-only claims, I10) | `profileNullifiers`, `completedCount`, `kpiHits/kpiTotal` |
| **`@midnight-ntwrk/compact-runtime` 0.16.0** | The known-answer tests **execute the compiled circuit** through Midnight's own runtime — every `transientHash`, `checkRoot`, and `assert` runs for real | `packages/contracts/test/*.kat.test.ts` |
| **`compact` compiler + `zkir` keygen** | Every circuit compiles with `"proof": true` and generates real proving/verifying keys | `contract-info.json`, `build/epoch_proof/keys` |

## Proof it's real, not a skeleton

- **Real ZK keys.** `zkir` keygen produces non-empty proving/verifying keys for every
  circuit — `proveEpoch` at **k=20 (~599.5k rows, 305 MB prover key)**, `claim` k=19
  (~486.7k), plus `register` k=15, `activate` k=10, `postBond` k=14, `releaseEpoch`
  k=15. **All 11 circuits are keyed on the final ledger layout** (`proveEpoch` keygen
  peaks ~9.5 GB RSS).
- **The tests run the compiled circuit, not a model.** ~93 known-answer tests drive
  the actual compiled contract via `@midnight-ntwrk/compact-runtime`: an honest
  witness passes and **every tampered witness reverts** — verified by mutation probes
  (remove an assert → exactly its covering test fails).
- **All ten invariants (I1–I10) are bound in-circuit**, not trusted off-chain:
  address sorting, single-accounting, custody floor, net-sell cap, outflow
  carry-forward, uptime, round-trip cap, settlement, identity-point, once-only claim.

## What makes this a *Midnight* showcase specifically

Three things here are impossible or impractical on a transparent L1, and each uses a
Midnight primitive directly:
1. **Private delivery proofs** — the MM's books stay secret; only a boolean verdict +
   uptime count surface (`witness`/`disclose`).
2. **Unlinkable reputation** — the public record can't be traced to engagements
   (`HistoricMerkleTree` private membership + nullifier).
3. **Shielded performance bonds** — real value escrowed privately (Zswap).

## Honest status (for integrity)

The Midnight/ZK core above is real and verified, and the circuit has **zero open
in-circuit gaps**: I1–I10, the **I8 attester-root registry** (2-of-3, on-chain), and
the **funding-membership** proof are all bound and KAT-covered (**123/123** tests).
All 11 circuits are keyed, the contract is **deployed to Midnight Preview**
(`48e2cfce…2d9eb6`, 11/11 circuits verified on chain), and the full lifecycle
(`register → activate → publishRoot → proveFunding`) has **run live as real on-chain
calls on a real Midnight node** (`specs/LIVE_LOCAL_LIFECYCLE.md`).

The **IPFS tree publisher** is a real Pinata v3 adapter and the **PostgreSQL/Prisma
`DbProfileRepository` (`@mmr/db`)** is real, both behind clean interfaces (they need
only a `PINATA_JWT` / `DATABASE_URL`). What remains is production plumbing, clearly
labelled and outside the contract logic: a **live Base/Ethereum archive-RPC reader**,
**market-maker witness capture**, a live **3-operator attester fleet with
Jubjub-Schnorr signing** (the on-chain threshold itself is already enforced), and a
fee-sponsor. One item is an **external ecosystem issue**: live contract *calls* on
public networks are currently dropped (`NotNormalized`) for a registration-funded
wallet while deploys land — isolated to the wallet's DUST, reproduced as working on a
byte-identical local node, and reported to Midnight
(`specs/CALL_SUBMISSION_BLOCKER.md`).
