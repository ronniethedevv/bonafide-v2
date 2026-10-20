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
| 2026-10-19 | **C1 follow-up** — corrected field-element layout for `persistentHash` / `CompactHasher`: `Bytes<32>` → 2 FEs (high-8 / low-248); `hashNode` restructured to 4-FE layout; misleading "297 flat bytes" comments replaced with accurate FE counts in circuit and hash module | **done** |
| 2026-10-19 | **KAT (C1 verified)** — `packages/contracts/test/epoch_proof.kat.test.ts` executes the compiled `proveEpoch` (compact-runtime 0.16.0) over a pool tree + root-of-roots built with `@mmr/merkle`. Found + fixed: (a) `persistentHash` is SHA-256 over Compact's byte serialization with **little-endian** Uints, not field elements, so the FE-split row above was wrong and `encodeLeaf`/`encodePoolLeaf` (big-endian) **diverged** from the circuit; both now LE, `CompactHasher` is exact; (b) Compact ranges are half-open, so `for j of 0..15` never verified **slot 15** (forged leaf accepted); loops now `0..16`. Tamper cases (metric, next_addr, depth_root, path dir, pool root/addr, rootOfRoots, slot 15, Sha256Hasher-built witness) all revert | **done (13 KAT tests)** |
| 2026-10-19 | **H2 + L1** — `epoch_proof.compact`: `activeCount(): Uint<8>` witness; `assertWalletLayout` forces active wallets in `[0,n)` non-zero and strictly increasing, padding exactly 0 (rejects `[a,0,b]`, closes L1; `n` is determined by `W`). Merkle path + I2 only for active slots; padding forced `present=false` (no bogus opening needed). I6 depth now masked to member slots (padding / non-member depth no longer counts). Oracle unchanged: it already processes `activeCount` and only members | **done (+10 KAT tests)** |
| 2026-10-19 | **C2** — `proveEpoch` now returns `disclose(EpochResult { uptime, walletCommit, termsCommit })`: `wc = persistentCommit<Vector<16,Uint<160>>>(w, walletSalt)` (same scheme as registration) and `tc = persistentCommit<Terms>(terms, termsSalt)`. `registration.compact` now commits the structured `Terms` (identical struct) with a salt instead of `persistentHash(termsPreimage)` (DD-9). Caller accepts only if both equal `walletCommit[id]` / `termsCommit[id]` (I8-style "enforced by the caller"). `@mmr/prover` `commitWallets` fixed to persistentCommit's layout (`SHA-256(salt ‖ LE image)`; was BE image ‖ salt) + new `commitTerms`. KAT executes compiled `register` then `proveEpoch`: honest commitments match the ledger and the TS helpers; loosened terms, a dropped wallet, or a changed salt still prove but fail the caller check | **done (+5 KAT tests)** |
| 2026-10-20 | **Poseidon migration** — `epoch_proof.compact` Merkle hashing moved from `persistentHash` (SHA-256) to `transientHash` (Poseidon): slot leaves `transientHash<SlotLeafCore>`, pool leaves `transientHash<PoolEntry>`, nodes `transientHash<Vector<2, Field>>`; `PathStep.sibling` and `PoolEntry.poolRoot` are `Field`; public `rootOfRoots` stays `Bytes<32>` (DD-10). `@mmr/merkle/poseidon` `PoseidonHasher` calls compact-runtime's own `transientHash` (no re-implementation); digest = Field's 32-byte LE image (`Field as Bytes<32>`). Indexer trees + root-of-roots default to it (`commitHasher` split off for depth/flow commitments). KAT: honest witness passes; all tamper cases revert, plus new: pre-migration `CompactHasher` roots rejected, non-canonical digest rejected, pool-leaf/node hash equivalence pinned (safe by fixed path depth) | **done (32 KAT tests; 140 total)** |
| 2026-10-19 | `@mmr/read-model` — shared public types + fixtures + repository | **done (3 tests)** |
| 2026-10-19 | `apps/api` — Fastify read-model backend (/api/mm, /:handle, /:handle/epochs, /health) | **done (5 tests)** |
| 2026-10-19 | web→API wiring with fixture fallback (`apps/web/src/lib/data.ts`); full stack verified | **done** |
| 2026-10-19 | circuit prep: flow-window openings (I7) + claim-input builder (H4) | **done** |

Total: 140 tests passing (1 skipped) across 9 projects; `pnpm -r typecheck` clean; `next build`
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

## Remaining circuit work (from specs/CIRCUIT_REVIEW.md)

Done: C1, C2, H2/L1, Poseidon/transientHash migration (DD-8 resolved).

- [ ] **H1** — bind `bidMin`/`askMin` to each leaf's `depth_root` and select the
      contracted band (I6). Today the depth witnesses are unconstrained. Pick the
      depth-tree hash here (Poseidon, to match the slot trees) and move
      `commitHasher` off `Sha256Hasher`.
- [ ] **M1** — I7 round-trip cap: open `flow_root` per window in-circuit
      (TS openings already exist).
- [ ] **H3** — timestamps from a trusted source.
- [ ] **H4** — `claim` must verify the epochs it credits (claim-input builder exists).
- [ ] **M2** — I5 internal-transfer netting + cross-epoch disposal accounting.
- [ ] **M3** — `bond.postBond` takes real custody (`receiveShielded`).
- [ ] Proving benchmark / full keygen for `proveEpoch` (k, rows): see below.

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
- **DD-8** (resolved 2026-10-20) Hash primitive injected behind the `Hasher`
  interface. `persistentHash` is SHA-256 by definition (over Compact's byte
  serialization: Uint LE, Bool 1 byte, Bytes raw), so it was never a placeholder
  to "fill in". **Merkle trees the circuit verifies now use `transientHash`**
  (Poseidon, Field digests): `PoseidonHasher` in `@mmr/merkle/poseidon`, exact by
  construction (it calls compact-runtime's `transientHash` over the circuit's own
  types) and KAT-checked against the compiled `proveEpoch`. **Commitments that
  are ledger state stay on `persistentHash` / `persistentCommit`** (C2 wallet /
  terms, `epochKey`), reproduced by `CompactHasher`. `Sha256Hasher` (tagged) is
  off-circuit only. Caveat: the runtime documents `transientHash` as "not
  guaranteed to persist between upgrades". Roots are re-derivable from published
  trees, but a Midnight upgrade that changes Poseidon would require re-rooting
  in-flight epochs. Pin the toolchain and re-run the KAT on every upgrade.

- **DD-10** `rootOfRoots` stays **`Bytes<32>`** in the public `proveEpoch`
  interface (not `Field`). The circuit computes the root as a Field and casts it
  once (`h10 as Bytes<32>`, little-endian; Field→Bytes is injective, so the
  comparison is exact). Chosen because the TS caller, the attester-signed
  manifest (`rootOfRootsHex`), and `registration.activate` already carry 32-byte
  roots; `RootOfRoots.root` passes straight through. Cost: one 255-bit
  decomposition per proof. The other direction (`Bytes<32> as Field`) was avoided
  because it can fail on values ≥ the modulus at the public boundary.

- **DD-9** (C2) The terms commitment is `persistentCommit<Terms>(terms, termsSalt)`
  over the **structured** `Terms`, in both `registration.register` and
  `proveEpoch` (struct kept identical in both files; KAT-checked). Chosen over
  keeping the opaque `persistentHash(termsPreimage)`, which would have needed a
  second proof that the struct matches the preimage for no benefit. Salted (not
  a bare `persistentHash<Terms>`) because terms are low-entropy and a bare hash
  could be brute-forced from the public ledger.

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
