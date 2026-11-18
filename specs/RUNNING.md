# Running locally

## Prerequisites

- **Node ≥ 22** and **pnpm** (`npm i -g pnpm`). Check: `node -v`, `pnpm -v`.

## Setup

```bash
git clone https://github.com/ronniethedevv/mm-reputation.git
cd mm-reputation
git checkout ccr-0ae4f61d-euy47e
pnpm install
```

If pnpm reports an ignored build script for `sharp`, that's fine — it's only for
Next's image optimization, which this app doesn't use. `esbuild` is allow-listed
and builds automatically (needed by vitest).

## Verify everything

```bash
pnpm -r typecheck     # all packages + web, strict TS
pnpm -r test          # unit + determinism tests across all packages
```

## Prover demo (the whole loop in one command)

```bash
pnpm --filter @mmr/prover demo
```

Indexes a pool → builds the epoch root-of-roots → assembles and verifies the
witness → prints the per-invariant (I1–I8) verdict, ending in `VERDICT: PASS`.

## Web app

```bash
pnpm --filter web dev          # http://localhost:3000
```

Then open:

- `http://localhost:3000/mm/vega-mm` — public reputation profile (with the
  depth/uptime chart)
- `http://localhost:3000/mm/vega-mm/tear-sheet` — shareable tear sheet

Production build:

```bash
pnpm --filter web build
pnpm --filter web start -p 3000
```

## Daily indexer

`apps/worker` holds the indexer job (invariant #1: background job, never an HTTP handler).

- **Production:** Trigger.dev (`apps/worker/src/trigger`, deployed with
  `pnpm --filter @mmr/worker deploy`), with the variables below set in the Trigger.dev
  project.
- **This demo:** GitHub Actions' scheduler. `.github/workflows/daily-index.yml` runs the
  same job at 01:10 UTC for every chain with covered tokens, over the last
  `MMR_CATCHUP_DAYS` (default 3) closed UTC days; stored days are skipped, so a missed run
  is caught up by the next. Run it by hand (Actions → Daily index → Run workflow) for a
  backfill: give a `date` and optionally a `chain`. It skips at once while no chain has
  covered tokens.

Repository settings → Secrets and variables → Actions:

| Name | Kind | Value |
|---|---|---|
| `DATABASE_URL` | secret | the Neon connection string the web app uses |
| `BASE_ARCHIVE_RPC_URL` | secret | archive RPC with the key in the URL (e.g. Alchemy `…/v2/<key>`) |
| `ETH_ARCHIVE_RPC_URL` | secret | only if Ethereum tokens are covered |
| `IPFS_PINNING_JWT` | secret | Pinata JWT with Files: Write |
| `MMR_COVERAGE_8453` | variable | comma-separated base tokens to index on Base |
| `MMR_COVERAGE_1` | variable | the same for Ethereum (optional) |
| `MMR_LOG_CHUNK_BLOCKS` | variable | blocks per `eth_getLogs`: `10` on a free key, e.g. `2000` on a paid one |
| `MMR_CATCHUP_DAYS` | variable | optional, 1–14 (default 3) |

Locally (same variables in the environment):

```bash
pnpm --filter @mmr/worker test                     # needs TEST_DATABASE_URL for the DB tests
pnpm --filter @mmr/worker index                    # catch-up window on every covered chain
MMR_INDEX_DATE=2026-11-16 MMR_INDEX_CHAIN=8453 pnpm --filter @mmr/worker index   # one day
```

## What needs a Midnight environment (not runnable here)

`packages/contracts` holds the Compact contract (toolchain 0.36.1, ledger 9). CI
compiles it (`compactc --skip-zk`) and runs all 135 KATs against the compiled circuits;
locally, `pnpm --filter @mmr/contracts kat:build && pnpm --filter @mmr/contracts test`
with the toolchain installed. Proving keys and live calls need the full Midnight setup. See
[`packages/contracts/README.md`](../packages/contracts/README.md) for the overview
and **[`specs/MIDNIGHT_SETUP.md`](./MIDNIGHT_SETUP.md)** for the full Ubuntu setup
walkthrough (toolchain, proof server, keys, `.env`).

## Package map

| Package | What it is |
|---------|-----------|
| `@mmr/merkle` | leaf schema, indexed Merkle tree, root-of-roots |
| `@mmr/indexer` | deterministic Base pipeline (TWAP, commitments, anti-JIT, epoch build) |
| `@mmr/prover` | engagement model, witness assembly, I1–I8 reference oracle, demo CLI |
| `@mmr/protocol` | settlement state machine + mock attester committee |
| `@mmr/watcher` | challenge watchdog (root recomputation) + client verdict log |
| `@mmr/contracts` | Compact contract (0.36.1, ledger 9) + 135 KATs on the compiled circuits |
| `web` | public profile + tear sheet (Next.js) |
