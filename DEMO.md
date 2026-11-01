<!--
  DEMO.md — the live demo script. Companion to specs/BUILT_ON_MIDNIGHT.md
  (what it is) and specs/TESTNET_DEPLOY.md (how it was deployed).

  Placeholders marked <!-- FILL: ... --> are dropped in from the live local
  lifecycle run (specs/LIVE_LOCAL_LIFECYCLE.md). Everything else is final.
-->

# mm-reputation — live demo

A privacy-preserving reputation record for crypto **market makers**: an MM proves,
in zero knowledge on **Midnight**, that it met per-epoch delivery terms (depth, uptime,
custody, no round-trips) **without revealing its wallets, balances, or order flow** —
verified against a **deterministic Base + Ethereum indexer** it cannot forge.

> **Two-minute version of *what* and *why*:** [`specs/BUILT_ON_MIDNIGHT.md`](specs/BUILT_ON_MIDNIGHT.md).
> This page is *how to show it running*.

---

## The 90-second story (what a judge sees)

1. **A real on-chain epoch, recomputed deterministically.** We index a genuine Base
   epoch — **BROOMY/WETH 0.3%, 2026-10-21** — end to end, and an independent *watcher*
   rebuilds the exact attested root-of-roots from the published data, with no RPC:
   `0x5a3a6373489512ce231856573012a90e45d2bc2720ce5538b92fc74af1d04461`. Change any one
   published metric by one unit and the root breaks.
2. **The full ZK lifecycle, live, with real proofs and real on-chain calls.** One Compact
   contract runs `register → activate → publishRoot (2-of-3 attesters) → proveFunding →
   proveEpoch → settleEpoch → releaseEpoch → claim`. Every call is a real zero-knowledge
   proof submitted to a real Midnight node; the MM's books never leave the witness.
3. **A public reputation record that can't be traced back.** The claim proves credit for
   each proven epoch by a private Merkle path, so the public profile is **unlinkable** to
   any specific engagement (nullifier-gated, once only).

That is a thing you **cannot build on a transparent chain**.

---

## Demo A — the deterministic indexer + watcher (no wallet, ~5 s)

Shows the real Base epoch and the independent re-verification. Pure computation over
committed fixture data, so it runs anywhere with no network:

```bash
pnpm --filter @mmr/watcher test        # live-epoch KAT: rebuilds + verifies 0x5a3a…04461
```

What to point at:
- `packages/watcher/fixtures/base-8453-broomy-weth-2026-10-21/` — the committed real epoch.
- The KAT re-derives the pool root, the root-of-roots, and **fails on a one-unit tamper**
  of any published metric — i.e. the MM cannot lie about what the chain recorded.

---

## Demo B — the full epoch_proof lifecycle, live on a Midnight node (the hero)

This runs the **entire** contract lifecycle against a real Midnight node (ledger 8.1.3),
with real proofs and real on-chain contract calls — including the time-gated
`settle → release → claim` tail, by advancing the node's block clock past the 24 h epoch
and challenge windows.

```bash
# 1. bring up the local Midnight stack (node 1.0.400 / ledger 8.1.3, indexer, proof server)
#    using packages/dapp/standalone.override.yml
# 2. point the dapp at it, then run the lifecycle:
pnpm --filter @mmr/dapp run interact
```

Lifecycle transcript (real tx hashes + blocks + proof times):

| Step | Circuit | What it proves (in ZK) | tx / block |
|---|---|---|---|
| 1 | `register` | engagement id derived from a secret; wallet + terms committed | <!-- FILL --> |
| 2 | `postBond` | a real **shielded** performance bond escrowed (Zswap) | <!-- FILL --> |
| 3 | `activate` | status → Funded within the 72 h funding window | <!-- FILL --> |
| 4 | `publishRoot` ×2 | 2-of-3 attester committee publishes the epoch root on-chain (I8) | <!-- FILL --> |
| 5 | `proveFunding` | Σ `from_treasury` ≥ loan, opened against the attested root | <!-- FILL --> |
| 6 | `proveEpoch` | **I1–I7 in ZK** (depth, uptime, custody, net-sell, carry, round-trip) — the heavy k=20 proof | <!-- FILL --> |
| 7 | `settleEpoch` | epoch settled after its end + challenge window (block-time gated) | <!-- FILL --> |
| 8 | `releaseEpoch` | one bond tranche released to the MM | <!-- FILL --> |
| 9 | `claim` | public reputation credit by **private Merkle path** — unlinkable (I10) | <!-- FILL --> |

Final on-chain state to show: `publishedRoot[1]`, `fundingProven`, the `epochRecords`
root, and the monotonic public profile counters (`completedCount`, `kpiHits`/`kpiTotal`).

> **Proving benchmark** (real, from this run): `proveEpoch` k=20 ≈ <!-- FILL --> s,
> `claim` k=19 ≈ <!-- FILL --> s. Every proof was accepted by proof-server 8.1.3.

---

## Demo C — also live on the public Preview testnet (supporting)

The same contract is **deployed to Midnight's public Preview testnet** and verifiable on
chain — all 11 circuits, via a batched deploy (the contract is too large for one block, so
8 circuits deploy in one tx and 3 verifier keys are inserted via maintenance updates):

- **Contract:** `48e2cfceccd0a7b771f5bb71337455f2df03540aadcaf0bc3687d310e52d9eb6`
- **Proof** it's fully keyed: an independent indexer query shows **11/11 circuits** on chain;
  `findDeployedContract()` attaches successfully.
- The batched-deploy diagnosis + tooling (`measure-deploy-cost.mjs`, `batch-deploy.ts`) is
  in [`specs/TESTNET_DEPLOY.md`](specs/TESTNET_DEPLOY.md) Phase 3.5.

### Honest note (why the live lifecycle runs locally, not on Preview)

Contract **calls** currently do not get included on Preview, while **deploys** and
maintenance updates from the same wallet/client do. We traced this to the end: the
**identical node binary** (`1.0.400-87c0fbdb`, ledger `=8.1.3`) accepts the same calls on
a **local** node — so it is **not** our contract, our ZK, our compiler, or the ledger
version. It is isolated to our Preview **wallet's DUST/fee structure** (its DUST came from
registration), matching a known `NotNormalized` DUST-action edge case. It is written up
in [`specs/CALL_SUBMISSION_BLOCKER.md`](specs/CALL_SUBMISSION_BLOCKER.md) and escalated to
Midnight. It does not affect the protocol — the byte-identical local node runs the whole
thing — so the hero demo (B) is the live local lifecycle.

---

## Demo D — the public profile UI (optional, ~10 s)

```bash
pnpm --filter web dev        # dark console-dashboard profile + depth/uptime tear sheet
```

Shows the reputation record as a market-maker's counterparty would read it — depth/uptime
hero chart, per-epoch verdicts, no private data exposed.

---

## What's real vs. stubbed (integrity)

Real and verified: the whole Midnight/ZK core (one Compact 0.31.1 contract, all I1–I10
bound in-circuit, ~93 known-answer tests that execute the *compiled* circuit and revert on
any tampered witness), real `zkir` proving/verifying keys, the deterministic indexer, the
independent watcher, the **live Preview deploy**, and — in Demo B — the **full lifecycle
with real on-chain calls**. The IPFS publisher (Pinata v3) and Postgres repository
(`@mmr/db`) are real behind their interfaces. The remaining external adapters (a live Base
archive-RPC reader, real Jubjub-Schnorr attester signing) are clearly-labelled interface
stubs and do not touch the contract logic. Full detail:
[`specs/BUILT_ON_MIDNIGHT.md`](specs/BUILT_ON_MIDNIGHT.md).
