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
| 2026-10-20 | **H1 (TS half)** — `@mmr/prover/depth-openings`: `assembleDepthOpenings` builds, per active member slot, the contracted-band (`terms.bandBps`) `(minBid,minAsk)` series + its Merkle opening against the wallet's `depth_root` (via `openBand`); `verifyDepthOpenings` checks the band leaf is the exact reconstruction of the witness series (`bandSeriesLeaf`, new export in `@mmr/indexer/commit`) **and** opens to `depth_root`; `uptimeFromOpenings` recomputes I6 from the bound values and equals the oracle's `uptimeBuckets`. Demo + CLI now assert `depthBound`. Tests: openings verify, oracle-equivalence, tamper (inflated bucket), wrong band, corrupted path. Also fixed: `pnpm install` was missing `@midnight-ntwrk/compact-runtime` in this container (declared by `@mmr/merkle`), which had left `epoch.test.ts` red here. **Circuit half (laptop):** add per-slot depth witness (band series + path), reconstruct `bandSeriesLeaf` in Compact, `verifyBandOpening` against `leaves[j].depth_root`, fold series into I6 — this TS module is its known-answer spec | **done (TS: +5 prover tests, 69 green in merkle+indexer+prover; circuit edit pending)** |
| 2026-10-20 | **M2 (TS half) + I5 sign-bug fix** — found + fixed a soundness bug: oracle I5 was `xfer_out <= xfer_in + D + from_treasury`, which **grants outflow budget equal to the loan** (an MM receiving a 1000 loan could transfer 1000 out and pass). Per INVARIANTS.md I5 and the code's own comment the loan is excluded: now `xfer_out + from_treasury <= xfer_in + D` (from_treasury ⊆ xfer_in, DD-11). Fixtures moved to the subset model; new tests: rug attempt rejected, internal-vs-external netting. New `@mmr/prover/carry-forward`: salted commitment over cumulative `(xfer_in, xfer_out, from_treasury)` (same `hashLeaf(salt‖LE)` scheme as wallet/terms), `carryStep` opens the prior commitment, adds the epoch, checks the cumulative cap, re-commits — the circuit mirror. Tests: commit round-trip/tamper, 3-epoch overrun that every per-epoch check passes but cumulative catches, broken-chain rejection, oracle-sums integration. **Circuit half (laptop):** apply the same I5 sign fix at `epoch_proof.compact:517` and wire the carry-forward commitment (open prev / add / check / re-commit); this module is the known-answer spec | **done (TS: +6 prover tests, 27 green; circuit edit pending)** |
| 2026-10-20 | **M1 (TS half)** — `@mmr/prover/flow-openings`: `assembleFlowOpenings` opens every window a member wallet recorded against its `flow_root` (via `openWindow`); `verifyFlowOpenings` checks each against the committed `flow_root` (`verifyWindowOpening` reconstructs the window leaf, so flow can't be fabricated); `roundTripFromOpenings` recomputes I7 (`rt_w = min(Σbuy, Σsell)`, gross) from the bound values and equals the oracle's `sums.roundTripVolume`/`grossVolume`; `roundTripCapHolds` matches `invariants.I7`. Tests: openings verify, oracle-equivalence (rt=130, gross=330), tamper (deflated sell), corrupted path. **Circuit half (laptop):** open each window from `leaves[j].flow_root`, aggregate per window, enforce `rt·1e6 ≤ ppm·gross`; this module is the known-answer spec | **done (TS: +4 prover tests, 31 green; circuit edit pending)** |
| 2026-10-20 | **CI fix** — `@mmr/tearsheet` real-Chromium PDF test timed out in CI (same commit passed on the PR-event run; a flake). Root cause: Chromium hangs on the GitHub runner's tiny `/dev/shm`. Added `--disable-dev-shm-usage` to the launch and aligned the vitest timeout (60s→120s) with Chrome's own execFile timeout. Passes locally in ~0.5s | **done** |
| 2026-10-20 | **H4 (TS half)** — decision A1+B1 (DD-12): uptime pass threshold is a committed term (bucket count, matching the oracle's `minUptimeBuckets`), and `epochsTotal` is the committed contract length. `@mmr/watcher/verdict-log`: `EpochRecord` (mirrors an `epochUptime` entry), `deriveClaimFromRecords` (passed = records meeting the threshold over epochs 1..epochsTotal; a missing/failed epoch counts to total, not passed), `verifyClaimAgainstRecords` (denominator must equal the committed total; passed must equal the derived count). Tests: honest verifies, inflated passed rejected, wrong denominator rejected, out-of-range records ignored, stricter threshold credits fewer, passed never exceeds total. Threshold/total are explicit params for now — committing them in `Terms` is **atomic with the circuit** (commitTerms + circuit `Terms` struct + registration + KAT), deferred to the laptop session (DD-12). **Circuit half (laptop):** read the two terms, iterate 1..epochsTotal over `epochUptime`, assert claimed counters == counts | **done (TS: +7 watcher tests, 13 green; Terms-commit + circuit edit pending)** |
| 2026-10-20 | **M2(a) (circuit)** — `epoch_proof.compact` I5 sign fix (DD-11): `assert(xferOut + fromTreasury <= xferIn + t.disposal_D)` (was `xferOut <= xferIn + D + fromTreasury`, which granted the loan as outflow budget). Now agrees with the oracle. KAT harness `buildScenario` takes wallet-A metric overrides (tree rebuilt, so openings stay valid). New KAT: loan-rug (`xfer_out == from_treasury`, `xfer_in` = loan only) reverts, D+1 reverts, exactly-D passes, non-loan inflow still funds outflow. Verified against a draft build of the old formula: the rug and D+1 cases **passed** there (bug reproduced), so the tests bite | **done (+4 KAT tests; 36 KAT, 166 total)** |
| 2026-10-20 | **H1 (circuit)** — `epoch_proof.compact` binds member depth to `depth_root`: new `struct BandSeries { band_bps: Uint<64>, bid/ask: Vector<48, Uint<128>> }` and `witness depthPaths(): Vector<16, Vector<2, PathStep>>`; per member slot, `verifyBandPath(transientHash<BandSeries>({t.band_bps, bidMin[j], askMin[j]}), depthPaths[j], L.depth_root)` ("depth_root opening mismatch (H1)"), then the existing masked I6 fold. **Decision (DD-13): dense 48-bucket series, fixed depth-2 band tree, Poseidon** (see DD-13). TS: `@mmr/indexer` `encodeBandSeries` is now the dense LE `BandSeries` image (+ `denseBandSeries`, `BAND_SERIES_BUCKETS`, `BAND_TREE_DEPTH`); flow leaf is the LE `FlowWindow` image; tree padding is a hashable empty leaf (was `hashLeaf(empty)`, which Poseidon cannot hash); `PoseidonHasher` gains the band (1544 B) + flow (36 B) layouts; `buildEpoch` `commitHasher` defaults to `PoseidonHasher`; depth/flow-openings tests + `runDemoEpoch` use it. KAT: harness commits real member `depth_root`s (`memberDepth`); 3 H2 depth tests now commit their member depth instead of mutating it post-hoc (same masking property); new H1 block: inflated minBid, tampered minAsk, band-path sibling, flipped direction, other band with its own valid path, Sha256Hasher `depth_root` — all revert; the prover's `assembleDepthOpenings` output is the circuit witness and circuit uptime == `uptimeFromOpenings` == oracle `uptimeBuckets` (43). Verified against a draft of the pre-H1 circuit: all 6 tamper cases **passed** there | **done (+7 KAT, +5 indexer tests)** |
| 2026-10-19 | `@mmr/read-model` — shared public types + fixtures + repository | **done (3 tests)** |
| 2026-10-19 | `apps/api` — Fastify read-model backend (/api/mm, /:handle, /:handle/epochs, /health) | **done (5 tests)** |
| 2026-10-19 | web→API wiring with fixture fallback (`apps/web/src/lib/data.ts`); full stack verified | **done** |
| 2026-10-19 | circuit prep: flow-window openings (I7) + claim-input builder (H4) | **done** |

Total: 178 tests passing (1 skipped) across 9 projects; `pnpm -r typecheck` clean; `next build`
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
H1 done (TS + circuit, 2026-10-20).

- [x] **H1 (circuit half)** — done (status log 2026-10-20, DD-13): dense
      `BandSeries` leaf, depth-2 band tree, `transientHash`; KAT green.
- [ ] **M1 (circuit half)** — I7 round-trip cap. **TS half done** (status log
      2026-10-20): `@mmr/prover/flow-openings` assembles/verifies per-window
      `flow_root` openings and reproduces the oracle's round-trip/gross. Circuit
      edit remaining: open each window from `leaves[j].flow_root`, aggregate per
      window across slots, enforce `rt·1e6 ≤ ppm·gross`. `flow-openings.ts` is the
      known-answer spec; keep the KAT in the loop.
- [ ] **H3** — timestamps from a trusted source.
- [ ] **H4 (circuit half + Terms commit)** — `claim` must verify the epochs it
      credits. **TS half done** (status log 2026-10-20, DD-12):
      `@mmr/watcher/verdict-log` `deriveClaimFromRecords` / `verifyClaimAgainstRecords`
      are the known-answer spec. Remaining, as ONE atomic change (TS + circuit +
      KAT together, per DD-9 coupling): add `minUptimeBuckets` + `epochsTotal` to
      `EngagementTerms`, `commitTerms`, the circuit `Terms` struct, `registration`,
      and the harness/KAT; then `claim.compact` iterates 1..`epochsTotal` over
      `epochUptime`, counts epochs meeting `minUptimeBuckets`, and asserts the
      claimed `epochsPassed`/`epochsTotal` equal the counts and the committed total.
- [ ] **M2 (circuit half)** — I5 **TS half done** (status log 2026-10-20): oracle
      sign fixed, internal netting shown emergent, `@mmr/prover/carry-forward`
      commitment + `carryStep` built and tested. (a) **done** — sign fix at
      `epoch_proof.compact` I5 + KAT (status log 2026-10-20). Remaining: (b) wire the carry-forward commitment (open the prior
      cumulative commitment, add this epoch, check `cumulativeI5Holds`, re-commit)
      — `carry-forward.ts` is the known-answer spec. Keep the KAT in the loop.
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

- **DD-11** (M2) `from_treasury` is a **subset of `xfer_in`** (the loan is one of
  the transfers in), so I5 excludes it: `xfer_out + from_treasury ≤ xfer_in + D`
  (underflow-safe form of `xfer_out ≤ xfer_in − from_treasury + D`, INVARIANTS.md
  I5). Corrects the prior `+ from_treasury`, which granted outflow budget equal to
  the loan (a rug of the loaned assets passed I5). The indexer's real Base reader
  MUST populate `xfer_in` to include treasury inflows for this to hold; fixtures
  updated to match. D is a **lifetime** budget enforced cumulatively by the
  carry-forward commitment, not per-epoch.

- **DD-12** (H4) The claim verifies what it credits against the on-chain
  `epochUptime` record. **A1:** an epoch "passed" uptime when its recorded
  bucket count ≥ a committed **`minUptimeBuckets`** term (a bucket count, not a
  percentage — the record is a bucket count and the oracle already models this as
  `minUptimeBuckets`; no in-circuit division). **B1:** `epochsPassed` is counted
  over epochs `1..epochsTotal` where **`epochsTotal`** is the committed contract
  length, so a failed or unproven epoch (no qualifying record) counts toward the
  total but never toward passed, and passed can never exceed total. Chosen over a
  separate on-chain "settled epochs" counter (B2), which would need to record
  failed-but-settled epochs that `proveEpoch` can't (it reverts on failure).
  Adding these two terms is **atomic with the circuit** (commitTerms, the circuit
  `Terms` struct, registration, and the KAT move together, per DD-9), so the TS
  half takes them as explicit parameters until that change lands.

- **DD-13** (H1) The depth_root band leaf is a **dense** fixed 48-bucket
  `BandSeries { band_bps: Uint<64>, bid: Vector<48, Uint<128>>, ask: Vector<48,
  Uint<128>> }` (missing bucket = 0), hashed with **`transientHash`**
  (`PoseidonHasher`), in a band tree of **fixed depth 2** (≤ 4 bands, padded with
  an empty band-0 leaf). Chosen over the sparse `encodeBandSeries` because
  `PoseidonHasher` can only hash fixed Compact struct layouts and dense maps
  straight onto the `bidMin`/`askMin` `Vector<48>` witness; sparse and dense
  forms of the same values give the same leaf and the same uptime. Supersedes
  the earlier note that the band tree could stay `Sha256Hasher`: everything the
  circuit verifies is Poseidon. The opened leaf carries `t.band_bps`, so only
  the contracted band opens; its index is not checked. Proving requires
  `bucketsPerEpoch == 48` and ≤ 4 bands (`DEFAULT_CONFIG`). The flow leaf
  (`FlowWindow`, 36 B LE) and its zero-flow padding are set here only so
  `flow_root` is Poseidon-hashable; M1 finalizes the flow tree shape.

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
