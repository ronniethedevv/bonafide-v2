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

## Daily indexer (Trigger.dev)

`apps/worker` holds the background tasks (invariant #1). `daily-index` runs at 01:10 UTC
and indexes the previous UTC day for every chain with covered tokens; `index-epoch`
indexes one day and can be run by hand from the Trigger.dev dashboard for backfills
(payload `{"chainId": 8453, "date": "2026-11-16"}`).

Task environment, set in the Trigger.dev dashboard (Production), never committed:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string the web app uses |
| `BASE_ARCHIVE_RPC_URL` | archive RPC with the key in the URL (e.g. Alchemy `…/v2/<key>`) |
| `ETH_ARCHIVE_RPC_URL` | only if Ethereum tokens are covered |
| `IPFS_PINNING_JWT` | Pinata JWT with Files: Write |
| `MMR_COVERAGE_8453` | comma-separated base tokens to index on Base |
| `MMR_COVERAGE_1` | the same for Ethereum (optional) |
| `MMR_LOG_CHUNK_BLOCKS` | blocks per `eth_getLogs`: `10` on a free key, e.g. `2000` on a paid one |

Deploys run from GitHub Actions (`.github/workflows/deploy-worker.yml`) on pushes to
`main` that touch the worker or the code it bundles, once the repository has the
`TRIGGER_ACCESS_TOKEN` secret (a Trigger.dev personal access token) and the
`TRIGGER_PROJECT_REF` variable. Locally:

```bash
pnpm --filter @mmr/worker test                     # needs TEST_DATABASE_URL for the DB tests
cd apps/worker && TRIGGER_PROJECT_REF=proj_… pnpm exec trigger dev   # run tasks against your machine
```

## What needs a Midnight environment (not runnable here)

`packages/contracts` holds Compact 0.31.x circuit/contract **skeletons**. They are
not wired into any build script and need the Midnight toolchain (`compactc`) plus
a Blockfrost project token to compile and prove. See
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
| `@mmr/contracts` | Compact circuit/contract skeletons (not compiled here) |
| `web` | public profile + tear sheet (Next.js) |
