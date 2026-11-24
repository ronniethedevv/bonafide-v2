# Blocker: contract **calls** are never included on Preview (deploys and updates are)

**Status:** recorded on the ledger-8 Preview chain, which Midnight relaunched as a new
ledger-9 chain on 2026-11-07; to be retested there with the ledger-9 (Compact 0.36.1)
redeploy. Suspected ecosystem gap, not a BonaFide v2 bug.
**Recorded:** 2026-11-01. **Network:** Midnight Preview (pre-relaunch).

Every contract **call** we have submitted — from two different contracts, deployed two
different ways — fails to reach a block. Every **deploy** and **maintenance update** from
the same wallet, client and proof server lands fine. No `ContractCall` has ever been
included on either contract.

This is recorded so the reproduction is not lost. **Do not** re-derive it by changing the
dependency pins or recompiling: both were investigated and cleared (see *Ruled out*).

## Versions

| Side | Component | Version |
|---|---|---|
| Node | `system_version` | `1.0.400-87c0fbdb` |
| Node | `midnight_ledgerVersion` | `=8.1.3` |
| Client | `@midnight-ntwrk/midnight-js-*` | 4.1.1 |
| Client | `@midnight-ntwrk/ledger-v8` | 8.1.0 (pnpm override; the version midnight-js 4.1.1 pins) |
| Client | `@midnight-ntwrk/onchain-runtime-v3` | 3.1.2 (pnpm override; single physical copy) |
| Client | `@midnight-ntwrk/compact-runtime` | 0.16.0 |
| Contracts | Compact compiler / language / runtime | 0.31.1 / 0.23.0 / 0.16.0 |
| Contracts | ZKIR | `midnight:ir-source[v2]` |
| Proving | proof server | 8.1.3 (`midnightntwrk/proof-server:8.1.3`, local) |

Every one of these is the [support matrix](https://docs.midnight.network/relnotes/support-matrix)
set for Preview, except `onchain-runtime-v3`, which the matrix lists as 3.0.0 — see *Ruled out*.

## Reproduction A — vanilla 1-circuit counter (the minimal case)

`packages/dapp/scratch/counter.compact`, nothing else in it:

```compact
pragma language_version 0.23;
import CompactStandardLibrary;
export ledger round: Counter;
export circuit increment(): [] { round.increment(1); }
```

Compiled with the selected matrix toolchain (`compact compile`, 1.9s, full ZK keys).
Deployed to Preview with **plain `deployContract`** — one shot, no batching, no
`restrictDeployTo`, no maintenance updates. Driver: `packages/dapp/src/counter-check.ts`.

**The deploy succeeded:**

```
contractAddress    4996ab7fb52c9eb74b8099fe25e4027782e04bc0b93d2efec71d5dfaf3b4965d
deploy tx hash     c74e120aa47fadaefddb0f27ca8668be7b96d03d9d2d417b42f1dac35202eef2
block height       1547724
batched            false
```

**Calling `increment()` on it never lands.** Two attempts, both via
`findDeployedContract(...).callTx.increment()`:

| Attempt | `POST /check` | `POST /prove` | Node response | Inclusion |
|---|---|---|---|---|
| 1 (14:32 UTC) | 200, 13.7 ms | 200, 2.58 s | **none — no RPC error at all** | none after 42 min |
| 2 (15:23 UTC) | 200, 2.3 ms | 200, 0.079 s | **none** | none after 4 min |

Both times the client blocked inside submit/watch indefinitely and had to be killed. The
proof server accepted the ZKIR and produced a proof in both cases. The node returned **no
`1010`, no `Custom error`, nothing** — the transaction is admitted to the pool and then
silently never included. That is the documented signature of a **pre-dispatch drop**: the
node re-checks the transaction against state when building a block, drops it, and no code
reaches the client (only the node's own log records the reason, which we cannot read on a
public endpoint).

## Reproduction B — `epoch_proof` `register` (the original symptom)

The real contract, deployed batched (8 circuits in the deploy + 3 verifier keys added by
maintenance update, because all 11 keys overflow one block). Driver:
`packages/dapp/src/register-check.ts`.

`register(1, now-60s)` proved cleanly (`/prove` 200, 8–10 s) and was then **rejected at
pool validation, instantly**:

```
RPC-CORE: submitAndWatchExtrinsic: ExtrinsicStatus:: 1010: Invalid Transaction: Custom error: 117
Error: Unexpected error submitting scoped transaction '<unnamed>':
  (FiberFailure) SubmissionError: Transaction submission error
  └─ SubmissionError: Transaction submission failed
     └─ RpcError: 1010: Invalid Transaction: Custom error: 117
```

`117` on node 1.0.x = **`Malformed.NotNormalized`**, "transaction is not in normal form"
(docs *Node error codes*; servicedesk `node-1010-custom-error-runbook`). Reproduced twice,
under `onchain-runtime-v3` 3.0.0 **and** 3.1.2 — identical.

## The pattern: deploys land, calls do not

On-chain state of both contracts, read from the indexer (not from the hung client):

| Contract | Deploy path | Latest on-chain action | `ContractCall` ever? |
|---|---|---|---|
| `4996ab7f…4965d` (counter) | plain one-shot | `ContractDeploy` @ 1547724 | **never** |
| `48e2cfce…2d9eb6` (epoch_proof) | batched + 3 updates | `ContractUpdate` @ 1535552 | **never** |

`epoch_proof`'s batched deploy *and* all three verifier-key maintenance updates were
included without trouble. So the variable is **not** batched-vs-one-shot deployment —
both deploy paths work. The variable is **call vs deploy/update**.

The two call failures differ only in which check catches them: `register`'s transcript
fails at pool validation (`117`, with a code), the counter's passes pool validation and is
dropped at pre-dispatch (no code). Both are the same wall.

**The chain is healthy.** Blocks every ~6 s (1554099 → 1554440 observed live), indexer
current with the node. Nothing is stalled.

## Why this looks like an ecosystem gap

Ledger 8.1.3 (security advisory GHSA-wr7g-rr4v-jmj8, shipped in node 1.0.400) narrowed the
validity rules **specifically for contract call transcripts**:

> Contract call transcripts must use canonical field values in `push`, `pushs`, and
> `idx`-style path keys. A Merkle tree in `push` or `pushs` must be empty, and transcripts
> cannot contain `noop` with a count of 0. A node on 8.1.3 rejects some contract calls that
> a node on 8.1.2 accepts.

Deploys and maintenance updates are not governed by those rules — which matches exactly
what we observe. A client building call transcripts on ledger-v8 8.1.0 against a node
enforcing 8.1.3 would show precisely this: deploys fine, calls rejected.

**This contradicts the published guidance.** The node 1.0.400 release notes state:

> DApp developers do not need to change how they build transactions. Transactions built
> with the Compact compiler and Midnight.js versions in the compatibility matrix do not
> contain the values or operations that ledger 8.1.3 rejects.

Our stack *is* the matrix set, and a contract as trivial as `round.increment(1)` is
rejected. Either the guidance is wrong, or something in the matrix set emits a
non-canonical transcript.

Note also the bind: the 8.1.3 release notes tell DApp developers on midnight-js 4.1.1 to
**stay** on `ledger-v8` 8.1.0 ("the copy that Midnight.js uses"), so simply bumping the
client ledger to 8.1.3 is not an available fix.

## Ruled out (do not revisit)

- **ZKIR version.** The proof server accepted every proof (`/check` + `/prove` both 200,
  4 separate calls). The committed ZKIR is `ir-source[v2]`, which proof-server 8.1.x reads.
  No `400 bad input` was ever produced. Recompiling without `--feature-zkir-v3` is moot —
  the flag is used nowhere.
- **`onchain-runtime-v3` 3.0.0 vs 3.1.2.** `register` returned `117` under both. The pin is
  now 3.1.2 (ledger-8.1.3-aligned, single physical copy, all 6 live symlinks on it,
  confirmed with `pnpm why`). Keep it; it is correct and it is not the cause.
- **The compiler.** `dist/epoch_proof/compiler/contract-info.json` reports
  `compiler-version 0.31.1`, the matrix version. Recompiling would reproduce byte-identical
  output. The minimal counter was compiled fresh with the same 0.31.1 and fails too.
- **The batched deploy / `restrictDeployTo`.** Disproved by Reproduction A: a plainly
  deployed contract that never went near `restrictDeployTo` fails the same way.
- **Wallet sync state.** `waitForSync` gates on `isSynced`; balances are correct
  (NIGHT 5000000000, DUST 2.5e19) and the deploy from the same synced wallet landed.
- **Chain health.** Blocks every ~6 s, indexer current.

## Not yet established

- Whether other people's contract calls are landing on Preview. A scan of the last 40
  blocks found **zero contract actions network-wide** — Preview is idle — so we have no
  control group, and a transient Preview-side inclusion problem is not fully excluded.
- The actual pre-dispatch rejection reason. It exists only in the node's own log
  (`Rejecting transaction <hash> at pre-dispatch: …`), unreadable on a public endpoint.

## Next step (decision pending)

1. **Escalate** — file the Reproduction A minimal repro with Midnight servicedesk.
2. **Local node** — run the same counter call against `midnight-local-dev`, where the node
   log is readable, to capture the exact pre-dispatch reason and separate the 8.1.3
   call-transcript gap from anything specific to this monorepo's dependency topology.

## Reproducing

```sh
pnpm --filter @mmr/dapp exec tsx src/counter-check.ts   # attaches to 4996ab7f…, calls increment()
pnpm --filter @mmr/dapp run register-check              # attaches to 48e2cfce…, calls register()
```

Both need the local proof server (`pnpm --filter @mmr/dapp run proof-server`). Neither
deploys anything. Check inclusion against the indexer rather than the client, which hangs:

```sh
curl -s -H 'content-type: application/json' \
  --data '{"query":"{contractAction(address:\"<addr>\"){__typename transaction{block{height}}}}"}' \
  https://indexer.preview.midnight.network/api/v4/graphql
```

---

# Update 2026-11-01: local-node test — **the call lands on a local 8.1.3 node**

The ledger-version hypothesis above is **disproved**. The same client, the same
dependency tree and the same compiled counter deploy *and* call successfully against a
local node that is byte-identical to Preview's. The blocker is **Preview-specific**.

## Local stack

[midnight-local-dev](https://github.com/midnightntwrk/midnight-local-dev) `standalone.yml`,
with `standalone.override.yml` raising the node and proof server to Preview's versions
(the repo pins node 1.0.0 / proof-server 8.1.0):

| Component | Local | Preview | Same? |
|---|---|---|---|
| `system_version` | `1.0.400-87c0fbdb` | `1.0.400-87c0fbdb` | **identical build hash** |
| `midnight_ledgerVersion` | `=8.1.3` | `=8.1.3` | **yes** |
| proof server | 8.1.3 | 8.1.3 | yes |
| indexer | `indexer-standalone:4.3.3` | Preview indexer | no (unavoidable) |
| network id | `undeployed` | `preview` | no (unavoidable) |
| wallet | genesis dev seed `00…01` | our funded Preview wallet | no |

Client side is literally the same checkout: midnight-js 4.1.1, `ledger-v8` 8.1.0,
`onchain-runtime-v3` 3.1.2, `compact-runtime` 0.16.0, and the *same*
`scratch/counter-build` artifacts (compiler 0.31.1, `ir-source[v2]`). Run with endpoint
env overrides only — no code, pin or config change:

```sh
NETWORK_ID=undeployed MIDNIGHT_NODE_URL=http://localhost:9944 \
MIDNIGHT_INDEXER_URL=http://localhost:8088/api/v4/graphql \
MIDNIGHT_INDEXER_WS_URL=ws://localhost:8088/api/v4/graphql/ws \
PROOF_SERVER_URL=http://localhost:6300 \
DEPLOY_SEED=0000000000000000000000000000000000000000000000000000000000000001 \
pnpm --filter @mmr/dapp exec tsx src/counter-check.ts
```

## Result: deploy **and** call both succeed

```
  ✓ contract addr 641d475a8dba95626261bfd3e22c317502f889ea5071ab968578d0e6fa9bb3f3
    deploy tx     0064375c3f0eae01fdd9fb6e5ceb5d0f76eb396a334a9fa7bbea289eac12cd77d3
    block height  10
    proof+submit  20.1s

  ✓ increment tx  000b42d088a3665834139a21bb711214feaf7add78a7163f981f17fdcb31fc62f1
    block height  14
    proof+submit  23.1s
```

Confirmed on chain by the local indexer — the thing that has never appeared on Preview:

```json
{ "contractAction": { "__typename": "ContractCall",
    "transaction": { "hash": "097ac413…74b2", "block": { "height": 14 } } } }
```

**The node log contains zero rejections.** No `Rejecting transaction … at pre-dispatch`,
no `Rejected … from mempool`, no `guaranteed execution would fail` — the grep count is 0.
Both transactions appear only as:

```
2026-11-01 16:20:46 📋 Validated transaction be8a647b…c52a for mempool
2026-11-01 16:21:06 📋 Validated transaction 097ac413…74b2 for mempool
```

So **there is no pre-dispatch rejection reason to capture**: locally nothing is rejected.
The artifact the ticket wanted does not exist on a node that behaves correctly, which is
itself the finding.

## What this eliminates

A node on ledger 8.1.3, same build hash as Preview's, accepts a call transcript built by
midnight-js 4.1.1 on `ledger-v8` 8.1.0. Therefore **none** of these is the cause:

- the ledger 8.1.3 call-transcript rules (GHSA-wr7g-rr4v-jmj8) — 8.1.3 accepts ours
- the 8.1.0-client ↔ 8.1.3-node version gap — that exact pairing works
- this monorepo's `onchain-runtime-v3` topology / pnpm overrides — unchanged between runs
- the Compact compiler, the circuits or the ZKIR — same artifacts, both outcomes
- `restrictDeployTo` / the batched deploy — already excluded, and not involved here

The **bonus ledger-8.1.0 control arm is moot**: it was meant to show "8.1.3 rejects what
8.1.0 accepts", and 8.1.3 does not reject. Running node 1.0.0 would test a hypothesis that
is already disproved, so it was not run.

## What is left

The difference is Preview itself. Remaining uncontrolled variables, narrowest first:

1. **Preview's chain/ledger state** — a live chain at ~1.55 M blocks vs a fresh dev chain.
2. **The wallet.** Our Preview wallet has ~280 k shielded events and DUST obtained by
   registration; the local one is the genesis dev wallet with full DUST. A fee/DUST spend
   structure that only arises on the Preview wallet would fit `NotNormalized`, and the node
   changelog has precedent: *"Fix `NotNormalized` error when dust spends and registrations
   are empty — omit `DustActions` if it's a No-op."*
3. **Network id** `preview` vs `undeployed` (affects transaction encoding; note a plain
   mismatch would be 166 `InvalidNetworkId`, not 117).
4. **The public endpoint / block-producer fleet.** Preview reports the same build hash, but
   its producers are not observable from outside.

Note (2) is the only one that also explains the deploy/call asymmetry on Preview, since
deploys and maintenance updates from that same wallet land.

## Revised recommendation

File with servicedesk. The ticket is now much stronger than "our calls vanish": a minimal
counter, matrix toolchain, **works on local node 1.0.400/8.1.3 and fails on Preview with
the identical binary and client** — on Preview `register` gets `117 NotNormalized` at pool
validation and `increment` is dropped with no code at all, while deploys and maintenance
updates from the same wallet land. Only Midnight can inspect Preview's producer logs for
the `Rejecting transaction … at pre-dispatch` line we cannot see.

## Reproducing the local stack

```sh
git clone https://github.com/midnightntwrk/midnight-local-dev.git ~/midnight-local-dev
# standalone.override.yml pins node 1.0.400 + proof-server 8.1.3 (repo pins 1.0.0 / 8.1.0)
cd ~/midnight-local-dev && docker compose -f standalone.yml -f standalone.override.yml up -d
curl -s -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"midnight_ledgerVersion","params":[]}' \
  http://localhost:9944            # must report =8.1.3
docker logs -f midnight-node       # watch for Rejecting/Rejected lines
```

Images: `midnight-node:1.0.400` (1.2 GB), `indexer-standalone:4.3.3` (231 MB),
`proof-server:8.1.3` (114 MB). Ports 9944 / 8088 / 6300 — the local proof server takes
6300, so stop any standalone `mmr-proof-server` first.
