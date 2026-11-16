<!--
  DEMO.md — how to run and independently verify each part of the system.
  Companion to specs/BUILT_ON_MIDNIGHT.md (what it is and why) and
  specs/TESTNET_DEPLOY.md (how it was deployed). Block numbers in Demo B1 are
  from the live local lifecycle run in specs/LIVE_LOCAL_LIFECYCLE.md
  (contract e45ab713…97ce, 2026-11-01).
-->

# Running and verifying mm-reputation

A privacy-preserving reputation record for crypto **market makers**. A market maker
proves, in zero knowledge on **Midnight**, that it met per-epoch delivery terms —
depth, uptime, custody, no round-trips — **without revealing its wallets, balances,
or order flow**, measured against a **deterministic Base + Ethereum indexer** it
cannot forge.

For what the system is and why it needs Midnight, see
[`specs/BUILT_ON_MIDNIGHT.md`](specs/BUILT_ON_MIDNIGHT.md). This page is how to run
each part and check the results independently.

---

## What the system proves

1. **A real on-chain epoch, recomputed deterministically.** A genuine Base epoch —
   BROOMY/WETH 0.3%, 2026-10-21 — is indexed end to end, and an independent *watcher*
   rebuilds the exact attested root-of-roots from the published data, with no RPC:
   `0x5a3a6373489512ce231856573012a90e45d2bc2720ce5538b92fc74af1d04461`. Changing any
   single published metric by one unit breaks the root.
2. **The full ZK lifecycle, with real proofs and real on-chain calls.** One Compact
   contract runs `register → activate → publishRoot (2-of-3 attesters) → proveFunding
   → proveEpoch → settleEpoch → releaseEpoch → claim`. Each call is a real
   zero-knowledge proof submitted to a real Midnight node; the market maker's books
   never leave the witness.
3. **A public reputation record that cannot be traced back.** The claim proves credit
   for each proven epoch by a private Merkle path, so the public profile is
   **unlinkable** to any specific engagement (nullifier-gated, once only).

These three properties cannot be built on a transparent chain.

---

## Demo A — deterministic indexer + watcher (no wallet, ~5 s)

Reproduces the real Base epoch and re-verifies it independently. This is pure
computation over committed fixture data, so it runs anywhere with no network:

```bash
pnpm --filter @mmr/watcher test        # live-epoch KAT: rebuilds + verifies 0x5a3a…04461
```

What it checks:

- `packages/watcher/fixtures/base-8453-broomy-weth-2026-10-21/` holds the committed
  real epoch.
- The test re-derives the pool root and the root-of-roots, and **fails on a one-unit
  tamper** of any published metric — so a market maker cannot lie about what the chain
  recorded.

---

## Demo B — the epoch_proof lifecycle, live on a Midnight node + KAT-verified

Runs the contract lifecycle against a real Midnight node (ledger 8.1.3) with real
proofs and real on-chain contract calls. It runs in two tiers, split by proof weight
and by what the node's clock allows.

**B1 — live on-chain** (`register → proveFunding`, all ≤ k=17 — each a real ZK proof
and a real `ContractCall` included in a block):

```bash
# bring up the local stack (node 1.0.400 / ledger 8.1.3, indexer, proof server) via
# packages/dapp/standalone.override.yml, point the dapp at it, then:
pnpm --filter @mmr/dapp run interact     # MMR_STOP_AFTER=proveFunding
```

| Step | Circuit | What it proves (in ZK) | block |
|---|---|---|---|
| 1 | `register` | engagement id derived from a secret; wallet + terms committed | **37** |
| 2 | `activate` | status → Funded within the 72 h funding window | **41** |
| 3 | `publishRoot` ×2 | 2-of-3 attester committee publishes the epoch root on-chain (I8) | **45** / **49** |
| 4 | `proveFunding` | Σ `from_treasury` ≥ loan, opened against the attested root | **62** |

Each row is a real `__typename: ContractCall` in the local indexer — verifiable, not a
log line. The full transcript and tx hashes are in
[`specs/LIVE_LOCAL_LIFECYCLE.md`](specs/LIVE_LOCAL_LIFECYCLE.md) (contract
`e45ab713…97ce`, recorded 2026-11-01). (`postBond` escrows a real shielded Zswap bond;
it is included when a bond coin is wired.)

**B2 — KAT-verified** (the heavy and the time-gated circuits): `proveEpoch` (k=20,
~599.5k rows), `settleEpoch`, `releaseEpoch`, `claim`. These run through the **real
compiled circuit** via `@midnight-ntwrk/compact-runtime` — every `transientHash`,
`checkRoot` and `assert` executes — with the block clock driven directly, which the
node's AURA consensus cannot do on-chain without 24 h of real time:

```bash
pnpm --filter @mmr/contracts test        # 123 KATs, 7 files: full lifecycle incl. proveEpoch + claim
```

> **Why the split:** midnight-node advances block time only in real time (fixed AURA
> slots), so `settle → release → claim` (gated on epoch-end and challenge windows)
> cannot be an on-chain tx without waiting 24 h — the KATs cover them with a controlled
> clock. And `proveEpoch`'s k=20 proof peaks ~9.5 GB, so it is proven live where RAM
> allows and KAT-verified otherwise. Both tiers exercise the **same** compiled contract;
> nothing is mocked.

Real ZK keys back every circuit: `proveEpoch` k=20 (305 MB prover key), `claim` k=19,
`proveFunding` k=17, `register` k=15, `postBond` k=14, `activate` k=10 — `zkir` keygen
output, non-empty, in `build/epoch_proof/keys`.

---

## Demo C — also live on the public Preview testnet (supporting)

The same contract is **deployed to Midnight's public Preview testnet** and verifiable on
chain — all 11 circuits, via a batched deploy (the contract is too large for one block,
so 8 circuits deploy in one tx and 3 verifier keys are inserted via maintenance updates):

- **Contract:** `48e2cfceccd0a7b771f5bb71337455f2df03540aadcaf0bc3687d310e52d9eb6`
- **To confirm it on chain:** open the [Midnight Explorer](https://midnightexplorer.com),
  switch the network selector to **Preview**, and paste the contract address — all 11
  circuits are present, and `findDeployedContract()` attaches successfully.
- The batched-deploy diagnosis and tooling (`measure-deploy-cost.mjs`, `batch-deploy.ts`)
  is in [`specs/TESTNET_DEPLOY.md`](specs/TESTNET_DEPLOY.md) Phase 3.5.

### Why the live lifecycle runs locally, not on Preview

Contract **calls** currently do not get included on Preview, while **deploys** and
maintenance updates from the same wallet and client do. This was traced to the end: the
**identical node binary** (`1.0.400-87c0fbdb`, ledger `=8.1.3`) accepts the same calls on
a **local** node — so the cause is **not** the contract, the ZK, the compiler, or the
ledger version. It is isolated to the Preview **wallet's DUST/fee structure** (its DUST
came from registration), matching a known `NotNormalized` DUST-action edge case. It is
written up in [`specs/CALL_SUBMISSION_BLOCKER.md`](specs/CALL_SUBMISSION_BLOCKER.md) and
escalated to Midnight. It does not affect the protocol — the byte-identical local node
runs the whole thing — which is why the primary live lifecycle (Demo B) runs locally.

---

## Demo D — the public profile UI (~10 s)

```bash
pnpm --filter web dev        # profile + depth/uptime chart + tear sheet, at localhost:3000
```

Or open the hosted version if it is deployed (see the README's **For reviewers** block).
This is the reputation record as a market maker's counterparty reads it — the
depth/uptime chart, per-epoch verdicts, and the one-page tear sheet, with no private data
exposed. It shows what the product is; the cryptography underneath is what Demos A–C
verify.

---

## What's real vs. stubbed

Real and verified: the whole Midnight/ZK core (one Compact 0.31.1 contract, all I1–I10
bound in-circuit, 123 known-answer tests that execute the *compiled* circuit and revert on
any tampered witness), real `zkir` proving/verifying keys, the deterministic indexer, the
independent watcher, the **live Preview deploy**, and — in Demo B — **5 real on-chain
lifecycle calls** (`register → proveFunding`) plus the heavy and time-gated circuits
(`proveEpoch`, `settle`/`release`/`claim`) executed through the real compiled circuit. The
IPFS publisher (Pinata v3) and Postgres repository (`@mmr/db`) are real behind their
interfaces.

Clearly-labelled and still to wire: a live Base archive-RPC reader and real
Jubjub-Schnorr attester signing. These are interface stubs and do not touch the contract
logic. Full detail: [`specs/BUILT_ON_MIDNIGHT.md`](specs/BUILT_ON_MIDNIGHT.md).
