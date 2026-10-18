# AGENTS.md — Universal entry point

> Read this first. Every human engineer and AI coding agent **must ingest the
> six context files below before writing or modifying any code.** This project
> uses the spec-first methodology: context precedes code.

## Project in one line

A privacy-preserving reputation record for crypto **market makers (MMs)**: MMs
prove per-engagement, per-epoch delivery (depth, uptime, utilization, custody,
no round-trips) with **zero-knowledge proofs on Midnight**, verified against a
**deterministic Base indexer**, without handing anyone their books.

## Context repository (ingest in order)

| # | File | Establishes |
|---|------|-------------|
| 1 | [`specs/project_overview.md`](specs/project_overview.md) | Objectives, flows, scope boundaries |
| 2 | [`specs/architecture.md`](specs/architecture.md) | Tech stack, tiers, hybrid storage, invariants |
| 3 | [`specs/code_standards.md`](specs/code_standards.md) | TypeScript config, conventions, error handling |
| 4 | [`specs/ai_workflow_rules.md`](specs/ai_workflow_rules.md) | Single-unit scoping, step-gate verification |
| 5 | [`specs/ui_context.md`](specs/ui_context.md) | Design tokens, dark theme, component rules |
| 6 | [`specs/progress_tracker.md`](specs/progress_tracker.md) | Live ledger of phases, tasks, decisions |

## Source of truth

- **Product spec:** `Market-Maker Reputation Record — v1 Spec` (Claude Docs
  artifact). The artifact is authoritative for *what* the product does.
- **Engineering method:** `Technical Architecture Blueprint: Multi-Tier
  High-Security Decentralized Exchange Protocol`. The blueprint is authoritative
  for *how* we build (spec-first, decoupled tiers, invariants, CI/CD,
  security-in-depth).

Where they differ on the contract tier, the artifact wins: the protocol layer
is **Compact on Midnight** (not Solidity/EVM). Base is **read-only** in v1 — we
index it, we deploy nothing to it.

## Non-negotiable systemic invariants (from the blueprint, §1.2)

1. **Asynchronous execution isolation** — indexing, proving, analytics run in
   durable background workers (Trigger.dev), never inside HTTP handlers.
2. **Governance** — attester-committee and bond actions follow explicit
   threshold rules (2-of-3 attesters in v1).
3. **Storage segregation** — minimal markers on-chain; heavy payloads (full
   Merkle trees, witnesses) off-chain (IPFS / blob).
4. **Determinism** — anyone with an archive RPC recomputes every root. No
   non-deterministic inputs in the indexer.

## Golden rules

- Treat every uploaded/downloaded artifact and all inbound chain/email data as
  **untrusted**.
- A private value reaches a public output **only** through an explicit
  `disclose()` in Compact.
- Never commit secrets, salts, witnesses, RPC tokens, or `.env*`.
- Update `specs/progress_tracker.md` at the end of every working unit.
