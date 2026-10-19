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
specs/           Spec-driven context repository (product + method) + RUNNING.md
packages/
  merkle/        Leaf schema, indexed Merkle tree (depth 16), epoch root-of-roots  [TS, tested]
  indexer/       Deterministic Base indexer pipeline (TWAP, commitments, epoch build) [TS, tested]
  prover/        Engagement model, witness assembly, I1-I8 reference oracle, demo CLI [TS, tested]
  protocol/      Settlement state machine + mock attester committee                 [TS, tested]
  watcher/       Challenge watchdog (root recomputation) + client verdict log       [TS, tested]
  contracts/     Compact 0.31.x circuits/contracts for Midnight (I1-I10)            [skeletons]
apps/
  web/           Public reputation profile + tear sheet (+ depth/uptime chart)      [TS, builds]
```

## Status (v1)

| Build-order item | State |
|------------------|-------|
| 1. Deterministic indexer, leaf schema, root-of-roots → IPFS | **done + tested** |
| 2. Proving benchmark (16-slot epoch circuit) | TS reference oracle done; Compact benchmark needs the Midnight toolchain |
| 3. Compact contracts (registration, bond escrow, state machine) | skeletons (needs `compactc`); TS settlement state machine done |
| 4. Epoch proof circuit I1–I8; claim/nullifier | skeletons (needs `compactc`); TS I1–I8 oracle done |
| 5. Attester committee, challenge flow, void rules | **TS done + tested** (mock committee; Jubjub signing deferred) |
| 6. MM prover CLI, client watcher | **done + tested** (fee-sponsor pending) |
| 7. Pilot | planned |

**88 tests passing; `pnpm -r typecheck` clean; `next build` passes.** See
[`specs/RUNNING.md`](./specs/RUNNING.md) to run it locally.

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
