# project_overview.md

## Core objective

Let small and mid-sized market makers **prove they are trustworthy** without
giving a third party account access or their trading books. Each engagement
(an MM working for a client under a contract) produces **verified per-epoch
results**; finished engagements roll into a **public record that nobody can edit
or cherry-pick**.

## Who it is for

- **Market makers** (small/mid, too small or too private to integrate with
  incumbents) who want to win clients on verified delivery.
- **Buyers who pick the MM:** launchpads, token advisors, foundations/DAOs
  running liquidity programs, and projects hiring MMs.
- Optionally **exchanges/auditors** for due-diligence disclosures.

## What is proven each epoch (24h)

| KPI | Meaning |
|-----|---------|
| Depth & balance | Bid/ask depth inside the contracted band, summed across committed wallets |
| Uptime | Share of time buckets whose summed depth met target (both sides) |
| Utilization | Share of client inventory in in-range liquidity vs idle |
| Custody | Client tokens stayed inside committed wallets/LP, minus an agreed selling cap |
| No round-trips | Self-cancelling buy/sell volume stays under a cap, never counts as volume |

> Spread-at-a-stated-size needs the full liquidity curve → **out of v1**.

## What stays private

KPI targets, loan terms, client identities, wallets beyond what the DEX already
shows, the MM's treasury (via shielded bonds), and **which engagements belong to
which MM until they finish** (nullifier claim, batched weekly).

## The record & difficulty tiers

Finished engagements are claimed into the MM's profile with a **nullifier** —
each counts once, none can be removed. Each engagement carries a difficulty
tier; sandbox engagements show separately.

| Tier | Starting thresholds (tune in pilot) |
|------|-------------------------------------|
| A | Token ≥90 days old, $50k+ daily non-MM volume, 1,000+ holders, $10k+ bond |
| B | Launchpad/partner co-signature, or $2.5k+ bond + non-refundable fee |
| C (sandbox) | Anything below B |

## Target operational flow (engagement lifecycle)

1. **Register** — MM commits a wallet vector + terms locally; client verifies
   wallet ownership off-chain (v1 decision); engagement gets a random ID.
2. **Fund** — loan/inventory reaches committed wallets (72h funding window);
   MM proves activation against the root-of-roots (pool stays hidden).
3. **Run epochs** — each 24h: attesters publish a signed Base root; MM generates
   an epoch proof (I1–I8); client sees per-epoch figures via opened commitments.
4. **Settle** — challenge window passes; bond releases automatically on valid
   proofs (no client veto needed).
5. **Claim** — finished engagement claimed into public profile via nullifier,
   batched weekly for unlinkability.

## In scope (v1)

DEX-only on **Base** (Uniswap v3, Aerodrome Slipstream), **Midnight mainnet**
with **Compact 0.31.x (ledger 8)**, a **2-of-3 attester committee**, 24-hour
epochs, **slashable shielded USDM bonds**, DUST-sponsored fees with self-relay
fallback, and an **exportable tear sheet**.

## Explicitly out of scope (v1 → later)

- CEX coverage (zkTLS), in-circuit wallet ownership (ledger 9 secp256k1),
  cross-chain slashing (VIA Labs), spread-at-size, BNB Chain, Midnight order
  books, mirrors to Intuition/EAS.
- **We deploy no contracts to Base.** Base is read-only / indexed only.

## Known risks (carry into decisions)

- Proving time & leaf size unmeasured (the 1.5s estimate is unsourced).
- Clients may still prefer read-only keys + live dashboards (test in pilot).
- Permanent record vs NDAs/EU rules → legal advice before EU clients (MiCA).
- Midnight ledger 9 not live as of 28 Sep 2026; plan a migration that exports
  all verdicts as one root.
- Small initial anonymity set → batch claims weekly, seed early engagements.
