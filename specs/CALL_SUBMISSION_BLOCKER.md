# Blocker: contract **calls** are never included on Preview (deploys and updates are)

**Status:** open, unresolved. Suspected ecosystem gap, not an `mm-reputation` bug.
**Recorded:** 2026-11-01. **Network:** Midnight Preview.

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
