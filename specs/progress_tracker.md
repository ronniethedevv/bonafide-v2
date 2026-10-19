# progress_tracker.md

A live ledger of phases, tasks, and immutable design decisions. Update at the end
of every working unit.

## Current phase

**Phase 0 → Phase 1:** foundations + build-order item #1 (deterministic indexer,
leaf schema, root-of-roots).

## Status log

| Date | Unit | Status |
|------|------|--------|
| 2026-10-18 | Context repository (AGENTS + 6 specs) | done |
| 2026-10-18 | Monorepo scaffold (pnpm workspace, root tsconfig, vitest) | done |
| 2026-10-18 | `packages/merkle` — leaf schema + indexed Merkle tree + root-of-roots + tests | **done (24 tests)** |
| 2026-10-18 | `packages/indexer` — deterministic pipeline (config, provider ifaces, TWAP, depth/flow commitments, anti-JIT leaves, epoch build, in-mem publisher) + tests | **done (14 tests)** |
| 2026-10-18 | `packages/contracts` — Compact skeletons + INVARIANTS.md (I1–I10) | drafted (not compiled) |
| 2026-10-19 | `packages/prover` — engagement model, witness opening assembly (membership/non-membership + pool inclusion), I1–I8 reference oracle | **done (15 tests)** |
| 2026-10-19 | `apps/web` — Next.js public profile (`/mm/[handle]`) + tear sheet, dark-theme tokens, read model + fixtures | **done (next build passes, 4 routes)** |
| 2026-10-19 | `packages/prover` — end-to-end demo + MM prover CLI (`pnpm --filter @mmr/prover demo`) wiring buildEpoch → witness → verdict | **done (16 tests total)** |

Total: 54 tests passing; `pnpm -r typecheck` clean; `next build` passes. Pushed
incrementally to `origin/ccr-0ae4f61d-euy47e` (frequent-push rule, §7).

## Build-order progress (from product spec)

- [x] 1. Deterministic indexer, leaf schema, root-of-roots → IPFS (TS; IPFS via injectable publisher, in-mem impl)
- [~] 2. Proving benchmark — TS I1–I8 reference oracle done; the Compact circuit
      benchmark itself needs the Midnight toolchain (not available here)
- [~] 3. Compact contract — skeletons + INVARIANTS.md written; needs `compactc` to compile
- [~] 4. Epoch proof / claim circuits — skeletons written; needs `compactc`
- [~] 5. Attester committee, challenge flow, void rules — TS interfaces done; Jubjub
      signing + on-chain flow need Midnight integration
- [~] 6. MM prover — CLI + reference oracle done; client watcher + fee-sponsor pending
- [ ] 7. Pilot

**Loop paused here.** Everything buildable and testable in this TS-only
environment is done. The remaining core (items 3–5) needs the Midnight Compact
toolchain + a Blockfrost token, which this container does not have — continuing
to auto-generate speculative TS scaffolding would burn credits for little value,
so the autonomous continuation was not re-armed. Resume points for a
Midnight-provisioned environment: compile the `.compact` circuits, run the
proving benchmark (fix bucket sizes), implement Jubjub attester signing, and wire
a real Base archive-RPC `ChainProvider`.

## Immutable design decisions

- **DD-1** Protocol tier is **Compact on Midnight (0.31.x / ledger 8)**, not EVM.
- **DD-2** **Base is read-only**; no contracts deployed there in v1.
- **DD-3** Indexed Merkle tree **depth 16** per pool; address-sorted; leaf points
  to `next_addr` for non-membership.
- **DD-4** Amounts are **unsigned `bigint`**; signed quantities are `{in,out}` pairs.
- **DD-5** Determinism is a hard invariant — byte-identical roots are testable.
- **DD-6** Wallet ownership verified **off-chain by the client** in v1 (ledger-9
  in-circuit check deferred).
- **DD-7** Bonds are **mandatory shielded USDM on Midnight** (v1); cross-chain
  slashing deferred.
- **DD-8** Hash/commitment primitive injected behind an interface; swap for the
  Midnight-native primitive before mainnet (current TS default documented as
  placeholder, NOT the production circuit hash).

## Open decisions (carry from spec)

- Wallet-ownership verifier (client-check default), bond mandatory (yes),
  bond settlement (Midnight only v1), reserve wallets visible to client (yes v1),
  custody floor price (strike for loans / agreed floor for retainers),
  epoch & bucket size (24h / 30-min; fix after proving benchmark),
  liquidity floor for pool inclusion (set from indexing cost).

## Environment limits (this build host)

- ✅ TypeScript, Prisma, tests run here.
- ⛔ Compact compilation, live Base RPC, Midnight mainnet, Blockfrost — not
  available here; those units are authored as reviewed source + specs.
