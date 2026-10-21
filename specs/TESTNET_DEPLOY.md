# Midnight testnet deploy + wallet connect — plan

> The path to the two biggest "used their tech in action" wins: a live contract on
> Midnight testnet and a wallet-connected demo. This is a **laptop/testnet runbook**
> (the cloud session can't reach Midnight hosts). Steps marked **[verify]** depend on
> the current Midnight SDK/testnet, which moves fast — confirm them against the live
> docs (https://docs.midnight.network) rather than trusting any version pinned here;
> do not assume an API shape, check it.

## Why this matters (hackathon)

Judges reward "their tech in action": their wallet, their endpoints, their chain. A
live testnet deploy + a connect-wallet-and-submit-a-proof demo is the single
strongest signal. Everything below the contract is already real (see
`BUILT_ON_MIDNIGHT.md`); this wires it to the live network and a wallet.

## Prerequisites (gather first)

- [ ] **Midnight-capable wallet** — Lace with Midnight support (browser), plus a
      seed/headless wallet for scripted deploy. **[verify current wallet]**
- [ ] **Testnet funds (tDUST)** from the Midnight testnet faucet. **[verify faucet URL]**
- [ ] **Proof server** running locally — Midnight's proof server (Docker image), used
      to generate proofs client-side when submitting transactions. **[verify image +
      port, ~6300]**
- [ ] **Testnet endpoints** — node (substrate/RPC) URL + indexer (pubsub/GraphQL) URL
      for testnet. **[verify current URLs]**
- [ ] Node 22 + the repo's toolchain (already set up on the laptop).

## Packages (install from npm; confirm names/versions [verify])

Already used: `@midnight-ntwrk/compact-runtime`. The dApp layer additionally needs
(names are from the Midnight SDK family — **[verify exact packages + versions]**):
- `@midnight-ntwrk/midnight-js-*` (contract providers, tx builder)
- `@midnight-ntwrk/wallet` + `@midnight-ntwrk/wallet-api`
- `@midnight-ntwrk/dapp-connector-api` (browser wallet connect)
- `@midnight-ntwrk/ledger`, `@midnight-ntwrk/zswap`
- The **generated contract module** that `compact compile` emits for
  `epoch_proof.compact` (import its circuits + witnesses).

## Step 1 — Contract module + keys (done, just locate)

`compact compile` already produced the contract's TS module and ZK keys in
`packages/contracts/build/epoch_proof`. Confirm the module exports the circuits
(`register`, `activate`, `proveEpoch`, `settleEpoch`, `releaseEpoch`,
`voidUnfunded`, `defaultEngagement`, `claim`) and that the keys are the
**final-layout** regen (the one pending keygen). The KAT harness
(`packages/contracts/test/harness.ts`) already shows how to build witnesses and run
each circuit via `compact-runtime` — reuse that witness assembly for real txs.

## Step 2 — New package `@mmr/dapp` (deploy + interact)

A small TS package that wires the contract to testnet:
1. **Providers** — configure the Midnight JS providers against testnet node +
   indexer + the local proof server. **[verify provider setup]**
2. **Deploy** — submit the contract deploy tx; capture the contract address. One-off
   script `pnpm --filter @mmr/dapp deploy`.
3. **Interact** — functions that build + submit each circuit call as a transaction,
   reusing the harness's witness assembly (`@mmr/prover` openings +
   `@mmr/watcher` claim plan feed the private inputs). Each call generates a proof via
   the proof server and submits it.
4. **Read state** — query the indexer for `status`, `epochRecords` root, profile
   counters, to confirm the tx landed.

Validate by scripting the happy path on testnet:
`register → postBond → activate → proveEpoch → settleEpoch → releaseEpoch → claim`,
printing each tx hash + the resulting ledger state. That transcript **is** the demo.

## Step 3 — Wallet connect in `apps/web`

Add a Lace/Midnight connect flow (`dapp-connector-api`) and one real action — e.g.
"Submit this epoch's delivery proof" — that builds the witness, proves via the proof
server, and submits through the connected wallet. Show the returned tx + the updated
on-chain record in the UI (replace the fixture read for that one view with a live
indexer read). **[verify connector API]**

## Step 4 — Demo artifact

Record the end-to-end run (wallet connect → submit proof → on-chain record updates)
and a one-paragraph "what Midnight tech this exercises" caption pointing at
`BUILT_ON_MIDNIGHT.md`. This is what a rushing judge sees.

## Honesty / sequencing notes

- Do the **final-layout keygen first** (pending) so deploy uses current keys.
- Everything here is **[verify]-gated** on the live SDK because the cloud session
  can't reach Midnight to confirm the current API — the laptop agent (or you) should
  confirm each package/endpoint against docs.midnight.network before wiring, and not
  ship SDK code it hasn't run against testnet.
- Suggested order: (1) proof server up + wallet funded, (2) `@mmr/dapp` deploy, (3)
  scripted happy-path transcript, (4) web wallet-connect, (5) recorded demo.
