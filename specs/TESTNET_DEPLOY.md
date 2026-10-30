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
packages). **ledger-v8 fix (preflight):** two copies (8.1.0 + 8.1.3) otherwise cause
`instanceof` errors — collapse them with a root **`"overrides": { "@midnight-ntwrk/ledger-v8":
"8.1.0" }`** rather than adding it as a dep. Commit the lockfile; add any package with
a native postinstall to root `onlyBuiltDependencies`.

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

1. **Providers** — wire the midnight-js providers to the testnet node + indexer + the
   local proof server. **[verify provider wiring]**
2. **Committee keys (demo)** — generate 3 attester secrets, derive their
   `Bytes<32>` ids (same scheme the harness uses), pass them to the `constructor`.
   The interact layer holds all 3 for the demo (a real committee would be 3 separate
   parties); note this clearly in the demo caption.
3. **Deploy** — submit the deploy tx, capture the contract address. `pnpm --filter
   @mmr/dapp deploy`, writes the address to a gitignored file.
4. **Interact** — one function per circuit that builds + submits the tx, feeding
   private inputs from the existing stack: `@mmr/indexer` (the live BROOMY/WETH epoch
   already produces a real `rootOfRoots` + published tree), `@mmr/prover` (openings),
   `@mmr/watcher` (claim plan). Each call proves via the proof server and submits.
5. **Read state** — query the indexer for `status`, `publishedRoot`, `epochRecords`
   root, profile counters, to confirm each tx landed.

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
