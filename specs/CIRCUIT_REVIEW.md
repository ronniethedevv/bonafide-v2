# Circuit review — soundness audit of the Compact circuits

Date: 2026-10-19 · Reviewed at commit `6dfeacf` · Reviewer: internal review (read-only).

**Scope:** `packages/contracts/src/{epoch_proof,registration,bond,claim}.compact`
against `INVARIANTS.md` (I1–I10) and the reference oracle
`packages/prover/src/oracle.ts`.

**Verdict:** The circuits **compile and generate proving keys** (`proof: true`),
which is a real pipeline milestone — but `proveEpoch` is **not yet sound**. Its
witnesses are not bound to the epoch root or to the registration commitment, so
it currently proves statements about data the prover chooses. C1 and C2 below are
must-fix before this is a trustworthy proof system. This is expected for a
skeleton (several checks are explicitly "omitted for brevity"); this doc turns
those gaps into a prioritized work list. Do this work **with the compiler in the
loop** (locally), not blind.

Keep every fix in lockstep with `packages/prover/src/oracle.ts` — the oracle is
the known-answer reference the circuit must agree with.

---

## Critical (forgeable proof)

### C1 · Bind all witness data to `rootOfRoots` — the core gap
- **Where:** `epoch_proof.compact` — `rootOfRoots` (param, line ~277) is **never
  used** in the body; `slotLeaves()`, `bidMin()`, `askMin()` are free witnesses
  with no Merkle verification. Also `registration.compact` `activate` (~81-86):
  funding-membership proof omitted.
- **Why it matters:** nothing forces the opened leaves to be the real Base-derived
  tree leaves, so any balances/swaps/depths can be fabricated → any verdict.
- **Fix:** verify, in-circuit, for each of the 16 slots:
  1. a pool **inclusion proof** binding the pool's tree root into `rootOfRoots`
     (mirror `RootOfRoots.verifyPoolProof` in `@mmr/merkle`), and
  2. an **indexed-Merkle-tree path** (depth 16) binding each `SlotLeaf`
     (membership) or low-leaf (non-membership) to that pool root (mirror
     `IndexedMerkleTree.verifyPath`).
  Feed the paths as witnesses. Use the **circuit-native Poseidon-family hash**,
  and update `@mmr/merkle` to the same hash so TS roots == in-circuit roots
  (closes DD-8). This is the single biggest piece of remaining ZK work.

### C2 · Bind wallets + terms to the registered engagement
- **Where:** `epoch_proof.compact:284` computes `wc = persistentCommit(w, salt)`
  but never discloses/asserts it; `terms()` is unbound to `termsCommit[id]`.
- **Fix:** have `proveEpoch` disclose `wc` (and a terms commitment) and verify it
  equals `registration.walletCommit[id]` / `termsCommit[id]` — either by reading
  that ledger state (cross-contract) or by passing the committed value in and
  checking equality. Without this, an MM can swap wallets/terms per epoch.

---

## High

### H1 · Bind depth to `depth_root` and select the contracted band (I6)
`bidMin/askMin` must be **opened against each leaf's `depth_root`**, and the band
chosen by `terms.band_bps` (mirror `openBand`/`verifyBandOpening` in
`@mmr/indexer`). Today depth is a free witness.

### H2 · Handle padding slots (I3/I4/I5)
No active-count/bitmap: a padding slot (`w[j]=0`, `present=true`, large
`base_end`) passes I2 and is summed, inflating `heldBase`. Add an explicit active
bitmap (as the prover harness already models) and only count active slots —
matching the oracle, which processes `activeCount` only. Fix the I2 loop so
padding slots are forced empty.

### H3 · Timestamps must come from a trusted source
`nowTs` is a caller-supplied arg in `bond` (`releaseEpoch`/`voidUnfunded`/
`defaultEngagement`) and `registration.register`. Read block time from the
ledger/transaction context instead, or the window gates are meaningless.

### H4 · `claim` must verify the epochs it credits
`epochsPassed/epochsTotal` are unverified public params. Check them against proven
epochs (e.g. the `epochUptime` ledger) so the record can't be inflated. The
nullifier already enforces once-only (I10 ✓).

---

## Medium

- **M1 · I7 round-trip cap is entirely omitted** (`epoch_proof.compact:367-369`);
  open `flow_root` per window and enforce `min(buy,sell)·1e6 ≤ ppm·gross`, as the
  oracle does.
- **M2 · I5 incomplete** — add internal-transfer netting and the cross-epoch
  carry-forward salted commitment the spec requires.
- **M3 · `bond.postBond` takes no custody** — wire `receiveShielded(coin)` (needs
  the declared-disclosure annotation) so the bond is actually escrowed and
  release/slash move real value.

## Low / notes

- L1 · I1 sortedness allows interior zeros (`[a,0,b]` passes); tighten once the
  active bitmap lands.
- L2 · `base_start`, `swap_quote_in/out` in `SlotLeaf` are currently unused
  in-circuit; wire them in where the invariants need them or drop from the opened leaf.
- L3 · DD-8: `@mmr/merkle` still uses the SHA-256 placeholder — must become the
  circuit hash (see C1) or TS and circuit roots won't match.

## What's already correct — keep it

`proof: true` via the ledger write; I9 identity-point check; the I3/I4 width &
overflow reasoning (bounded within Uint<248>); uptime bucket-counting matches the
oracle; `claim` nullifier (I10 once-only); "verdict implied by no revert".

---

## Suggested order

1. **C1** (Merkle + pool-inclusion verification in-circuit + Poseidon in `@mmr/merkle`) — the crux.
2. **C2** (bind wallets/terms to registration).
3. **H2** (active bitmap) — needed for C1's per-slot handling anyway.
4. **H1** (depth↔depth_root), **M1** (I7), **M2** (I5 netting).
5. **H3** (trusted time), **H4** (claim verification), **M3** (real escrow).
6. Re-run the proving benchmark after C1/H1 (circuit size will grow a lot — this
   is where `BUCKETS` / path depth tuning matters).

Each step: edit → `compact compile --skip-zk` → full `compact compile` → confirm
`contract-info.json` still `proof: true` → keep the oracle in agreement → push.
