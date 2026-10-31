# Midnight testnet deploy + wallet demo — runbook

> The last big "their tech in action" win: a **live contract on Midnight testnet** +
> a **connect-wallet-and-submit-a-proof** demo, which also produces the project's
> first **real proof instances** (we have keys for all 11 circuits; no live proof has
> run yet). This is a **laptop/testnet runbook** — the cloud session can't reach
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
  (preflight correction: use this, **not** `fetch-zk-config-provider`, which is for
  remote config). It reads `keys/*.prover|.verifier` + `zkir/*.bzkir`.
- `midnight-js-protocol` — ledger types (via `/ledger`)
- `@midnight-ntwrk/compact-js@2.5.1`, `@midnight-ntwrk/platform-js@2.2.4`,
  `@midnight-ntwrk/onchain-runtime-v3@3.0.0`
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
  "@midnight-ntwrk/onchain-runtime-v3": "3.0.0"
} }
```
- `ledger-v8` → 8.1.0: collapses the 8.1.0/8.1.3 copies (`expected instance of` otherwise).
- **`onchain-runtime-v3` → 3.0.0 (do NOT skip this):** pinning it is a documented
  *consumer requirement* when midnight-js sits beside a retained/ledger-8 contract.
  Two copies (3.0.0 + 3.1.2) only work when the contract and midnight-js reach the
  **same** one; if they don't, deploy construction fails with `expected instance of
  ContractMaintenanceAuthority`. The override removes that topology risk entirely.
- `onlyBuiltDependencies` must include **`classic-level`** (native postinstall for the
  LevelDB private-state provider — silently skipped otherwise). Commit the lockfile.

## Phase 2 — Locate the compiled contract module + keys (done, just point at it)

`compact compile` already emitted the contract's generated TS module + keys under
`packages/contracts/dist/epoch_proof` (**`dist/`, not `build/`** — preflight
correction; keys gitignored, loaded by `NodeZkConfigProvider` from `keys/*.prover|.verifier`
+ `zkir/*.bzkir`). The module exports all 11 circuits above (preflight: 11/11
instantiate under `compact-runtime@0.16.0`; no recompile).
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
It reads `<compiled-dir>/keys/*.verifier`, prices a synthetic deploy with the ledger's
own cost model, and prints the exact `bytesWritten` + a batch plan. Run it in a
throwaway dir so its one dep resolves cleanly (ledger-v8 8.1.0 is already our pin):

```sh
mkdir -p /tmp/measure && cd /tmp/measure
npm i @midnight-ntwrk/ledger-v8@8.1.0
cp ~/mm-reputation/packages/dapp/scripts/measure-deploy-cost.mjs .
node measure-deploy-cost.mjs ~/mm-reputation/packages/contracts/dist/epoch_proof
#   exit 0 = fits (problem is elsewhere), 3 = needs batching, 2 = bad input
```

### Fix: batched deploy (deploy a subset, then insert the rest)

The ledger accepts a deploy with only *some* circuits' keys; the remaining keys are
added one per tx with a signed `MaintenanceUpdate` (`VerifierKeyInsert`), via the SDK's
`submitInsertVerifierKeyTx`. Each insert is a flat ~3,003 `bytesWritten` (~6% of a
block) and ~18s, so they always fit. midnight-js 4.1.1 has **no** one-call batched
deploy, so use the runbook's `batch-deploy.ts` (dry-run by default; `execute: true` to
submit). Fetch it verbatim — do not hand-reconstruct it — into `packages/dapp/scripts/`:

```sh
cd ~/mm-reputation/packages/dapp/scripts
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

Only if batching is undesirable: shrink the deploy by making non-ledger helpers
`export pure` / non-exported, or merge near-duplicate circuits (re-keys → recompile).
The measure script's count tells you whether shrinking alone would get under ~60%.

**State after a 1010 rejection:** nothing is committed — no contract address, no DUST
spent (rejected pre-block). The CMA key `batch-deploy.ts` may have stored under an
unused dry-run/failed address is harmless.

## Phase 4 — The scripted happy-path transcript (the demo)

Script the full lifecycle on testnet for one synthetic engagement, printing each tx
hash + the resulting ledger state. Use the **real** root/tree from the committed live
epoch (`packages/watcher/fixtures/`) so the inputs are genuine:

```
deploy(committee of 3)
→ register(tier, now)                         → id
→ postBond(id, tierMin, beneficiary)
→ activate(id, root1, now)                     // root1 = epoch-1 rootOfRoots
→ publishRoot(1, root1, cid) ×2 distinct attesters   // ⇒ publishedRoot[1]
→ proveFunding(id, root1)                       // Σ from_treasury ≥ loan
→ for each proven epoch e:
     publishRoot(e, rootE, cid) ×2  →  proveEpoch(id, rootE, e)  →  settleEpoch(id, e, now)  →  releaseEpoch(id, e, tranche)
→ claim(…)                                      // public reputation record
```

That printed transcript (tx hashes + state transitions) **is** the submission demo,
and each proof is a real instance — it also closes the long-open "proving benchmark"
(record wall-clock per circuit; `proveEpoch` at k=20 is the heavy one).

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
bond, block-time gates, 2-of-3 attester registry). This is what a rushing judge sees.

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
