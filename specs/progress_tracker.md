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
| 2026-10-20 | **M1 (circuit)** — I7 now enforced in `epoch_proof.compact`. **Decision (DD-14): `flow_root` = `transientHash<FlowSeries { buy, sell: Vector<48, Uint<128>> }>` over the wallet's WHOLE dense series, no per-window tree** — per-window openings let the prover choose which windows to open, i.e. omit round-trip-heavy ones (completeness hole), and per-id cross-slot aggregation is costly in-circuit. New witnesses `flowBuy`/`flowSell: Vector<16, Vector<48, Uint<128>>>`; per member slot `assert(transientHash<FlowSeries>(…) as Bytes<32> == L.flow_root, "flow_root opening mismatch (M1)")`; then per window over members `rt_w = min(Σbuy, Σsell)`, `gross_w = Σbuy + Σsell` (`map`/`fold` over a window-index vector, reusing the masked `bidSum`), `assert(roundTrip·1e6 <= ppm·gross, "round-trip cap (I7)")`. TS: `@mmr/indexer` `commitFlow` = hash of the dense `FlowSeries` image (`FLOW_WINDOWS`, `denseFlowSeries`, `openFlow`, `verifyFlowOpening` replace `openWindow`/`verifyWindowOpening`); `PoseidonHasher` flow layout is now `FlowSeries` (1536 B); `@mmr/prover/flow-openings` carries the dense series (`assembleFlowOpenings(engagement, activities)` — no hasher needed); its "corrupted path" test (no path any more) became "omitted window rejected" + "series swapped between wallets rejected". Oracle unchanged. KAT: prover openings as witness, rt/gross == oracle sums (130/330), cap enforced at the exact boundary (ppm 393 940 holds, 393 939 reverts, as `roundTripCapHolds`); deflated sell, omitted window, swapped series, Sha256 `flow_root` all revert; non-member/padding flow masked. Verified against a draft of the pre-M1 circuit: all 5 reject cases **passed** there | **done (+6 KAT, +1 prover tests)** |
| 2026-10-20 | **M2(b) (circuit)** — I5 carry-forward across epochs in `epoch_proof.compact`: `struct CarryTotals { xfer_in, xfer_out, from_treasury: Uint<192> }`, `ledger carryCommitment: Map<Bytes<32>, Bytes<32>>` (engagement id → salted commitment), witnesses `carryPrev`/`carryPrevSalt`/`carryNewSalt`. Mirrors `carryStep`: if an entry exists, `persistentCommit<CarryTotals>(prev, prevSalt)` must equal it ("carry-forward chain broken (M2)"); **genesis = no entry, and prev must then be zero** ("carry-forward genesis not zero (M2)" — else a first epoch could claim phantom prior inflow as budget); add this epoch's member sums; `assert(cum.xfer_out + cum.from_treasury <= cum.xfer_in + D, "cumulative outflow cap (I5, M2)")`; insert the new commitment under a fresh salt. Per-epoch I5 unchanged. TS spec unchanged: `carryCommit` with `CompactHasher` byte-matches the ledger value (`genesisCarry` ≡ the circuit's absent-entry branch). Harness: carry witnesses (genesis default) and optional ledger `state` in/out of `runProveEpoch` to chain epochs; `ledgerUptime` now reads this epoch's own `EpochRef` key. KAT: 3 epochs × 40 out with D = 100 — epochs 1–2 prove with ledger == `carryStep` commitment, epoch 3 reverts on the cumulative cap while the same activity proves alone; understated prevTotals, wrong salt, non-zero genesis revert. On the pre-M2(b) circuit the genesis case is accepted and the chained cases fail (no carry ledger) | **done (+4 KAT)** |
| 2026-10-20 | **H3 (trusted time)** — compiler-confirmed: Compact 0.31.1 exposes block time **only as comparisons** (`blockTimeLt/Lte/Gt/Gte(t: Uint<64>): Boolean`, checked on-chain against the tx block; `blockTime`/`blockTimeGreaterThan` are unbound). `bond.compact`: `nowTs` removed from `releaseEpoch`/`voidUnfunded`/`defaultEngagement`; each gate is `assert(blockTimeGte(anchor + WINDOW))`. `registration.register`: no block-time *value* exists to store in `registeredAt`, so the arg stays (renamed `registeredTs`) but is **verified**: `blockTimeGte(ts)` and `blockTimeLt(ts + 600)` — recorded time is within 10 min of the block. KAT (`test/time.kat.test.ts`, harness sets `QueryContext.block.secondsSinceEpoch`): every bond gate reverts at window end − 1 s and passes at window end; release 60 s after settlement reverts; register accepts ts = block time and block − 599 s, rejects block − 600 s and block + 1 s. Pre-H3 `bond` (ad-hoc probe): release 60 s after settlement **accepted** with a forged `nowTs`. `kat:build` now also builds `bond`. No TS circuit callers besides the harness (`@mmr/protocol` statemachine is an off-chain model with explicit times) | **done (+8 KAT); H3b open** |
| 2026-10-20 | **H4 (claim verifies epochs) + Terms schema** — atomic (DD-9): `minUptimeBuckets` + `epochsTotal` (Uint<64>, after `band_bps`) added to `EngagementTerms`/`commitTerms` (`MAX_EPOCHS = 90`, enforced by `assertTerms`), the `Terms` struct in `registration.compact` **and** `epoch_proof.compact`, harness `TermsW` (+ `termsToEngagement`, now used by the byte-identity KAT), every TS literal; oracle I6 defaults to `terms.minUptimeBuckets`. **Decision (DD-15): `claim` moved into `epoch_proof.compact` and reads records privately** — see DD-15. `proveEpoch` appends `EpochRecord { id, epoch, uptime, termsCommit }` to `HistoricMerkleTree<20>` `epochRecords` (constructor seeds a zero genesis record); `claim` checks `persistentHash(secret) == engagementId` (closes claiming someone else's public records), opens terms → `tc`, for all 90 slots unconditionally `checkRoot(merkleTreePathRoot(path))` (a witness-gated ledger op would leak epochs_total — the compiler rejected it), for presented slots `e < epochs_total` asserts the leaf is `{id, e+1, tc}`, counts `uptime >= min_uptime_buckets`, asserts claimed `epochsPassed`/`epochsTotal` == count / committed total. Also fixed: the old claim reverted on any first claim (`Counter.lookup` of an absent key) — now `insertDefault`. `claim.compact` deleted (scripts/docs updated). KAT (register → 3 chained proveEpochs with carry → claim): honest 2/3 == `deriveClaimFromRecords`, counters (1, 2, 3), repeat claim reverts (I10); inflated passed, wrong denominator, fabricated record, record in wrong slot, foreign id, loosened threshold all revert; epoch beyond `epochs_total` not credited; withholding only lowers the count | **done (+8 KAT)** |
| 2026-10-20 | **M3 (real bond custody)** — API confirmed with the compiler: `receiveShielded(ShieldedCoinInfo)`, `sendShielded(QualifiedShieldedCoinInfo, Either<ZswapCoinPublicKey, ContractAddress>, Uint<128>)` → `{ change: Maybe<…>, sent }`, `Map.insertCoin(key, coin, right(kernel.self()))`, `ownPublicKey()`. `bond.compact`: `postBond(id, tierMin, beneficiary)` discloses the coin (declared disclosure), `receiveShielded`s it and stores it as a contract-owned qualified coin in `escrowed[id]`, recording `bondOwner = ownPublicKey()` and the slash `bondBeneficiary` (the client; DD-16); one bond per engagement. `payOut` asserts `amount <= escrowed value` ("release exceeds escrow (M3)"), `sendShielded`s to the recipient and re-escrows the change. `releaseEpoch(id, settledAt, amount)` pays the owner; `voidUnfunded` returns the whole bond to the owner; `defaultEngagement` marks slashed and sends the whole remaining bond to the beneficiary. Removed the old `escrow`/`bondOf` maps and `bondSalt` witness. KAT (`test/bond.kat.test.ts`, runtime-simulated Zswap): post creates an output to the contract and escrows the coin; release 400 → 400 to owner + 600 change re-escrowed, then 600 drains it; release > escrow (1 001, and 601 after a partial) reverts; slash sends 1 000 (or the 700 left) to the beneficiary and blocks later release; void returns 1 000 to the owner; below-tier / double post revert. H3 gate tests now run against a posted bond. Pre-M3 `postBond` (probe): 0 Zswap outputs — no custody. **Privacy note:** custody requires disclosing the coin, so the bond value is public in contract state (the old skeleton already disclosed it in `escrow`) | **done (+7 KAT)** |
| 2026-10-20 | **Full zk keygen (after H1/M1/M2/H3/H4/M3)** — `compact compile` (no `--skip-zk`) under a 6 GB address-space cap (`ulimit -v`; host: 7 GB RAM + 2 GB swap, 4 cores). k/rows from `zkir mock-compile`. **bond**: postBond k=14 (13 333 rows), releaseEpoch k=15 (24 991); keys generated, 1.5 min, 312 MB peak. **registration**: register k=15 (24 019), activate k=10 (585); keys generated, 25 s, 310 MB peak. **epoch_proof**: claim k=19 (486 729 rows) — keys generated (153 MB prover key); **proveEpoch k=20 (599 529 rows) — keys generated** after a host upgrade to 14 GB RAM + 8 GB swap, under a 13 GiB `ulimit -v` cap: 305 MB prover key, 2.1 KB verifier key; epoch_proof full compile (claim + proveEpoch) 31 min wall, **9.46 GiB peak RSS** (`/usr/bin/time -v`: 9 916 012 KB, no swap) — proveEpoch alone ≈ 18 min. (First attempt under a 6 GB cap on the 7 GB host aborted: "memory allocation of 16777216 bytes failed", 5.96 GB peak.) contract-info: every circuit `proof: true` (proveEpoch, claim, register, activate, postBond, releaseEpoch, voidUnfunded, defaultEngagement); every circuit now keyed | **done** |
| 2026-10-20 | **H3b (gate anchors from ledger state)** — compiler-confirmed: Compact 0.31.1 rejects cross-contract calls ("cross-contract calls are not yet supported"), so **registration + bond moved into `epoch_proof.compact` (DD-17)**; `registration.compact` / `bond.compact` deleted, `kat:build` builds one contract. New ledger fields are declared after every proveEpoch/claim field (both still compile, but their zkir changed with the ledger layout: proveEpoch k=20 / 599 532 rows (+3), claim k=19 / 486 726 (−3) — keys need one regen). Anchors are stored, block-time-bounded when written (`block − 600 s < ts ≤ block`, as H3's `registeredTs`), and read back by the gates; **no gate takes an anchor argument**: `voidUnfunded(id)` reads `registeredAt` (and needs status Registered — closes refunding a funded bond); `activate(id, root, activatedTs)` records `activatedAt` (epoch e ends at `activatedAt + e·24h`), only inside the funding window; new **`settleEpoch(id, epoch, settledTs)`** records `settledAt[epochKey]` for an epoch with a record in `epochRecords` (path witness, `checkRoot`) whose `termsCommit == termsCommit[id]` (the C2 terms check, now on-chain), after the epoch ends and before its grace deadline (`end + 6h attester + 12h challenge + 24h proving + 24h grace`), once; `releaseEpoch(id, epoch, amount)` reads `settledAt` (+12h); `defaultEngagement(id, epoch)` needs the epoch unsettled at its grace deadline, sets Defaulted. `postBond` needs a Registered/Funded engagement. KAT (`test/anchors.kat.test.ts`, +13): void opens at stored `registeredAt + 72h` exactly, a 599 s back-dated registration moves it ≤ 599 s, −600 s refused; activation bounded, closed after the funding window, blocks void; `settledAt` = recorded ts within 600 s of its block (−599 ok, −600 / +1 refused); settle before end / at grace deadline, unproven epoch, wrong epoch's record, double settle, **epoch proven under loosened terms** all revert; release on an unsettled epoch reverts however late; **back-dated settlement opens release ≤ 599 s early**; default exactly at the grace deadline, never on a settled epoch or an unactivated engagement. `bond.kat` (M3) rebuilt on register → post → activate → prove → settle (now also rejects a bond for an unregistered id); the 4 old H3 gate tests in `time.kat` are superseded. Mutation probe (drop the settledTs lower bound + the terms check): exactly the 3 covering tests fail | **done (+13 KAT, −4 superseded; 85 total)** |
| 2026-10-20 | **M3b (release tranches tied to proven epochs)** — schedule decided as **DD-18**: one tranche per settled epoch, to the bond owner; after k released epochs of E the cumulative release is exactly ⌊B·k/E⌋ (B = posted bond). `register` opens the committed terms and stores `contractEpochs[id] = epochs_total` (asserts 1..90); `postBond` stores `bondValue[id]` and zeroes `releasedEpochs` / `releasedTotal`. `releaseEpoch(id, epoch, amount)` additionally requires the epoch's tranche unreleased (`epochReleased` set, per `epochKey`) and checks `amount` division-free: `cum·E ≤ B·k` ("release exceeds the earned tranche (M3b)") **and** `(cum+1)·E > B·k` ("release below …" — an exact step, so nothing is stranded once all E epochs are out); the E-th release sets status **Settled** (no default afterwards). `settleEpoch` / `defaultEngagement` now reject epochs outside `1..contractEpochs` (closes defaulting a finished engagement on epoch E+1). TS reference `@mmr/protocol` `cumulativeRelease` / `nextTranche` (+3 unit tests: 333/333/334 and 333/334/334 splits, sums == B for 5 (B, E) pairs). KAT (`test/tranche.kat.test.ts`, +9): honest releases in any epoch order pay `nextTranche` to the owner only, running sum == `cumulativeRelease` ≤ escrow, final == B, escrow empty, status Settled; 334 / whole bond / 334-after-333 revert (exceeds); 332 / 0 revert (below); double release reverts; epoch 4 cannot settle / release / default; completed engagement cannot default; B = 1001 pays 333 + 334 + 334; register rejects epochs_total 0 and 91. `bond.kat` / `anchors.kat` releases now pay the exact tranche (the "release > escrow" case is unreachable through the schedule; `payOut`'s escrow assert stays). Mutation probe (drop exceeds / below / once asserts, one at a time): exactly the covering test fails each time. Sizes (`zkir mock-compile`): releaseEpoch k=15 (27 621), settleEpoch k=13 (8 040), register k=15 (24 067), proveEpoch k=20 (599 532), claim k=19 (486 738) | **done (+9 KAT, +3 unit; 93 KAT total)** |
| 2026-10-21 | **C2 wallet half on-chain** — `proveEpoch` now asserts the engagement is registered (`status.member(id)`, "engagement not registered (C2)") and `persistentCommit(wallets, walletSalt) == walletCommit[id]` ("wallet commitment does not match registration (C2)"), possible since DD-17 put registration in this contract; the terms half stays in `settleEpoch` (H3b). A dropped wallet, a swapped wallet (even with a valid non-membership opening) or a different wallet salt now **reverts in-circuit** instead of relying on the caller. KAT harness: `runProveEpoch` without a state first registers the witness under `KAT_SECRET` / `KAT_ID`; C2 suite +2 (unregistered id; swapped wallet, which proves under an engagement that registered it). Sizes (`zkir mock-compile`): proveEpoch k=20 / 599 544 rows (+12), claim k=19 / 486 738 (unchanged) | **done (95 KAT total)** |
| 2026-10-22 | **Unit 3 handoff spec** (`specs/UNIT3_CHAINPROVIDER.md`) — the executable plan for the live `ChainProvider` data-extraction methods (`poolsAboveFloor` / `poolActivity` / `poolPriceSamples`): preflight checks, per-method RPC + Uniswap v3 math, the modeling decisions to pin against a primary source (price orientation/decimals, swap attribution, treasury set, tick→depth), and a determinism + explorer-spot-check verification plan. For the session/machine with archive-RPC access; this cloud session's network policy blocks RPC hosts (403 at the proxy, confirmed on keyless public endpoints) | **done (doc)** |
| 2026-10-21 | **Uniswap v3 decoding core (keccak256 + ABI + CREATE2 pools)** — unit 2 of the `ChainProvider`, all pure + verified in-session (no network). `evm/keccak.ts`: keccak256 from scratch (Node has SHA3 not keccak), KAT'd against standard vectors (empty, "abc") and the canonical Transfer/Swap topic0 hashes. `evm/abi.ts`: word decoders (uint / signed-256 two's-complement / right-aligned address), event topic0s **derived** as keccak(signature) — matching the published on-chain constants for Transfer/Swap/Mint/Burn/PoolCreated (so no magic hashes) — and typed decoders for each event (indexed topics vs data words laid out per the canonical ABI). `evm/pool.ts`: deterministic `computePoolAddress` (CREATE2: `last20(keccak(0xff‖factory‖keccak(abi.encode(token0,token1,fee))‖initCodeHash))`), token sorting, fee tiers. **Real-world KAT**: the derived address equals the live **USDC/WETH 0.05% pool on Ethereum** (`0x88e6a0c2…`) — validates keccak + CREATE2 + the chain constants against on-chain truth. +18 tests (keccak 5, abi 9, pool 4) | **done (+18 tests)** |
| 2026-10-21 | **Multi-chain EVM ChainProvider foundation (Base + Ethereum, Uniswap v3)** — unit 1 of the real `ChainProvider`. `chains.ts`: per-chain registry (Base 8453 / Ethereum 1), each with its Uniswap v3 factory + canonical init-code hash and its own RPC env var (`BASE_ARCHIVE_RPC_URL` / `ETH_ARCHIVE_RPC_URL`); `resolveChain` rejects unsupported chains. `evm/rpc.ts`: `JsonRpcClient implements EvmRpc` (eth_chainId / eth_blockNumber / finalized block / eth_getLogs / eth_call) over an injectable `fetch` — a boundary that validates responses, parses hex→number, surfaces JSON-RPC + HTTP errors as typed `EvmRpcError`, timeout via AbortController; shared `http.ts` `FetchLike`. `evm/provider.ts`: `UniswapV3ChainProvider` with **real** `chainId()` + `finalizedBlock()` + `assertChainId()` (catches a wrong-chain URL); the data-extraction methods (`poolsAboveFloor` / `poolActivity` / `poolPriceSamples`) throw a typed `NotImplementedError` rather than returning fabricated data — they land in later units, each **[verify]**'d against live archive logs (Uniswap v3 tick/liquidity + price replay). **Per-chain** design (DD): roots are computed per chain, a proof opens one chain's `rootOfRoots`, so the circuit is unchanged; cross-chain-in-one-proof is out of v1 scope. Aerodrome (Base-only) is a later separate provider. 23 unit tests (chains 5, rpc 11, provider 7), fake transport, no network. Specs updated (architecture / project_overview / AGENTS now say Base **+ Ethereum**, read-only, per-chain) | **done (+23 tests)** |
| 2026-10-21 | **DB-backed `ProfileRepository` (`@mmr/db`, PostgreSQL/Prisma)** — new package: `DbProfileRepository implements ProfileRepository` reconstructs the nested `MmProfile` projection from flat store rows behind a narrow, hand-written `ProfileStore` port (no Prisma import in the typecheck graph, so CI is green before `prisma generate`). Pure assembly — no formatting, no I/O of its own (the projection worker owns formatting + the privacy filter); `tierCounts` derived from the engagement rows so they can't drift. `prisma/schema.prisma` models mm / engagement / epoch_point (public read-model columns only); `prisma/profile-store.ts` is the live `PrismaClient` binding, kept **outside `src/`** so it compiles only after `prisma generate` ([verify], needs `DATABASE_URL`). 7 unit tests incl. an exact **round-trip** (flatten the `vega` fixture → rows → `DbProfileRepository` → deep-equals the original), unknown handle → undefined, scrambled epoch rows still sort oldest→newest, sandbox split, empty profile. API entry documents the one-line live swap | **done (+7 tests)** |
| 2026-10-21 | **Real IPFS `TreePublisher` (Pinata)** — `packages/indexer/src/pinata.ts`: `PinataTreePublisher implements TreePublisher` posts the full tree bytes to Pinata's v3 files API (`uploads.pinata.cloud/v3/files`, `network: public` so the CID resolves on any gateway — storage segregation, recomputable from the CID) over global `fetch` (no SDK, nothing version-pinned). Boundary discipline: validates inputs (rejects empty bytes / missing JWT), fails loudly with a typed `PinataPublishError` (status + body) on non-2xx, non-JSON, or a body with no valid CID (no silent fallback), AbortController timeout. `fetch` is injectable, so 14 unit tests exercise the real request shape (POST, bearer auth, multipart `file`+`network`, content-addressed CID stability) + every failure path with a fake transport and no network; `fromEnv` reads `PINATA_JWT`/`PINATA_GATEWAY`; `retrieve(cid)` round-trips bytes from the gateway for a publish check. **[verify]** the v3 endpoint + success-body shape against live Pinata before a real run (marked in-file). Replaces the in-memory publisher as the production adapter | **done (+14 tests)** |
| 2026-10-21 | **Final-layout zk keygen (after H3b/M3b/C2-on-chain)** — full `compact compile` of `epoch_proof.compact` (no `--skip-zk`) under a 13 GiB `ulimit -v` cap on the 14 GB host: 36.5 min wall, **9.46 GiB peak RSS** (`/usr/bin/time -v`: 9 916 216 KB, no swap). Keys for all 9 circuits regenerated: proveEpoch 305 MB prover / 2.1 KB verifier (k=20), claim 153 MB (k=19), register / releaseEpoch / voidUnfunded / defaultEngagement ≈ 10 MB, postBond 5.2 MB, settleEpoch 2.8 MB, activate 0.3 MB; contract-info: every circuit `proof: true`. Keys are build output (gitignored, `dist/epoch_proof/keys`) | **done** |
| 2026-10-19 | `@mmr/read-model` — shared public types + fixtures + repository | **done (3 tests)** |
| 2026-10-19 | `apps/api` — Fastify read-model backend (/api/mm, /:handle, /:handle/epochs, /health) | **done (5 tests)** |
| 2026-10-19 | web→API wiring with fixture fallback (`apps/web/src/lib/data.ts`); full stack verified | **done** |
| 2026-10-19 | circuit prep: flow-window openings (I7) + claim-input builder (H4) | **done** |

Total: 212 tests passing (1 skipped) across 9 projects; `pnpm -r typecheck` clean; `next build`
passes; API + web verified end-to-end. Pushed incrementally to
`origin/ccr-0ae4f61d-euy47e` (frequent-push rule, §7).

### Backend/data tier now exists
The architecture's backend tier is real: a Fastify API serves the public read
model from a `ProfileRepository` (fixture-backed by default; the **PostgreSQL/Prisma
`DbProfileRepository` (`@mmr/db`) is now built** and slots in behind the same
interface — [verify] on a live `DATABASE_URL` + `prisma generate`), and the web app
consumes it with a fixtures fallback. Still cloud-buildable next: the prover CLI
witness emitter and deploy config. The IPFS
publisher is now a **real Pinata v3 adapter** (`PinataTreePublisher`, behind the
`TreePublisher` interface; [verify]-gated on live Pinata, needs `PINATA_JWT`).
The multi-chain `ChainProvider` foundation (Base + Ethereum, Uniswap v3: config +
RPC client + identity/finality) is **built** (`@mmr/indexer` `evm/`); its
data-extraction methods (pool discovery, per-address activity, price replay) are
staged behind `NotImplementedError` and land next, [verify]'d against live archive
logs. Coupled to Midnight specifics (do with the toolchain/keys): real Jubjub
attester signing.

## Build-order progress (from product spec)

- [x] 1. Deterministic indexer, leaf schema, root-of-roots → IPFS (TS; injectable `TreePublisher`, in-mem fake + **real Pinata v3 adapter**, [verify] on live Pinata)
- [~] 2. Proving benchmark — TS I1–I8 reference oracle done; the Compact circuit
      benchmark itself needs the Midnight toolchain (not available here)
- [x] 3. Compact contract — registration + bond (now in `epoch_proof.compact`, DD-17) compile under `compact compile --skip-zk` (0.31.1)
- [x] 4. Epoch proof / claim circuits — `epoch_proof.compact` (incl. `claim`, DD-15) compile under `compact compile --skip-zk` (0.31.1)
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
behind the existing interface. The live IPFS `TreePublisher` is **done** (Pinata
v3, [verify] on live Pinata); a fee-sponsor (DUST + self-relay) is the remaining
TS adapter, behind an interface that already exists and is tested against fakes.

## Remaining circuit work (from specs/CIRCUIT_REVIEW.md)

Done: C1, C2, H2/L1, Poseidon/transientHash migration (DD-8 resolved), M2, H1, M1, H3, H3b, H4, M3, M3b.

- [x] **H1 (circuit half)** — done (status log 2026-10-20, DD-13): dense
      `BandSeries` leaf, depth-2 band tree, `transientHash`; KAT green.
- [x] **M1 (circuit half)** — done (status log 2026-10-20, DD-14): whole dense
      `FlowSeries` committed as `flow_root`, I7 cap enforced; KAT green.
- [x] **H3** — "now" is block time (`blockTimeGte`), not a caller arg; `registeredAt` is
      block-time-checked (status log 2026-10-20).
- [x] **H3b** — gate anchors (`registeredAt`, `activatedAt`, `settledAt`) are ledger
      state, block-time-bounded when recorded; bond + registration moved into
      `epoch_proof` (DD-17) (status log 2026-10-20). Open: on-chain attester-root
      registry (I8) — until then a no-root epoch is defaultable, and `activate`'s
      funding membership proof is still omitted.
- [x] **H4 (circuit half + Terms commit)** — done (status log 2026-10-20, DD-15):
      `claim` inside `epoch_proof`, private record membership, Terms schema extended.
- [x] **M2 (circuit half)** — done: (a) I5 sign fix; (b) carry-forward
      commitment ledger (status log 2026-10-20). KAT green.
- [x] **M3** — `bond.postBond` takes real shielded custody; release / void / slash move
      real value (status log 2026-10-20, DD-16).
- [x] **M3b** — release tranche schedule: one exact ⌊B·k/E⌋ step per settled epoch,
      to the owner, summing to the bond (DD-18, status log 2026-10-20).
- [~] Proving benchmark / full keygen: sizes measured —
      proveEpoch k=20 / 599 544 rows, claim k=19 / 486 738; **all circuits keyed on the
      final layout** (2026-10-21, after H3b/M3b/C2-on-chain; proveEpoch keygen peaks at
      9.46 GiB RSS — needs a ≥ 12 GB host). Proving-time benchmark still to do.

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
  `bucketsPerEpoch == 48` and ≤ 4 bands (`DEFAULT_CONFIG`). The flow
  commitment is settled by DD-14.

- **DD-14** (M1) `flow_root` is `transientHash<FlowSeries { buy: Vector<48,
  Uint<128>>, sell: Vector<48, Uint<128>> }>` — the hash of the wallet's WHOLE
  dense per-window series (window = 30-min bucket index, 0 = no trade), with no
  per-window tree. The circuit rebuilds it from the full witness, so every window
  is in the I7 sum. Chosen over per-window leaves + paths (the TS-half spec):
  there the prover picks which windows to open and can omit round-trip-heavy
  ones, and aggregating arbitrary window ids across 16 slots in-circuit is
  costly. Windows outside [0, 48) cannot be committed (the indexer throws); the
  oracle, which aggregates any window id, agrees on every committable input.

- **DD-15** (H4) `claim` lives in `epoch_proof.compact` (Compact contracts cannot
  read another contract's ledger) and verifies epochs by **private Merkle
  membership**, not by looking up `epochUptime[H(id, e)]` — that lookup would
  disclose the engagement id and link the MM's profile to the engagement,
  defeating I10's unlinkability. `proveEpoch` appends `EpochRecord { id, epoch,
  uptime, termsCommit }` to `HistoricMerkleTree<20>` `epochRecords` (all fields
  already public); `claim` proves each presented record against a historic root,
  doing the ledger check for all `MAX_EPOCHS = 90` slots unconditionally (absent
  slots reuse the constructor's genesis-record path) so nothing about which
  epochs exist leaks. `termsCommit` in the record binds the threshold and contract
  length to the accepted terms. An MM may withhold a record (only lowering its own
  count) but cannot add one. Claim requires `persistentHash(secret) ==
  engagementId`. Tree depth 20 (~1M records) and 90 slots are the claim circuit's
  size drivers.

- **DD-16** (M3) A defaulted engagement's bond goes to a **beneficiary key fixed
  at `postBond`** (the client — the harmed party), so the MM cannot redirect it
  later. The spec did not name a slash destination; burning
  (`shieldedBurnAddress()`) or a protocol treasury are one-line alternatives.
  Custody makes the bond value public (a contract can only hold a coin it can
  see); the MM's treasury source stays shielded.

- **DD-17** (H3b) **One contract.** Registration and the bond moved into
  `epoch_proof.compact` (after DD-15 did the same for `claim`): Compact 0.31.1
  rejects cross-contract calls, and a gate is only sound if it reads its anchor
  from its own ledger. Chosen over keeping `bond` separate with its own anchors,
  where a settle step could not check that the epoch was proven (an MM could
  "settle" unproven epochs and release the bond), and over merging only
  registration + bond (same flaw). Anchors are written once, bounded to the
  recording block's time (600 s tolerance), and every gate reads them back.
  Default deadlines use the latest possible root publication (epoch end +
  attester timeout), since root publication is not on-chain yet — the most
  lenient anchor for the MM. Cost: the ledger layout change regenerates
  proveEpoch/claim keys once (same k).

- **DD-18** (M3b) **Bond release schedule:** one tranche per **settled** epoch
  (settled = proven under the registered terms, H3b), paid to the bond owner;
  after k released epochs of E, the cumulative release is exactly ⌊B·k/E⌋ (B =
  the posted bond, E = the committed `epochs_total`). Exact rather than "at most",
  so the last epoch carries the remainder and the tranches sum to B with nothing
  stranded in escrow. Uptime does not gate a tranche: the bond secures *honest
  delivery* (I1–I5, I7 hold, or proveEpoch reverts); the uptime KPI goes to the
  public record via `claim`. An epoch that is never settled is defaultable (the
  whole remaining bond is slashed, DD-16). Cost: E becomes public at registration
  (`contractEpochs`) — the tranche size reveals it at the first release anyway,
  since the bond value is public (DD-16), and an engagement's duration is visible
  from its settlements. Chosen over a time-based vesting (would release on time
  passing, not on proofs) and over B/E per epoch with a final sweep (needs a
  separate remainder rule).

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
