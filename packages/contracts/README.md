# @mmr/contracts — Compact circuits & contracts (Midnight)

> **Status: reviewed source skeletons, NOT compiled here.** The Midnight Compact
> toolchain (`compactc`), a running Midnight node, and a **Blockfrost project
> token** (required for Preprod/Mainnet RPC + indexer as of the Sep 2026 network
> update) are not available in this build environment. These `.compact` files
> encode the protocol's state machine and invariants for review and for later
> compilation on a properly provisioned machine. Treat them as a specification
> in code form until `compactc` has type-checked and proven them.

## Target

- **Compact 0.31.x on ledger 8** (ledger 9's `secp256k1` + in-circuit wallet
  ownership is deferred — see the product spec "Later" column).
- Jubjub Schnorr for attester signatures. Merkle trees (slot leaves, pool
  leaves, nodes) hash with Compact's `transientHash` (Poseidon; digests are
  `Field`); `@mmr/merkle/poseidon`'s `PoseidonHasher` reproduces it exactly via
  compact-runtime. The public `rootOfRoots` stays `Bytes<32>` (the Field root's
  little-endian image). Commitments that are ledger state keep `persistentHash`
  / `persistentCommit` (SHA-256), reproduced by `CompactHasher`
  (see `specs/progress_tracker.md` DD-8).

## Known-answer test

`test/epoch_proof.kat.test.ts` builds a pool tree + root-of-roots with
`@mmr/merkle`, feeds the openings to the compiled `proveEpoch`, and executes it
via `@midnight-ntwrk/compact-runtime` (all in-circuit hashes and asserts run).
It passes only if the TS and circuit roots agree, and every tamper case must
revert. Run `pnpm kat:build && pnpm test` (needs the `compact` toolchain; the
suite skips when `build/` is absent). It executes the circuit logic; it does
not generate a ZK proof (that needs a proof server).

## Files

| File | Build-order item | Purpose |
|------|------------------|---------|
| `src/epoch_proof.compact` | #4 | Epoch proof circuit enforcing I1–I8 against the root-of-roots. |
| `src/epoch_proof.compact` `register` / `activate` | #3 | Secret-based registration, identity-point check (I9), wallet-vector + terms commitments, funding activation. Recorded timestamps are checked against block time (H3, H3b). |
| `src/epoch_proof.compact` `postBond` / `settleEpoch` / `releaseEpoch` / `voidUnfunded` / `defaultEngagement` | #3 | Shielded USDM bond escrow + engagement state machine. Every window gate reads its anchor (`registeredAt`, `activatedAt`, `settledAt`) from the ledger (H3b). |
| `src/epoch_proof.compact` `claim` | #4 | Nullifier claim circuit (I10): add a finished engagement to the public record exactly once, crediting only epochs proven on-ledger (H4). |

Everything is one contract (DD-15, DD-17): Compact 0.31.1 rejects cross-contract
calls, so a circuit can only read the ledger of the contract it is in. `claim` reads
`epochRecords` privately; the bond gates read the registration and settlement
anchors.

## Invariant map

See [`INVARIANTS.md`](./INVARIANTS.md) for the precise, language-agnostic
statement of I1–I10 and which circuit each one lives in. That document is the
source of truth the `.compact` code must satisfy.

## The `disclose()` discipline

Every value that crosses from private witness to public ledger output must pass
through an explicit `disclose(...)`. Reviewers should be able to grep for
`disclose(` and confirm that **only** the intended public facts (counters, the
epoch verdict, the nullifier) are disclosed — never wallets, salts, terms, KPI
targets, or client identity.

## How to build once provisioned

```sh
# on a machine with the Midnight toolchain installed
export MIDNIGHT_BLOCKFROST_TOKEN=...          # never commit this
compactc compile src/epoch_proof.compact --out build/
# run the prover benchmark (build-order item #2) before fixing bucket sizes
```
