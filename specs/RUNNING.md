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

## What needs a Midnight environment (not runnable here)

`packages/contracts` holds Compact 0.31.x circuit/contract **skeletons**. They are
not wired into any build script and need the Midnight toolchain (`compactc`) plus
a Blockfrost project token to compile and prove. See
[`packages/contracts/README.md`](../packages/contracts/README.md).

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
