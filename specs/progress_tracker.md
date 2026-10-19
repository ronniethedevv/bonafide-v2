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
| 2026-10-19 | `packages/protocol` — settlement state machine, engagement reducer, mock attester committee | **done (29 tests)** |
| 2026-10-19 | `packages/watcher` — challenge watchdog (root recomputation) + client verdict log | **done (5 tests)** |
| 2026-10-19 | `apps/web` — depth/uptime hero chart (validated palette, SVG) | **done (build passes)** |
| 2026-10-19 | CI workflow (typecheck + test + web build), specs/RUNNING.md | **done** |
| 2026-10-19 | `packages/contracts` — all four `.compact` circuits compile under `compact compile --skip-zk` (0.31.1) | **done** |
| 2026-10-19 | `packages/contracts` — `epoch_proof.compact`: added `epochUptime` ledger + `insert` call; `compact compile --skip-zk` now emits `"proof": true`, ledger `[epochUptime]` | **done** |
| 2026-10-19 | **C1** — `epoch_proof.compact`: pool-inclusion + depth-16 slot Merkle paths bind all witnesses to `rootOfRoots`; `@mmr/merkle`: `CompactHasher` placeholder (DD-8), `POOL_TREE_DEPTH=10` fixed depth; all 88 tests green | **done** |

| 2026-10-19 | `@mmr/read-model` — shared public types + fixtures + repository | **done (3 tests)** |
| 2026-10-19 | `apps/api` — Fastify read-model backend (/api/mm, /:handle, /:handle/epochs, /health) | **done (5 tests)** |
| 2026-10-19 | web→API wiring with fixture fallback (`apps/web/src/lib/data.ts`); full stack verified | **done** |
| 2026-10-19 | circuit prep: flow-window openings (I7) + claim-input builder (H4) | **done** |

Total: 101 tests passing across 7 projects; `pnpm -r typecheck` clean; `next build`
passes; API + web verified end-to-end. Pushed incrementally to
`origin/ccr-0ae4f61d-euy47e` (frequent-push rule, §7).

### Backend/data tier now exists
The architecture's backend tier is real: a Fastify API serves the public read
model from a `ProfileRepository` (fixture-backed; a PostgreSQL/Prisma repo slots
in behind the same interface), and the web app consumes it with a fixtures
fallback. Still cloud-buildable next: the DB-backed repository (Prisma schema +
migrations), the prover CLI witness emitter, and deploy config. Coupled to
Midnight/chain specifics (do with the toolchain/keys): real Jubjub attester
signing, the live Base `ChainProvider` event decoding, and the IPFS publisher.

## Build-order progress (from product spec)

- [x] 1. Deterministic indexer, leaf schema, root-of-roots → IPFS (TS; IPFS via injectable publisher, in-mem impl)
- [~] 2. Proving benchmark — TS I1–I8 reference oracle done; the Compact circuit
      benchmark itself needs the Midnight toolchain (not available here)
- [x] 3. Compact contract — `registration.compact` + `bond.compact` compile under `compact compile --skip-zk` (0.31.1)
- [x] 4. Epoch proof / claim circuits — `epoch_proof.compact` + `claim.compact` compile under `compact compile --skip-zk` (0.31.1)
- [~] 5. Attester committee, challenge flow, void rules — **TS done** (settlement
      state machine, engagement reducer, mock committee, challenge watchdog);
      Jubjub signing + on-chain flow need Midnight integration
- [~] 6. MM prover — **CLI + reference oracle + client watcher done**; fee-sponsor pending
- [ ] 7. Pilot
- [x] CI/CD (blueprint §5.2) — GitHub Actions: typecheck + test + web build

**What remains needs a Midnight-provisioned environment** (not this container):
compile the `.compact` circuits (`compactc`), run the proving benchmark to fix
bucket sizes, implement Jubjub attester signing behind the existing
`AttesterCommittee` interface, and wire a real Base archive-RPC `ChainProvider`
behind the existing interface. A fee-sponsor (DUST + self-relay) and a live
IPFS/Blob `TreePublisher` are the remaining TS adapters, both behind interfaces
that already exist and are tested against in-memory fakes.

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
- ✅ Compact compilation (`compact 0.5.3`, toolchain 0.31.1) — circuits now compile
  with `--skip-zk`; ZK key generation needs a GPU-capable Midnight node.
- ⛔ Live Base RPC, Midnight mainnet, Blockfrost — not available here.
