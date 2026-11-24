# Midnight testnet deploy + wallet demo — runbook

> **History.** This runbook was written for the ledger 8 Preview chain and its 11-circuit
> contract. The contract now targets ledger 9 (Compact 0.36.1, 12 circuits); the current
> deployment, its record and the commands are in the [README](../README.md) and
> [DEMO.md](../DEMO.md).

> The last big "their tech in action" win: a **live contract on Midnight testnet** +
> a **connect-wallet-and-submit-a-proof** demo, which also produces the project's
> first **real proof instances** (we have keys for all 11 circuits; no live proof has
> run yet). This is a **laptop/testnet runbook** — the CI sandbox can't reach
> Midnight hosts (proxy-blocked); the specifics below were **confirmed against the
> Preview support matrix** (docs.midnight.network, Oct 2026) and are pinned, not
> guessed. Still: **run each step before committing SDK code**, and `npm view` each
> pin installs before relying on it (one pin — `@midnightntwrk/wallet-sdk` — has an
> unusual scope, see Phase 0). No mocking.
>
> **Target network: Preview** (testnet-02 is retired). Direct public endpoints, no
> API key. **Key de-risk:** Preview runs **ledger 8** (`compact-runtime 0.16.0`),
> which is exactly what our contract is compiled + keyed against — so **no recompile,
> no re-keygen**. Do **not** move to `compact-runtime 0.19/0.20` (ledger 9): those
> would fail to deploy on Preview. (Double-check: our devtools `compact` was 0.5.3; the
> matrix lists 0.5.1 — confirm the emitted module + keys load on Preview, recompile
> with the matrix toolchain only if they don't.)

## Step 0 — back up the keyset BEFORE anything touches `compact` (do this first)

The ~525 MB keyset (`packages/contracts/dist/epoch_proof/keys` + `zkir`) is
**gitignored and took ~34 min / 9.5 GB to generate** — it is not recoverable from
git. Copy it somewhere safe (another dir / drive) **before** any step that could
run `compact` again (e.g. the open `--skip-zk` question). Losing it is the only
expensive mistake available here, and it's fully avoidable.

## The contract, as it is now (11 circuits, keyed)

`packages/contracts/src/epoch_proof.compact`, all keyed (final keygen DD, `k`: proveEpoch 20,
claim 19, proveFunding 17, releaseEpoch/register/… , publishRoot 14):

| Circuit | Signature | Role |
|---|---|---|
| `constructor` | `(members: Vector<3, Bytes<32>>)` | fixes the 2-of-3 attester committee at deploy |
| `register` | `(declaredTier, registeredTs) → id` | opens an engagement |
| `postBond` | `(id, tierMin, beneficiary)` | escrows the shielded USDM bond |
| `activate` | `(id, rootOfRoots, activatedTs)` | funding window → Funded; records `activatedAt` |
| `publishRoot` | `(epoch, root, cid)` | an attester votes a root; 2-of-3 ⇒ `publishedRoot[epoch]` |
| `proveFunding` | `(id, rootOfRoots)` | loan landed: Σ from_treasury ≥ loan, vs `publishedRoot[1]` |
| `proveEpoch` | `(id, rootOfRoots, epoch)` | the delivery proof (I1–I7, I9), vs `publishedRoot[epoch]` |
| `settleEpoch` | `(id, epoch, settledTs)` | records settlement; needs published root + funding proven |
| `releaseEpoch` | `(id, epoch, amount)` | pays a bond tranche to the MM |
| `voidUnfunded` / `defaultEngagement` | `(id[, epoch])` | unwind paths |
| `claim` | `(…)` | emits the public, unlinkable reputation record (I10) |

Every one of these generates a **real ZK proof** via the proof server when submitted —
that transcript *is* the demo and *is* the first real proof instances.

---

## Phase 0 — Human-only prerequisites (gather first; a person must do these)

The laptop agent can't create a wallet, pass a faucet captcha, or install browser
extensions for you. Do these, then hand the agent the endpoints/paths (never paste a
seed phrase into chat — put it in a gitignored `.env`).

- [ ] **Lace wallet** (Chrome extension, Midnight built-in). Create it, back up the
      24-word mnemonic, switch Network → **Preview**, copy the Midnight unshielded
      address (`mn_addr_preview…`). The same mnemonic is the headless deploy seed.
- [ ] **Fund it: tNIGHT → tDUST (two steps).** The faucet
      (`https://midnight-tmnight-preview.nethermind.dev/`) dispenses **tNIGHT**, not
      tDUST. After receiving tNIGHT, **register the tNIGHT UTXOs to designate a DUST
      address**, which then **accrues tDUST over time** to pay fees. Fund early and
      wait for a non-zero tDUST balance before deploying.
- [ ] **Proof server** (Docker): `docker run -p 6300:6300 midnightntwrk/proof-server:8.1.3`
      — confirm with `curl http://localhost:6300`. (Note the **unhyphenated** image
      scope `midnightntwrk`.)
- [ ] Node 22 + the repo toolchain (already on the laptop) + Docker.

Put the non-secrets in `packages/dapp/.env` (gitignored), and the mnemonic in
`DEPLOY_SEED` (gitignored, never committed — golden rule):
```
MIDNIGHT_NODE_URL=https://rpc.preview.midnight.network
MIDNIGHT_INDEXER_URL=https://indexer.preview.midnight.network/api/v4/graphql
MIDNIGHT_INDEXER_WS_URL=wss://indexer.preview.midnight.network/api/v4/graphql/ws
PROOF_SERVER_URL=http://localhost:6300
NETWORK_ID=preview
DEPLOY_SEED=<24-word-mnemonic-never-commit>
```

## Phase 1 — SDK packages (Preview support matrix, confirmed — pin these)

We already have `@midnight-ntwrk/compact-runtime@0.16.0` ✅ (ledger 8, Preview-correct).
Add to **`packages/dapp` (`@mmr/dapp`)**, all `@midnight-ntwrk/midnight-js-*` at **4.1.1**:
- `midnight-js-contracts` — deploy + call; `midnight-js-types`; `midnight-js-network-id`
  (`setNetworkId('preview')`); `midnight-js-utils`
- `midnight-js-indexer-public-data-provider` — read public contract state
- `midnight-js-level-private-state-provider` — persist private state (LevelDB)
- `midnight-js-http-client-proof-provider` — talk to the local proof server
- `midnight-js-node-zk-config-provider` — load the **local** keys for headless deploy
  (use this, **not** `fetch-zk-config-provider`, which is for remote config). It reads
  `keys/*.prover|.verifier` + `zkir/*.bzkir`.
- `midnight-js-protocol` — ledger types (via `/ledger`)
- `@midnight-ntwrk/compact-js@2.5.1`, `@midnight-ntwrk/platform-js@2.2.4`,
  `@midnight-ntwrk/onchain-runtime-v3@3.1.2` (ledger-8.1.3 paired — see override note below)
- **`@midnightntwrk/wallet-sdk@1.2.0`** — headless seed signing. **Note the
  unhyphenated scope `@midnightntwrk`** (not `@midnight-ntwrk`); `npm view` it first —
  if it's not on public npm, find the documented install path before wiring.
- dev: `@midnight-ntwrk/testkit-js@4.1.1`

For **`apps/web` (wallet-connect)**: `@midnight-ntwrk/dapp-connector-api@4.0.1` +
`@midnight-ntwrk/midnight-js-dapp-connector-proof-provider@4.1.1`.

**Do NOT install** (confirmed wrong/obsolete): `@midnight-ntwrk/wallet` &
`@midnight-ntwrk/wallet-api` (obsolete legacy → use `wallet-sdk`); `@midnight-ntwrk/ledger`
& `@midnight-ntwrk/zswap` (zswap types now live inside `ledger-v8`, which midnight-js
pins internally at `8.1.0`); the `@midnight-ntwrk/midnight-js` barrel (install the individual `-*`
packages).

**Native-copy pins (confirmed against the Midnight toolchain-mismatch runbook) — use
`pnpm.overrides`, not top-level `overrides` (pnpm reads the former):**
```jsonc
"pnpm": { "overrides": {
  "@midnight-ntwrk/ledger-v8": "8.1.0",
  "@midnight-ntwrk/onchain-runtime-v3": "3.1.2"
} }
```
- `ledger-v8` → 8.1.0: collapses the 8.1.0/8.1.3 copies (`expected instance of` otherwise).
  Keep it at 8.1.0 — the 8.1.3 release notes say a midnight-js 4.1.1 project must not bump it.
- **`onchain-runtime-v3` → 3.1.2 (do NOT skip, and NOT 3.0.0):** pinning to one copy is a
  documented *consumer requirement* (two copies → `expected instance of` on a call), and the
  version must be **3.1.2**, the runtime paired with ledger 8.1.3 (what the live node runs).
  3.0.0 dedupes but builds a non-canonical call transcript the 8.1.3 node rejects with
  `117 NotNormalized`. Full two-fault rationale is in **Phase 3.6** below.
- `onlyBuiltDependencies` must include **`classic-level`** (native postinstall for the
  LevelDB private-state provider — silently skipped otherwise). Commit the lockfile.

## Phase 2 — Locate the compiled contract module + keys (done, just point at it)

`compact compile` already emitted the contract's generated TS module + keys under
`packages/contracts/dist/epoch_proof` (**`dist/`, not `build/`**; keys gitignored,
loaded by `NodeZkConfigProvider` from `keys/*.prover|.verifier` + `zkir/*.bzkir`). The
module exports all 11 circuits above (11/11 instantiate under `compact-runtime@0.16.0`;
no recompile).
`packages/contracts/test/harness.ts` shows how to assemble each circuit's witnesses
and run it via `compact-runtime` — **reuse that witness assembly verbatim** for real
txs (the hard part — I1–I10 openings — is already written there).

## Phase 3 — New package `@mmr/dapp` (deploy + interact)

1. **Providers** — one `MidnightProviders` object (all six required slots:
   `privateStateProvider`, `publicDataProvider`, `zkConfigProvider` (NodeZkConfigProvider),
   `proofProvider`, `walletProvider`, `midnightProvider`; `loggerProvider` optional).
   **The same providers object is passed to deploy and every call.**
2. **CompiledContract** — `CompiledContract.make("epoch_proof", Contract).pipe(
   CompiledContract.withWitnesses(w), CompiledContract.withCompiledFileAssets(zkPath))`.
   Import `CompiledContract` from `@midnight-ntwrk/midnight-js-protocol/compact-js`,
   ledger types from `.../ledger`. **`.pipe` form, not nested** (nested fails to
   type-check on 4.1.1). (preflight: `new Contract(witnesses)` is wrong for 4.1.1.)
3. **Committee keys (demo)** — generate 3 attester secrets, derive their `Bytes<32>`
   ids, pass them as the `constructor` arg (ledger field is `committee`). ⚠ For the
   demo they're deterministic (KAT fill) → **publicly derivable, anyone could publish
   roots** — fine for a demo *with the caption*, but real random secrets before this
   is more than a demo.
4. **Deploy** — `deployContract(providers, { compiledContract, privateStateId,
   initialPrivateState, args: [committee] })`; address = `deployed.deployTxData.public.contractAddress`.
   Invoke via **`pnpm --filter @mmr/dapp run deploy`** (bare `deploy` is a pnpm
   built-in and never reaches the script — preflight). Write the address to a
   gitignored file.
5. **Interact** — reattach with `findDeployedContract(providers, { contractAddress,
   compiledContract, privateStateId, initialPrivateState })`, then call each circuit
   as **`found.callTx.<circuit>(args)`** — that single call builds + proves + balances
   + submits and returns `{ public: { txId, blockHeight } }`. **No manual
   `UnboundTx → balanceTx → submitTx`** (that low-level handle flow is a 5.0.0 concern,
   not needed for 4.1.1 contract calls — the open question is resolved). Private inputs
   come from `@mmr/indexer` (real BROOMY/WETH `rootOfRoots` + tree), `@mmr/prover`
   (openings), `@mmr/watcher` (claim plan). **Note (ledger 8):** `findDeployedContract`
   has a retained-era overload that takes the raw contract instance; confirm the attach
   path against the live node.
6. **Proof-server sanity check BEFORE the heavy `proveEpoch`:** prove one *cheap*
   circuit first (e.g. `register`) to confirm proof-server 8.1.3 accepts our
   `zkir/*.bzkir` ZKIR format. A ZKIR-version mismatch fails *at the proof server* —
   catch it on a 10-second proof, not after minutes of `proveEpoch`.
7. **Read state** — query the indexer for `status`, `publishedRoot`, `epochRecords`
   root, profile counters, to confirm each tx landed.

## Phase 3.5 — If the deploy is rejected with 1010 "would exhaust the block limits"

**Observed 2026-10-31 on Preview.** The deploy proved fine (~1.8s) and was balanced,
then the node rejected it at submission with:

```
1010: Invalid Transaction: Transaction would exhaust the block limits
```

This is **not** a proof, fee, funding or balance problem (all were ruled out live).
It is the documented **oversized-contract deploy**: a deploy carries **one verifier
key per exported circuit**, and together they overflow the per-block write budget.
Confirmed against the Midnight docs (servicedesk `contract-batched-deploy-runbook`
and docs.midnight.network `decode-1010-transaction-rejection-errors`), pinned to our
exact stack (midnight-js 4.1.1 → ledger-v8 8.1.0, compact-runtime 0.16.0).

Root cause (verbatim from the runbook):
- Per-block `block_limits.bytesWritten` = **50,000** (same on mainnet/preprod/preview).
- A deploy writes ≈ **1.2 × total verifier-key bytes**, plus the constructor's ledger
  data (our `committee` Vector + the vote/count/publishedRoot maps' initial state).
- A single tx may use only **~60–65%** of a block (Substrate `NORMAL_DISPATCH_RATIO`
  75% minus overheads). Measured live on node 0.22.1: 62.6% included, 68.1% rejected
  with 1010. So a deploy can be under 100% of the block and still be rejected.
- **A blind re-run fails identically** — this is deterministic, not a flake.

### Diagnose (offline, no node/wallet/proof-server — risk-free)

`packages/dapp/scripts/measure-deploy-cost.mjs` (verified runbook script, committed).
It reads `<compiled-dir>/keys/*.verifier`, prices a *synthetic* deploy with the ledger's
own cost model, and prints `bytesWritten` + a batch plan. Run it in a throwaway dir so
its one dep resolves cleanly (ledger-v8 8.1.0 is already our pin):

```sh
mkdir -p /tmp/measure && cd /tmp/measure
npm i @midnight-ntwrk/ledger-v8@8.1.0
cp ~/bonafide-v2/packages/dapp/scripts/measure-deploy-cost.mjs .
node measure-deploy-cost.mjs ~/bonafide-v2/packages/contracts/dist/epoch_proof
#   exit 3 = needs batching, 0 = synthetic fits (NOT conclusive — see below), 2 = bad input
```

> ⚠ **The synthetic measure can rule batching IN (exit 3) but NOT out (exit 0).** It
> builds the deploy with an **empty** initial ledger state, so it omits the
> constructor's data. For `epoch_proof` that data is large — the `committee`
> `Vector<3, Bytes<32>>` plus the `rootVote` / `rootVoteCount` / `publishedRoot`
> maps — and it is exactly what tips us over. **Measured 2026-10-31:** the synthetic
> script reported `bytesWritten 26153` for all 11 circuits and exit 0 ("fits"), but
> the **real** deploy tx (next section, dry run) hit `bytesWritten 30405 > 30000` at
> just **9** circuits. So the raw 22,541 VK bytes were never the problem; the
> constructor state was. **`batch-deploy.ts`'s dry run is the authoritative check** —
> it prices the real `createUnprovenDeployTx` output (constructor included). Trust it
> over the synthetic measure whenever the contract has a non-trivial constructor.

### Fix: batched deploy (deploy a subset, then insert the rest)

The ledger accepts a deploy with only *some* circuits' keys; the remaining keys are
added one per tx with a signed `MaintenanceUpdate` (`VerifierKeyInsert`), via the SDK's
`submitInsertVerifierKeyTx`. Each insert is a flat ~3,003 `bytesWritten` (~6% of a
block) and ~18s, so they always fit. midnight-js 4.1.1 has **no** one-call batched
deploy, so use the runbook's `batch-deploy.ts` (dry-run by default; `execute: true` to
submit). Fetch it verbatim — do not hand-reconstruct it — into `packages/dapp/scripts/`:

```sh
cd ~/bonafide-v2/packages/dapp/scripts
curl -fsSLO https://raw.githubusercontent.com/midnightntwrk/servicedesk/main/runbooks/contract-batched-deploy-runbook/scripts/batch-deploy.ts
curl -fsSLO https://raw.githubusercontent.com/midnightntwrk/servicedesk/main/runbooks/contract-batched-deploy-runbook/scripts/batch-deploy.NOTES.md
```

Wire it with our existing `buildProviders` / `compiledEpochProof` / `emptyPrivateState`
(same objects `deploy.ts` uses) and the `[committee]` constructor arg. Then:
1. **Dry run** (default): prints how many of the 11 circuits fit in batch 1 and how
   many single-insert txs follow. Submits nothing.
2. **Execute** (`execute: true`): batch 1 is the subset deploy (CMA signing key +
   initial private state are persisted **before** submit — back up the private-state
   store; without that key the remaining circuits can never be added), then one
   `submitInsertVerifierKeyTx` per remaining circuit, sequentially.
3. Use `priorityCircuits` to land `register` first (the cheap proof-server sanity
   check in Phase 3 step 6 needs a keyed circuit).
4. **Resumable:** if interrupted, re-run with `contractAddress: '<printed address>'`;
   it inserts only the circuits still missing on chain. If unsure whether batch 1
   landed, dry-run with that `contractAddress` first — never blind re-run with
   `execute: true` (it samples a new nonce and deploys a *second* partial contract).
5. When all 11 keys are in, `findDeployedContract()` works as normal and Phase 4
   proceeds unchanged.

**Measured plan for `epoch_proof` (2026-10-31 dry run, 60% headroom):**
- **Batch 1 — subset deploy, 8 circuits:** `register`, `proveEpoch`, `claim`,
  `activate`, `postBond`, `settleEpoch`, `releaseEpoch`, `voidUnfunded`. Stops at
  `defaultEngagement` (`bytesWritten 30405 > 30000`). `register` lands in batch 1, so
  the Phase 3 step-6 proof-server sanity check works before the inserts finish.
- **Batches 2–4 — 3 single inserts:** `defaultEngagement`, `publishRoot`, `proveFunding`.
- **4 transactions total.** ~25 min wallet sync before the first tx, then ~18s per
  insert. The dry-run contract address is re-sampled on execute — use the one the
  `execute: true` run prints, not the dry-run one.
- **Before `execute: true`, back up the private-state LevelDB store**
  (`mmr-epoch-proof-private-state`): the CMA signing key is written there before
  batch 1 submits, and losing it leaves a permanently half-keyed contract that can
  never be completed. Our wrapper reads `MMR_BATCH_EXECUTE=1` to submit and
  `MMR_BATCH_CONTRACT_ADDRESS=<printed address>` to resume after an interruption.

Only if batching is undesirable: shrink the deploy by making non-ledger helpers
`export pure` / non-exported, or merge near-duplicate circuits (re-keys → recompile).
Check the real `batch-deploy.ts` dry run (not the synthetic measure) to see whether
shrinking alone would get the full deploy under ~60%; for `epoch_proof` the real tx is
~30.4 KB at 9 circuits, so dropping to 8 keyed circuits wouldn't fit all 11 anyway.

**State after a 1010 rejection:** nothing is committed — no contract address, no DUST
spent (rejected pre-block). The CMA key `batch-deploy.ts` may have stored under an
unused dry-run/failed address is harmless.

## Phase 3.6 — If a contract CALL fails with "expected instance of StateValue / ContractMaintenanceAuthority"

**Observed 2026-10-31**, on the first `register` call after a successful deploy:

```
Error: Unexpected error executing scoped transaction '<unnamed>':
  Error: expected instance of StateValue
    at _assertClass (onchain-runtime-v3@3.0.0/…_wasm_bg.js)
    at new ChargedState (onchain-runtime-v3@3.0.0/…_wasm_bg.js)
    at TransactionContextImpl.[…MergeUnsubmittedCallTxData] (midnight-js-contracts@4.1.1)
```

Not a witness or contract problem — it fails in midnight-js's `MergeUnsubmittedCallTxData`
on the **ledger state**, before any proving. It is the documented
**duplicate on-chain-runtime** issue (servicedesk `toolchain-version-mismatch-runbook`,
`consumer-e2e`): the contract (via `compact-runtime@0.16.0`, which asks `^3.0.0`) and
midnight-js (via `midnight-js-protocol@4.1.1`, which pins exactly `3.0.0`) resolve to
**two physical copies** of `@midnight-ntwrk/onchain-runtime-v3`. A WASM class from one
copy rejects an object minted by the other (`compact-runtime` mints the `StateValue`, so
`ChargedState` must come from the same copy). The deploy survives it; a **call** does not.

**The copy that must be shared is `onchain-runtime-v3`, not `compact-runtime`** (two
`compact-runtime` copies are fine if both reach one `onchain-runtime-v3`).

**Fix (applied):** force one physical copy via root `pnpm.overrides`, at **3.1.2** — the
on-chain-runtime paired with **ledger 8.1.3**, which is what the live Preview node runs
(`midnight_ledgerVersion → =8.1.3`; official table: 8.1.3 ↔ onchain-runtime 3.1.2 ↔ ZKIR
2.1.1).

> **Why 3.1.2 specifically — there are two distinct faults, and only 3.1.2 clears both:**
> 1. **`expected instance of StateValue`** (two copies of the runtime) → needs a *single*
>    copy. Any single copy fixes this; the call then reaches the node.
> 2. **`1010: Custom error: 117 NotNormalized`** → the node runs ledger 8.1.3, whose
>    security fix (GHSA-wr7g-rr4v-jmj8) rejects a contract-call transcript that isn't in
>    canonical form. The 3.0.x runtime is paired with ledger 8.0.x; its transcript builder
>    predates that canonicalization, so an 8.1.3 node rejects its calls. Only the
>    node-aligned **3.1.2** builder produces a transcript the 8.1.3 node accepts.
>
> So the single copy must be **3.1.2** (node-aligned builder → canonical transcript),
> keeping `ledger-v8` at **8.1.0** (the copy midnight-js 4.1.1 uses — the 8.1.3 release
> notes' Known Issues say a 4.1.1 project must NOT bump ledger-v8, or a second copy clashes
> with `expected instance of`). Pinning a single `onchain-runtime-v3` on the 3.1.x line is
> the documented consumer pattern (`consumer-e2e`).

```jsonc
// package.json (workspace root)
"pnpm": { "overrides": {
  "@midnight-ntwrk/ledger-v8": "8.1.0",            // keep: midnight-js 4.1.1's ledger copy
  "@midnight-ntwrk/onchain-runtime-v3": "3.1.2"    // single shared copy; ledger-8.1.3 paired
} }
```

After pulling: `pnpm install` (relinks to one copy — verify with
`grep -oE "onchain-runtime-v3@[0-9.]+" pnpm-lock.yaml | sort -u` → only `3.1.2`, or
`pnpm why @midnight-ntwrk/onchain-runtime-v3`). The on-chain contract is unaffected (this
is purely a local node_modules dedupe); the private-state LevelDB store is untouched.

**If `register` still 117s after the 3.1.2 override:** the fault is then the *contract
transcript itself*, not the runtime version — the `dist/epoch_proof` keys came from an
external full `compact compile` (the in-repo `compact:build` is stubbed for a GPU node),
and an older compiler can emit a `noop 0` or a non-canonical field that 8.1.3 rejects. In
that case recompile with the matrix compiler (Compact 0.31.x) and re-key, rather than
touching the runtime pin again.

> **ZKIR note — still unretired after this fix.** The `register` call reaching the proof
> server is the *point* of the Phase 3 step-6 sanity check: a ZKIR-version mismatch fails
> **at the proof server** (`Failed Proof Server response … code 400 "bad input"`), not
> here. Our proof server is 8.1.3; the matrix lists 8.1.0, which reads ZKIR **v2**
> (`ir-source[v2]`) and rejects v3. If `register` 400s at the proof server, the circuits
> were compiled with `--feature-zkir-v3` — recompile **without** it (ZKIR v2) and retry.
> Catch this on the cheap `register` proof, before the heavy `proveEpoch`.

## Phase 4 — The scripted interact transcript (the demo)

Implemented in **`packages/dapp/src/interact.ts`** (`pnpm --filter @mmr/dapp run interact`).
It reattaches to the deployed contract with `findDeployedContract`, stages each circuit's
witnesses into the private state, and calls `found.callTx.<circuit>(...)`, printing each tx
hash + block.

**The lifecycle splits on the real block-time gates** (confirmed from the circuit source):

- **Live-submittable in one session** (no epoch-end gate — each a real proof + tx):

  ```
  register(tier=1, now) → id
  [opt] postBond(id, tierMin, beneficiary)        // needs a real escrow coin (Zswap)
  activate(id, root, now)                          // Registered → Funded; within 72h window
  publishRoot(1, root, cid) ×2 distinct attesters  // ⇒ publishedRoot[1]
  proveFunding(id, root)                            // Σ from_treasury ≥ loan_L0
  proveEpoch(id, root, 1)                           // the heavy k=20 delivery proof (I1–I7)
  ```

- **Time-gated — NOT runnable now** (`settleEpoch` asserts `blockTimeGte(epochEnd)`,
  `epochEnd = activatedAt + e×86400` = 24h; H3 forbids backdating activation):
  `settleEpoch → releaseEpoch → claim`. Re-run `interact.ts` ~24h after activation (then
  after each challenge window), or exercise them in the time-advancing KAT suite, which
  sets the block clock. This is the real schedule, not a demo gap.

**Timestamps must be real wall-clock `now`** (H3 10-min tolerance) — not the KAT's fixed
block time. **Committee alignment:** `interact.ts` derives the attester secrets with the
same `committee.ts generateAttesterSecrets(3)` the deploy used, so the 2-of-3 `publishRoot`
votes authenticate against the on-chain committee (membership is proven by the
`attesterSecret` witness, not the tx signer — one wallet casts both votes).

**Data provenance (the honest caption).** The contract, the attester registry, and every
proof are real and on Preview. The Merkle tree + openings are built by the same
`@mmr/merkle`/`@mmr/prover`/`@mmr/indexer` code the KATs verify (`buildScenario`, reused via
the new `@mmr/contracts/harness` export) — **not mocked**; only the *market numbers* are an
engineered-compliant scenario, because a passing `proveEpoch` needs the per-wallet
depth/flow witness **pre-images**, which are the MM's private data and are deliberately not
in any public artifact. The determinism of the real Base BROOMY/WETH epoch (rootOfRoots
`0x5a3a6373…04461`) is attested separately by the committed watcher KAT. `interact.ts` has a
**bonus step** (`MMR_PUBLISH_REAL_ROOT=1`) that publishes that genuine live root into the
on-chain registry, so the real indexed root is demonstrably accepted by the deployed
committee.

The printed transcript (tx hashes + state transitions) **is** the submission demo, and also
closes the long-open proving benchmark (wall-clock per circuit; `proveEpoch` is the heavy
one). `interact.ts` carries `LAPTOP-VERIFY` markers on the few midnight-js 4.1.1 runtime-API
shapes that can't be typechecked in the cloud (callTx witness threading, the `register`
return accessor for the id, the `postBond` coin encoding) — confirm them on first run.

## Phase 5 — Wallet connect in `apps/web`

Add a Lace/Midnight connect flow (`dapp-connector-api`) and **one real action** — e.g.
"Submit this epoch's delivery proof" — that assembles the witness, proves via the
proof server, and submits through the connected wallet. Show the returned tx + the
updated on-chain record by replacing that one view's fixture read with a live indexer
read. The restyled UI (dark console look) already gives it a presentable surface.
**[verify connector API]**

## Phase 6 — Demo artifact

Record the end-to-end run (connect wallet → submit proof → on-chain record updates) +
a one-paragraph "what Midnight tech this exercises" caption pointing at
`BUILT_ON_MIDNIGHT.md` (witness/disclose, transientHash, HistoricMerkleTree, Zswap
bond, block-time gates, 2-of-3 attester registry). That caption is the one-glance
summary of what the run exercises.

## Gotchas / honesty notes

- **Proof time:** `proveEpoch` (k=20, ~600k rows) is heavy; a single proof can take
  real minutes on a laptop proof server — **raise the default ~5-min proof timeout**
  (preflight blocker). The demo can pre-generate the slow proofs and submit live, but
  say so.
- **Last unverified Phase-3 link (verify via docs, don't guess):** on midnight-js
  4.1.1, the exact contract-**call** sequence (`UnboundTransaction → balanceTx →
  submitTx`) and whether `callTx`/`findDeployedContract` take the same providers
  object. Confirm against the docs/kapa MCP before wiring `interact`; everything else
  is confirmed against real package contents.
- **testkit-js dep scope:** keep `@midnight-ntwrk/testkit-js@4.1.1` a devDependency.
- **[verify] everything SDK:** package names, versions, endpoints, the faucet URL,
  the proof-server image, and every provider/connector API shape change with the
  testnet. Confirm against docs.midnight.network and run it before committing; don't
  ship SDK code that hasn't touched testnet.
- **Secrets:** deploy seed + committee secrets live in a gitignored `.env`, never
  committed.
- **Suggested order:** (1) proof server up + wallet funded, (2) `@mmr/dapp` deploy,
  (3) scripted happy-path transcript, (4) web wallet-connect, (5) recorded demo.
