# mm-reputation

Privacy-preserving **reputation record for crypto market makers**. Market makers
prove per-engagement, per-epoch delivery (depth, uptime, utilization, custody, no
round-trips) with **zero-knowledge proofs on Midnight**, verified against a
**deterministic Base indexer** — without handing anyone their books. Finished
engagements roll into a public record nobody can edit or cherry-pick.

> Built spec-first. Read [`AGENTS.md`](./AGENTS.md) and the
> [`specs/`](./specs) context repository before touching code.

## Layout

```
specs/           Spec-driven context repository (product + method)
packages/
  merkle/        Leaf schema, indexed Merkle tree (depth 16), epoch root-of-roots  [TS, tested]
  indexer/       Deterministic Base indexer pipeline (TWAP, commitments, epoch build) [TS, tested]
  contracts/     Compact 0.31.x circuits/contracts for Midnight (I1-I10)            [skeletons]
apps/
  web/           Public reputation profile, tear sheet, MM dashboard                [planned]
```

## Status (v1, build-order item #1 landed)

| Build-order item | State |
|------------------|-------|
| 1. Deterministic indexer, leaf schema, root-of-roots → IPFS | **core done + tested** |
| 2. Proving benchmark (16-slot epoch circuit) | next |
| 3. Compact contracts (registration, bond escrow, state machine) | skeletons |
| 4. Epoch proof circuit I1–I8; claim/nullifier | skeletons |
| 5. Attester committee, challenge flow, void rules | interfaces |
| 6. MM prover CLI, client watcher, fee-sponsor | planned |
| 7. Pilot | planned |

See [`specs/progress_tracker.md`](./specs/progress_tracker.md) for the live ledger.

## Develop

```sh
pnpm install
pnpm -r typecheck
pnpm -r test
```

Requires Node ≥ 22 and pnpm. The Compact circuits in `packages/contracts` need
the Midnight toolchain + a Blockfrost token and are not compiled by this
workspace — see [`packages/contracts/README.md`](./packages/contracts/README.md).
