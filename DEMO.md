# Running and verifying mm-reputation

A market maker proves, in zero knowledge on Midnight, that its liquidity met an engagement's terms
each day, measured against a deterministic index of Uniswap v3 activity on Base and Ethereum, and
without revealing its wallets, balances or order flow. This page lists what a reviewer can check,
with the command for each check and what it shows. For which Midnight features the contract uses, see
[`specs/BUILT_ON_MIDNIGHT.md`](specs/BUILT_ON_MIDNIGHT.md).

Requirements: Node.js 22 or later, pnpm 10, and `pnpm install` once. Steps A, B and C need no
wallet and no Midnight account.

| Step | What it shows | Time |
|---|---|---|
| [A. Rebuild an indexed day](#a-rebuild-an-indexed-day) | A published day's root is recomputed from public data; a one-unit change breaks it | seconds |
| [B. Run the compiled contract](#b-run-the-compiled-contract) | Every circuit accepts an honest witness and rejects tampered ones | about a minute |
| [C. Check the deployment](#c-check-the-deployment-on-preview) | The contract on Preview carries the verifier keys of this source | seconds; 4 minutes to compare keys |
| [D. Follow the live engagement](#d-follow-the-live-engagement) | A real engagement on Base data, carried by scheduled jobs | on the web |
| [E. Use the web app](#e-use-the-web-app) | The market maker's and the client's side, and the public record | on the web |

## A. Rebuild an indexed day

```bash
pnpm --filter @mmr/watcher test
```

The watcher holds two real indexed days as fixtures: BROOMY/WETH on Base (21 October 2026) and a
Uniswap v3 pool on Ethereum quoted in USDT (10 November 2026). It rebuilds each pool tree and the day's root of roots
from the published data alone, with no RPC. For the Base day the root is
`0x5a3a6373489512ce231856573012a90e45d2bc2720ce5538b92fc74af1d04461`. The tests then change a published
metric by one unit and check that the root no longer matches. This is the check every
attester runs before it votes for a day's root, and that anyone can run before trusting one.

## B. Run the compiled contract

```bash
pnpm --filter @mmr/contracts kat:build   # compile epoch_proof without keys (Compact 0.36.1)
pnpm --filter @mmr/contracts test        # 147 tests in 9 files
```

The tests run the compiled circuits through Midnight's own runtime (`@midnight-ntwrk/compact-runtime`
0.21.0), so every hash, Merkle path check and `assert` in the contract executes. An honest witness
passes; each tampered witness must fail on the assert that guards it. The tests drive the block clock
directly, which covers what a live run cannot show quickly: settlement after a day ends, releases at
its deadline, disputes, defaults, and `claim` after all 30 days.

```bash
pnpm --filter @mmr/dapp test             # 3 tests
```

The same path end to end without a network: a day built by the indexer is published, read back,
recomputed, turned into a witness and accepted by the compiled contract; tampered published data is
refused before any proof is made.

## C. Check the deployment on Preview

```bash
pnpm --filter @mmr/dapp check-deployment
```

This reads `epoch_proof`'s state from Midnight's public Preview indexer
(`4ff2c93db78baabc96e66b58eb4890f2ab2d7a7fc3f8930b6a89395de7f9a634`) and lists the 12 circuits with
a verifier key on chain. After `pnpm --filter @mmr/contracts compact:build` (about 4 minutes) it also
compares each on-chain key with the local build, byte for byte. Key generation is deterministic, so
a match means the deployed contract is this source.

## D. Follow the live engagement

Engagement `7e3dc433…b046` runs for 30 days from 24 November 2026 on the VIRTUAL/USDC pool on Base
(Uniswap v3, `0x529d2863a1521d0b57db028168fde2e97120017c`). It is a demonstration on three public
liquidity-provider wallets that we do not control; the README explains how they and the terms were
chosen.

- **Its state, read from the contract on every visit:**
  [the live engagement page](https://mm-reputation-web.vercel.app/engagement/7e3dc4334ee06ebdd7c6fdb929ebd8ef7ccadc8b1e772edfef39d44aebc2b046).
  It shows the status, the bond, day 1, funding, and for each day the attested root, the proven
  uptime, settlement and release.
- **Every transaction:** [`packages/dapp/deployments/preview-lifecycle.json`](packages/dapp/deployments/preview-lifecycle.json).
- **The jobs that carry it:**
  - [`daily-index.yml`](.github/workflows/daily-index.yml) indexes the previous UTC day at 01:10 UTC
    (again at 05:10 and 11:10, in case a scheduled start is late) and publishes the trees and
    series to IPFS. Days are indexed in order; a day that fails holds back the later ones.
  - [`preview-lifecycle.yml`](.github/workflows/preview-lifecycle.yml) runs after each index and at
    02:40 and 18:20 UTC. It recomputes each published day before the attesters vote (or dispute),
    then proves funding once, and proves, settles and releases each day as its window opens. Each
    run's summary lists its transactions.

Running the lifecycle yourself needs the deploy wallet's seed and is not needed to check anything:
every result it produces is public chain state that the page and step C read.

## E. Use the web app

**Live:** [mm-reputation-web.vercel.app](https://mm-reputation-web.vercel.app). **Locally:**

```bash
pnpm --filter web dev                    # http://localhost:3000
```

- **Public record.** Browse market makers, open a profile, export its tear sheet. These profiles are
  sample data and say so on the page; real records appear as engagements are claimed.
- **Market maker.** Sign in with an Ethereum wallet, register an engagement: tier, bond, the pool,
  the terms and the client's Midnight key, which the wizard takes from the client's account. The
  wizard seals the engagement file (secrets and salts) for the market maker to keep.
- **Client.** Save your Midnight key once; the bond goes to it on a default. Open a registration,
  check its terms against the commitment, and accept it only if it names your key.
- **The live engagement page** (step D) is the only page that reads the chain.

## Earlier runs

Before the ledger 9 relaunch of Preview, the lifecycle ran on a local Midnight node
([`specs/LIVE_LOCAL_LIFECYCLE.md`](specs/LIVE_LOCAL_LIFECYCLE.md)), because contract calls from a
DUST-registered wallet were not being included on the old Preview chain
([`specs/CALL_SUBMISSION_BLOCKER.md`](specs/CALL_SUBMISSION_BLOCKER.md)). On ledger 9 calls land:
a sample engagement on an earlier deployment ran 16 transactions from block 169,367 to 226,741,
covering registration, bond, activation, attester votes, funding, three daily proofs and two
settlements
([`preview-v1-lifecycle.json`](packages/dapp/deployments/preview-v1-lifecycle.json)).

## What is real and what is sample data

| Part | Status |
|---|---|
| Contract on Preview, 12 circuits, keys matching the source | Real |
| Live engagement: registration, bond, activation | Real, on chain |
| Daily index of the engagement's pool on Base, attested roots, daily proofs | Real; runs daily from 24 November |
| Watcher fixtures (step A) | Real indexed days |
| Profiles, tear sheets and the dashboards' history | Sample data, labelled on the page |
| Attesters | Three keys held by one operator in this demo; separate parties in production |
| Daily indexer host | Built for Trigger.dev; runs on GitHub Actions' scheduler for this demo |
