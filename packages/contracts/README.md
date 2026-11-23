# @mmr/contracts — Compact circuits & contracts (Midnight)

> **Status: compiled and tested.** The contract builds with Compact toolchain **0.36.1**
> (language 0.28.0, runtime 0.21.0) for Midnight **ledger 9**. CI installs the pinned
> compiler, compiles the contract and runs all **135** known-answer tests against the
> compiled circuits; a missing build fails the run instead of skipping it.

## Target

- **Compact 0.36.1 on ledger 9** (every Midnight network since 6–9 Nov 2026). Ledger 9's
  `secp256k1` / ECDSA would allow in-circuit wallet-ownership proofs; that is noted for
  later, not built.
- Attesters authenticate by proving knowledge of their secret (DD-26): `publishRoot`
  and `disputeRoot` count distinct committee members, 2 of 3. Merkle trees (slot
  leaves, pool leaves, nodes) hash with Compact's `transientHash` (Poseidon; digests are
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
revert. Run `pnpm kat:build && pnpm test` (needs the `compact` toolchain; CI sets
`KAT_REQUIRE_BUILD=1` so a missing build fails). The suite spans 8 files: the epoch
proof, I8 publication, funding, anchors and time, bond custody, tranches, and the DD-35
rules (roots by chain and day, registration terms, disputes). It executes the circuit
logic; it does not generate a ZK proof (that needs a proof server).

## Files

| File | Build-order item | Purpose |
|------|------------------|---------|
| `src/epoch_proof.compact` | #4 | Epoch proof circuit enforcing I1–I8 against the root-of-roots. |
| `src/epoch_proof.compact` `register` / `activate` | #3 | Secret-based registration with public tier, chain, required bond and beneficiary (DD-35); wallet-vector + terms commitments; owner-only, bond-first activation that records the start day. Recorded timestamps are checked against block time (H3, H3b). |
| `src/epoch_proof.compact` `postBond` / `settleEpoch` / `releaseEpoch` / `voidUnfunded` / `defaultEngagement` | #3 | Shielded bond escrow in the deploy-time bond token + engagement state machine. Every window gate reads its anchor (`registeredAt`, `startDay`, `settledAt`) from the ledger (H3b, DD-35). |
| `src/epoch_proof.compact` `publishRoot` / `disputeRoot` | I8 | Committee publication of each (chain, day) root at 2 of 3, and a 2-of-3 dispute that blocks settle, release and default on that root (DD-26, DD-35). |
| `src/epoch_proof.compact` `claim` | #4 | Nullifier claim circuit (I10): add a finished engagement to the public record exactly once, crediting only epochs proven on-ledger (H4). |

Everything is one contract (DD-15, DD-17): it was designed when Compact rejected
cross-contract calls (ledger 9 adds them), so each circuit reads only this contract's ledger. `claim` reads
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

## How to build

```sh
compact update 0.36.1                       # or download the pinned release, as CI does
pnpm --filter @mmr/contracts kat:build      # compact compile --skip-zk → build/epoch_proof
pnpm --filter @mmr/contracts test           # 147 tests on the compiled circuits
compact compile src/epoch_proof.compact dist/epoch_proof   # with proving keys (slow)
```
