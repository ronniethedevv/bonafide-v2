# Open design items awaiting decision

> **DECIDED 2026-10-23 (user):** I8 → **Option B** (attester-submitted counted
> registry), committee **fixed at deploy** (2-of-3). Funding-membership opens
> against **epoch-1's `rootOfRoots`**. Implementation plan: `specs/I8_FUNDING_HANDOFF.md`
> (I8 first, so funding can bind to the attested `publishedRoot[1]`). Both close the
> last in-circuit gaps and re-key together.

Two circuit-tier gaps are tracked as known-open (see progress_tracker.md). Both
need a design decision before implementation, so they are written up here rather
than guessed. Written by the cloud session from a full review of the current
circuits; the laptop/compiler is not needed to decide, only to implement.

Status at time of writing: all invariant bindings (I1–I7, I9, I10), H3b anchors,
M2 carry-forward, M3/M3b bond custody + tranches, and H4 private-membership claim
are implemented and KAT-verified in `epoch_proof.compact`. These two items are what
remains for full circuit soundness, beyond the real-data adapters.

---

## 1. I8 — attester-root registry (the biggest remaining circuit gap)

**The gap.** Settlement and default currently trust that an epoch's root was
published and attested. There is no on-chain record that ≥ 2-of-3 attesters signed
`(epoch, rootOfRoots, cid)`, so:
- an epoch whose root was *never published* can still be `defaultEngagement`-ed, and
- the 2-of-3 threshold is only modelled off-chain (`MockAttesterCommittee`), not
  enforced in-circuit.

This is the circuit-side twin of the `MockAttesterCommittee` placeholder: closing
I8 means both an on-chain root registry **and** a real attester committee (the
"attester signing" real-data adapter), so the two should be scoped together.

**Options.**

- **A — In-circuit signature verification.** The contract verifies 2-of-3
  Jubjub-Schnorr signatures over `(epoch, root, cid)` against the committee's
  registered public keys, inside a Compact circuit.
  - Pro: fully trustless; a single settlement proof carries the whole threshold.
  - Con: Schnorr verification over Jubjub is expensive in-circuit (EC scalar-mul
    per signature × 3); materially grows the settlement circuit's `k`. Needs the
    committee pubkeys as ledger state. Heaviest option.

- **B — Attester-submitted root registry with counted threshold (recommended).**
  Each attester submits the `(epoch, root, cid)` they sign through *their own*
  transaction, authenticated by their key via Midnight's per-tx auth
  (`ownPublicKey()` against a registered committee set). The contract records one
  vote per distinct attester for a given `(epoch, root)`; when the count reaches the
  threshold it marks that root **published**. `settleEpoch` / `defaultEngagement`
  gate on "root published for this epoch."
  - Pro: no in-circuit multi-signature verification — each attester's submission is
    authenticated by Compact's own tx auth, and the threshold is just a counter;
    cheap circuit. Enforces 2-of-3 on-chain. Fits Midnight's model.
  - Con: costs 3 attester transactions per epoch (one per signer) instead of one
    aggregated proof; relies on a registered committee key set.

- **C — Single trusted marker (interim only).** One action writes a "published"
  marker; threshold enforced off-chain. This is essentially today's mock. Dev-only;
  not a real I8.

**Recommendation: B.** It enforces the 2-of-3 threshold on-chain at low circuit
cost and cleanly replaces the mock, while deferring expensive in-circuit Schnorr
(Option A) unless a single aggregated settlement proof is later required. Concretely:
1. A ledger set of committee attester public keys (registered once, 2-of-3 config).
2. `publishRoot(epoch, root, cid)` — authenticated to a committee member; records
   the member's vote for `(epoch, root)`; idempotent per member.
3. A published-root ledger entry set when distinct votes ≥ threshold.
4. `settleEpoch` additionally requires the epoch's root to be published; a
   never-published epoch can no longer be settled **or** defaulted (close the
   "no-root epoch is defaultable" hole by requiring published-or-past-attester-
   timeout for default, with the timeout anchored to the stored `activatedAt`).
5. Replace `MockAttesterCommittee` with a real committee that signs and submits.

**Decision needed from the user:** confirm B vs A (cost/trust trade-off), and
whether the committee key set is fixed at deploy or governed (the blueprint's
"attester-committee and bond actions follow explicit threshold rules" suggests a
governed set is in scope later; fixed-at-deploy is fine for v1).

---

## 2. `activate` funding-membership proof

**The gap.** `activate` records `activatedAt` and gates the funding window, but does
**not** prove the loan actually reached the committed wallets — it omits the
membership proof the original C1 note flagged. So an engagement can be activated
without evidence the loan was funded into the wallet set.

**Approach (well-defined; mirrors existing machinery).** At activation, open the
committed wallets' leaves against the funding epoch's `rootOfRoots` using the same
pool-inclusion + slot-membership openings `proveEpoch` already uses (C1), and assert
the funded amount reached the set:
`Σ from_treasury over committed wallets ≥ loan_L0` (both already in the leaf schema
and `Terms`). This reuses `verifyPoolPath` / `verifyPath16` and the slot-opening
witnesses — no new primitive.

**Open question for the user:** *which* root does the funding proof open against?
- the first epoch's `rootOfRoots` (funding evidenced in epoch-1 indexed data), or
- a dedicated funding snapshot taken during the 72h funding window.

This depends on how the indexer timestamps funding inflows relative to epoch
boundaries — a spec/indexer decision, not a circuit one. Once that's pinned, the
circuit work is a direct reuse of the C1 opening pattern and is safe to implement.

**Recommendation:** open against the first epoch's `rootOfRoots` (epoch `e=1`,
whose end is `activatedAt + 24h`), asserting `Σ from_treasury ≥ loan_L0` over the
committed wallets — unless the spec wants funding settled strictly *before* epoch 1
begins, in which case a dedicated funding snapshot is needed.

---

## Suggested order

1. **`activate` membership** once the funding-root question is answered — small,
   reuses C1, high soundness value.
2. **I8 (Option B)** together with the real attester committee — larger, couples to
   the attester adapter, closes the last invariant and removes the mock.

Both re-key the circuit (ledger/zkir changes), so batch them before a final keygen.
