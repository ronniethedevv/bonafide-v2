# Midnight testnet deploy + wallet demo — runbook

> The last big "their tech in action" win: a **live contract on Midnight testnet** +
> a **connect-wallet-and-submit-a-proof** demo, which also produces the project's
> first **real proof instances** (we have keys for all 11 circuits; no live proof has
> run yet). This is a **laptop/testnet runbook** — this cloud session can't reach
> Midnight hosts (proxy-blocked), so every SDK-specific line below is **[verify]**:
> confirm the current package, version, endpoint, and API shape against
> https://docs.midnight.network before wiring, and **never assume an API — check it,
> run it against testnet, and only then commit**. No mocking.

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

- [ ] **A Midnight-capable wallet.** Lace with Midnight support (browser), *and* a
      seed/headless wallet for the scripted deploy (so the deploy script can sign
      without clicking). **[verify current wallet + how to get a headless seed]**
- [ ] **tDUST** (testnet gas) from the Midnight faucet into that wallet. **[verify
      faucet URL + how much you need for ~15 proof-bearing txs]**
- [ ] **The proof server running locally.** Midnight ships it as a Docker image; it
      generates proofs client-side at submit time. Needs Docker on the laptop.
      **[verify image name + port]**
- [ ] **Testnet endpoints:** node (substrate/RPC) URL + indexer (GraphQL/pubsub) URL.
      **[verify current URLs]**
- [ ] Node 22 + the repo toolchain (already on the laptop).

Put the non-secret ones in `packages/dapp/.env` (gitignored): `MIDNIGHT_NODE_URL`,
`MIDNIGHT_INDEXER_URL`, `PROOF_SERVER_URL`, and the deploy seed in `DEPLOY_SEED`
(gitignored, never committed — golden rule).

## Phase 1 — Confirm the SDK against live docs ([verify], before writing code)

Already used: `@midnight-ntwrk/compact-runtime`. The dApp layer additionally needs,
**confirm exact names + versions on npm/docs** (do not trust this list blindly):
- `@midnight-ntwrk/midnight-js-*` — contract providers + tx builder
- `@midnight-ntwrk/wallet` + `@midnight-ntwrk/wallet-api`
- `@midnight-ntwrk/dapp-connector-api` — browser wallet connect
- `@midnight-ntwrk/ledger`, `@midnight-ntwrk/zswap`

Pin versions you actually install; add them to `onlyBuiltDependencies` in the root
`package.json` if any has a native postinstall, and commit the lockfile.

## Phase 2 — Locate the compiled contract module + keys (done, just point at it)

`compact compile` already emitted the contract's generated TS module + keys under
`packages/contracts/build/epoch_proof` (keys gitignored). Confirm the module exports
all 11 circuits above and that the keys are the final-layout regen (DD keygen).
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
  real minutes on a laptop proof server. Budget for it; the demo can pre-generate the
  slow proofs and submit live, but say so.
- **[verify] everything SDK:** package names, versions, endpoints, the faucet URL,
  the proof-server image, and every provider/connector API shape change with the
  testnet. Confirm against docs.midnight.network and run it before committing; don't
  ship SDK code that hasn't touched testnet.
- **Secrets:** deploy seed + committee secrets live in a gitignored `.env`, never
  committed.
- **Suggested order:** (1) proof server up + wallet funded, (2) `@mmr/dapp` deploy,
  (3) scripted happy-path transcript, (4) web wallet-connect, (5) recorded demo.
