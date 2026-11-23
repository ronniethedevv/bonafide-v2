# Circuit invariants I1–I10

The epoch circuit enforces I1–I8; the registration/bond circuits (same contract, DD-17) enforce I9; the
claim circuit enforces I10. A proof that breaks any invariant cannot be generated.

## Notation

- `W` — committed wallet vector: **16 slots**; the `n` active wallets fill slots
  `[0, n)` sorted ascending, padding slots `[n, 16)` are `0`. `B` — active bitmap
  over the 16 slots, `B[j] ⇔ j < n` (`n` = `activeCount`, a private witness).
- `ℓ_j` — the leaf opened for slot `j`: address `a_j`, next address `n_j`,
  metrics `m_j`.
- `R_e` — the epoch's **root-of-roots**. `P` — the deal's floor price (option
  strike for loans, agreed floor for retainers). `L_0` — loan amount. `D` —
  allowed disposal (outflow cap). `S` — net-selling cap. `Q_0` — quote already in
  the set at start. `δ*` — depth target. `ρ` — round-trip share cap. `π` — the
  engagement's pool, committed with the terms: `proveEpoch` and `proveFunding` open
  only `π`'s tree in `R_e` (DD-38).
- All amounts are **unsigned**; every inequality is written to avoid a
  subtraction that could underflow.

## I1 · Wallet set is sorted and append-only

For every active pair of slots `j < k`: `a_j < a_k` (strict — no duplicates).
Active wallets are non-zero and every padding slot is exactly `0`, so interior
zeros (`[a, 0, b]`) are rejected and `n` is fixed by `W`.
Across epochs the committed set only grows: the start-of-epoch commitment equals
the previous epoch's end commitment extended; no active wallet may leave
mid-engagement. *Circuit:* `epoch_proof` checks sortedness over `W`; the
engagement commitment chain (bond contract) enforces append-only.

## I2 · Every slot accounted for exactly once

Each **active** slot `j` opens exactly one leaf under `R_e`. Either:
- **membership:** `a_j == W[j]` and `¬ℓ_j.is_protocol` (a real wallet, not a
  pool/router/position-manager), or
- **non-membership:** `ℓ_j.addr < W[j] < ℓ_j.next_addr` (or `next_addr == 0`),
  proving slot `j` had zero activity this epoch.

*Circuit:* `epoch_proof` verifies each active opening's Merkle path to `R_e` via
the pool inclusion proof, then this leaf predicate. Padding slots open nothing:
they are forced non-present, so they add nothing to I3–I6.

## I3 · Custody — value stays inside the perimeter

`Σ_j base_end(m_j) · 1 + Σ_j quote_end-as-base(m_j, P) ≥ L_0 − D + Q_0-as-base`,
formulated without subtraction by moving terms:
`held_base + held_quote_valued_at_P + D ≥ L_0 + Q_0_valued`. Client tokens held,
plus quote proceeds valued at floor price `P`, never fall below the loan minus
allowed disposal. *Circuit:* `epoch_proof`.

## I4 · Net selling is capped

Active swap selling per epoch stays within `S` of swap buying; passive LP fills
don't count: `Σ_j swap_base_out(m_j) ≤ Σ_j swap_base_in(m_j) + S`. *Circuit:*
`epoch_proof`.

## I5 · Outflows are capped (carry-forward)

Cumulative transfers out of the set stay within `D` of transfers in, excluding
the loan itself; moves between committed wallets net to zero:
`Σ_j xfer_out(m_j) ≤ Σ_j xfer_in(m_j) − Σ_j from_treasury(m_j) + D`, with
internal transfers cancelling. Running totals carry forward as a salted
commitment checked against the previous epoch. *Circuit:* `epoch_proof` +
carry-forward commitment.

## I6 · Uptime counts buckets on minimum depth

A bucket passes only if `Σ_j minDepth_bid(j,bucket) ≥ δ*` **and**
`Σ_j minDepth_ask(j,bucket) ≥ δ*`, using the per-slot **minimum** depth in the
bucket (opened from the contracted band of each `depth_root`). A sum of minimums
never exceeds the minimum of the sum, so uptime can't be over-credited.
*Circuit:* `epoch_proof`, with one band opened per slot via `openBand`.

## I7 · Round trips are capped

Per window `w`: round-trip volume `rt_w = min(Σ_j buy(j,w), Σ_j sell(j,w))`.
Require `Σ_w rt_w ≤ ρ · grossVolume`, and `rt_w` never counts toward reported
volume. *Circuit:* `epoch_proof`, opened from each `flow_root`.

## I8 · Only published roots are scored

An epoch counts only against the root its attester committee published:
`publishedRoot[e]` is set when **2 of the 3** committee members (fixed at deploy) have
each submitted `publishRoot(e, root, cid)` for the same `(root, cid)`, each
authenticated by proving knowledge of its secret (one vote per member per epoch).
`proveEpoch` requires `rootOfRoots == publishedRoot[e]`; `settleEpoch` requires the
root published; an epoch whose root was never published is not defaultable.
A committee member whose recomputation disagrees votes `disputeRoot`; at 2 of 3 the root
is disputed. Votes count only until the day's deadline (its end + 66 h), so after it every
day is final: **settled** (released, and its record credited to `claim`), **disputed**
(neutral: released to the market maker, never credited, never defaultable) or
**neither** (defaultable). Releases open at that deadline (DD-37).
*Circuits:* `publishRoot`, `disputeRoot`, `proveEpoch`, `settleEpoch`, `releaseEpoch`,
`defaultEngagement` (DD-26, DD-35, DD-37).

## Funding · the loan reached the committed wallets (DD-27)

Once per engagement, before any epoch settles: against the published, undisputed root
of any day from the registration day through day 1 (I8; DD-37, so a loan that lands
before day 1 is provable), with the same leaf openings as the epoch circuit (C1, I2, H2)
and the registered wallets and terms (C2), `Σ_j from_treasury(m_j) ≥ L_0` over member
slots. *Circuit:* `proveFunding`; `settleEpoch` requires it.

## I9 · Callers prove a secret
No circuit trusts `ownPublicKey()` (the prover's machine chooses its value).
Authorization is by proving knowledge of a secret: the engagement secret for the
market maker's own steps (posting the bond and activation are owner-only, DD-37), each
attester's secret for root votes and disputes. `register` requires a non-zero bond
beneficiary. *Circuits:* `postBond`, `activate`, `publishRoot`, `disputeRoot`,
`proveEpoch`, `claim`.

## I10 · The record only grows

Public counters never decrease, and each finished engagement is claimed **at most
once** via a nullifier `ν = H(engagement_secret ‖ engagement_id)`. A second claim
with the same `ν` is rejected. A claim counts only **credited** days (records released
undisputed, the `creditedRecords` tree) and must present at least one (DD-37).
*Circuit:* `claim`; *ledger:* nullifier set, `creditedRecords`.
