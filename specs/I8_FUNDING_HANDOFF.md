# I8 attester-root registry + funding-membership (implementation handoff)

> **Decisions locked by the user (2026-10-23):** I8 = **Option B** (attester-
> submitted counted registry), committee **fixed at deploy** for v1 (2-of-3).
> Funding-membership opens against **epoch-1's `rootOfRoots`**. Rationale is in
> `specs/OPEN_ITEMS.md`; this file is the build plan. **Laptop only** — it's Compact
> circuit work (compile + KAT + keygen); the cloud can't run the toolchain.

Branch `ccr-0ae4f61d-euy47e`. No mocking; KAT every change against the compiled
circuit; commit per unit; update `specs/progress_tracker.md` + mark these decided in
`OPEN_ITEMS.md`; one final keygen after both land.

## Build I8 **first**, then funding — here's why
Funding-membership must prove the loan reached the wallets **against an attested
root**, or a prover could open against a self-favourable fake root. The attested
root only exists once I8 records a published root. So I8 comes first and gives
funding a `publishedRoot[1]` to bind to. (This reverses OPEN_ITEMS' tentative order,
for that soundness reason.)

## Part 1 — I8 attester-root registry (Option B)

**New ledger (names illustrative):**
- `committee: Set<ZswapCoinPublicKey>` — the 2-of-3 attester keys, **set once at
  deploy** (constructor, or a `registerCommittee` guarded to run only while empty).
  `ATTEST_THRESHOLD: Uint<8> = 2`.
- `rootVote: Set<Bytes<32>>` keyed by `persistentHash(attester ‖ epoch ‖ root)` —
  one vote per member per (epoch, root); makes `publishRoot` idempotent per member.
- `rootVoteCount: Map<Bytes<32>, Counter>` keyed by `persistentHash(epoch ‖ root)`.
- `publishedRoot: Map<Uint<64>, Bytes<32>>` — epoch → the root that reached threshold.

**New circuit `publishRoot(epoch, root, cid)`:**
1. `assert(committee.member(ownPublicKey()), "not a committee attester")` — Compact's
   own per-tx auth is the signature; no in-circuit Schnorr (that's Option A, deferred).
2. Vote key `vk = persistentHash(attester ‖ epoch ‖ root)`; if `!rootVote.member(vk)`:
   insert it, bump `rootVoteCount[persistentHash(epoch ‖ root)]`.
3. When the count reaches `ATTEST_THRESHOLD`, set `publishedRoot.insert(epoch, root)`.
   (Disclose only epoch/root/cid as needed; `cid` is the off-chain tree pointer, stored
   or emitted so the published tree is retrievable.)

**Gate the lifecycle on a published root:**
- `settleEpoch`: add `assert(publishedRoot.member(e), "epoch root not published (I8)")`
  — a never-published epoch can no longer be settled.
- `defaultEngagement`: today it defaults purely on the grace deadline. Change to
  **published-or-past-attester-timeout**: allow default only if
  `publishedRoot.member(e)` **or** `blockTimeGte(epochEnd(key,e) + ATTESTER_TIMEOUT)`
  (anchored to the stored `activatedAt` via `epochEnd`). Closes the "no-root epoch is
  instantly defaultable" hole — the attester gets their window first.

**Off-chain adapter (replaces `MockAttesterCommittee`):** Option B changes the model —
attesters don't produce an aggregated signature, they each **submit an authenticated
`publishRoot` tx**. So `packages/protocol`'s committee becomes real keypairs that each
call `publishRoot`; the threshold counting now lives on-chain (delete the off-chain
`countValid`). For v1 **the KAT exercises N members calling publishRoot**; the live
multi-key tx submission is testnet/dapp-layer work (`specs/TESTNET_DEPLOY.md`), so wire
the abstraction + KAT now and defer live submission.

**KATs (I8):** two distinct committee members publish `(e, root)` → `publishedRoot[e]`
set; one vote → not published; a **non-committee** submitter reverts; a **duplicate**
vote by the same member doesn't double-count; `settleEpoch` reverts until published;
`defaultEngagement` reverts for a never-published epoch **before** the attester timeout
and succeeds **after**; mutation probe (drop the `publishedRoot.member` gate → exactly
its covering tests fail).

## Part 2 — funding-membership (against epoch-1's attested root)

Fill the stub at `epoch_proof.compact:901-903`. Because funding is evidenced by
epoch-1 indexed data (root exists ~`activatedAt + EPOCH`), it **cannot** live inside
the initial `activate` tx. Add a dedicated circuit:

**New circuit `proveFunding(id, rootOfRoots, <C1 witnesses>)`:**
1. `assert(status.lookup(key) == Status.Funded)`; a `fundingProven: Set<Bytes<32>>`
   marker, asserted-once.
2. **Bind to the attested epoch-1 root:** `assert(rootOfRoots == publishedRoot.lookup(1),
   "funding root is not epoch-1's attested root")`. This is why I8 is first.
3. Reuse proveEpoch's **C1 opening verbatim**: `committedWallets()` + `assertWalletLayout`
   + `activeFlags`; `verifyPoolPath(transientHash<PoolEntry>(pe), pp, rootOfRoots)`; per
   active slot `verifyPath16(transientHash<SlotLeafCore>(slotLeafCore(L)), sp[j],
   pe.poolRoot)` with the same membership / non-membership bracket checks.
4. **Bind to the registered engagement** (same as C2 in proveEpoch): recompute
   `persistentCommit<Vector<16,Uint<160>>>(w, walletSalt())` == `walletCommit[id]`, and
   `persistentCommit<Terms>(t, termsSalt())` == `termsCommit[id]` (so `loan_L0` is the
   registered one).
5. **The funding assertion:** `Σ from_treasury` over present member slots `≥ t.loan_L0`.
   (`from_treasury` is already in the leaf and summed for I5; reuse that accumulation.)
6. Gate `settleEpoch` (and release) on `fundingProven.member(key)` so an engagement
   can't settle epoch 1 without having proven the loan landed.

**KATs (funding):** honest Σ from_treasury ≥ loan_L0 passes; **under-funded** reverts;
wrong/dropped wallet (commitment mismatch) reverts; a root that isn't `publishedRoot[1]`
reverts; opening witnesses not in the root revert; double `proveFunding` reverts;
`settleEpoch` blocked until funding proven.

## Sequencing & keygen
Both touch the ledger + add circuits, so the zkir changes and everything re-keys. Land
I8 (commit + KAT), then funding (commit + KAT), then **one final `compact compile`
(no `--skip-zk`) keygen of all circuits** — your established flow (~9.5 GB peak, the
`ulimit -v` cap). New circuits `publishRoot` and `proveFunding` get their own keys;
record the new k/row counts in `progress_tracker.md`.

## Guardrails
- No mocking; each `[assert]` earns a KAT; mutation-probe both gates.
- `persistentHash`/`persistentCommit` for anything that is ledger state (matches DD-8);
  `transientHash` only for in-circuit Merkle (C1 openings).
- Commit per unit, keep the KAT harness green; update `progress_tracker.md` and flip
  I8 + funding to **decided/done** in `OPEN_ITEMS.md`.
- This closes the **last two in-circuit gaps** (I8 + funding). After the keygen, the
  circuit has zero open invariants.
