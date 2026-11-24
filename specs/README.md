# Specs index

The design, decisions and runbooks behind BonaFide v2, grouped by what you want to know.

## Start here

| Document | What it covers |
|---|---|
| [BUILT_ON_MIDNIGHT.md](./BUILT_ON_MIDNIGHT.md) | Which Midnight primitives the contract uses, and where |
| [project_overview.md](./project_overview.md) | Objectives, flows, scope and risks |
| [architecture.md](./architecture.md) | Tiers, storage, invariants, tech stack |
| [RUNNING.md](./RUNNING.md) | Running the packages, the web app and the daily indexer |
| [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md) | Hosting the web app |

## Contract and circuits

| Document | What it covers |
|---|---|
| [../packages/contracts/INVARIANTS.md](../packages/contracts/INVARIANTS.md) | I1–I10 stated precisely, and which circuit enforces each |
| [../packages/contracts/README.md](../packages/contracts/README.md) | Contract layout, toolchain, how to build and test |
| [CIRCUIT_REVIEW.md](./CIRCUIT_REVIEW.md) | Soundness audit of the circuits and how each finding was closed |
| [CIRCUIT_WORK.md](./CIRCUIT_WORK.md) | Getting the circuits compiling and correct |
| [I8_FUNDING_HANDOFF.md](./I8_FUNDING_HANDOFF.md) | Attester-root registry and funding-membership proof |
| [OPEN_ITEMS.md](./OPEN_ITEMS.md) | Design items awaiting a decision |

## Data and services

| Document | What it covers |
|---|---|
| [UNIT3_CHAINPROVIDER.md](./UNIT3_CHAINPROVIDER.md) | The live Base / Ethereum chain reader behind the indexer |
| [agent.md](./agent.md) | The market maker's agent: what runs where, what the server sees |

## Midnight operations

| Document | What it covers |
|---|---|
| [MIDNIGHT_SETUP.md](./MIDNIGHT_SETUP.md) | Toolchain and node setup (Compact 0.36.1, ledger 9) |
| [TESTNET_DEPLOY.md](./TESTNET_DEPLOY.md) | The ledger 8 deploy runbook, kept as history |
| [LIVE_LOCAL_LIFECYCLE.md](./LIVE_LOCAL_LIFECYCLE.md) | The lifecycle run live on a local Midnight node (ledger 8) |
| [CALL_SUBMISSION_BLOCKER.md](./CALL_SUBMISSION_BLOCKER.md) | Call-inclusion issue on the pre-relaunch Preview chain |
| [SERVICEDESK_REPORT.md](./SERVICEDESK_REPORT.md) · [SERVICEDESK_DISCORD.md](./SERVICEDESK_DISCORD.md) | The report filed with Midnight about that issue |

## Product and design

| Document | What it covers |
|---|---|
| [ui_context.md](./ui_context.md) | Design tokens, theme and component rules |
| [code_standards.md](./code_standards.md) | TypeScript conventions and error handling |
| [COMPETITIVE_LANDSCAPE.md](./COMPETITIVE_LANDSCAPE.md) | Market and gap analysis |
| [UX_LANDSCAPE.md](./UX_LANDSCAPE.md) | UX research and gap analysis |

## Decisions and history

[progress_tracker.md](./progress_tracker.md) is the dated build log. Its "Immutable design
decisions" section (DD-1 onward) records every decision with its reasoning, including the
latest: the second review fixes (DD-37) and the pool bound into the terms (DD-38).
