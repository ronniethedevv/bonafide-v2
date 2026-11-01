# midnight-js 4.1.1 contract calls silently dropped / `117 NotNormalized` on Preview, but an identical binary + client accepts them on a local node

**Status:** DRAFT — not submitted. Internal review first.
**Reporter environment:** Linux x86_64 (WSL2), Node 24.22.0, Docker 28.x.
**Dates observed:** 2026-10-31 and 2026-11-01.

## Summary

No contract **call** we submit to Preview is ever included in a block. Contract **deploys**
and **maintenance updates** from the same wallet, client and proof server are included
without trouble.

Running the identical client against a **local** node of the same version — same
`system_version` build hash, same `midnight_ledgerVersion` — the same call **succeeds**.
So this is not the ledger version and not (as far as we can determine) our client.

Two symptoms on Preview, which we believe are one problem caught at two different checks:

- `epoch_proof.register(...)` → rejected at pool validation with
  `1010 Invalid Transaction: Custom error: 117` (`Malformed.NotNormalized`), in seconds.
- a one-circuit `counter.increment()` → **no RPC error at all**; admitted to the pool, then
  never included. The client blocks in submit/watch indefinitely.

## The comparison

| Node | `system_version` | `midnight_ledgerVersion` | Call result |
|---|---|---|---|
| **Local** (midnight-local-dev, `CFG_PRESET=dev`) | `1.0.400-87c0fbdb` | `=8.1.3` | **LANDED** — `ContractCall` at block **14** |
| **Preview** (`rpc.preview.midnight.network`) | `1.0.400-87c0fbdb` | `=8.1.3` | `register` → **117**; `increment` → **silently dropped**, never included |

The build hashes are **byte-identical strings**, queried live from both nodes. The client
is the same working tree in both rows, with only endpoint environment variables changed —
no dependency, pin, or contract change between the two runs.

## Client / toolchain versions (both rows)

| Component | Version |
|---|---|
| `@midnight-ntwrk/midnight-js-*` | 4.1.1 |
| `@midnight-ntwrk/ledger-v8` | 8.1.0 (the copy midnight-js 4.1.1 pins) |
| `@midnight-ntwrk/onchain-runtime-v3` | 3.1.2 (pnpm override; single physical copy, verified with `pnpm why`) |
| `@midnight-ntwrk/compact-runtime` | 0.16.0 |
| Compact compiler / language / runtime | 0.31.1 / 0.23.0 / 0.16.0 |
| ZKIR | `midnight:ir-source[v2]` |
| Proof server | 8.1.3 (`midnightntwrk/proof-server:8.1.3`, local in both rows) |
| Indexer | Preview indexer / `indexer-standalone:4.3.3` |

This is the Preview support-matrix set, except `onchain-runtime-v3`, which the matrix lists
as 3.0.0. We tried both: `register` returns `117` under 3.0.0 **and** 3.1.2, identically.

## Reproduction 1 — minimal: a one-circuit counter

The whole contract:

```compact
pragma language_version 0.23;
import CompactStandardLibrary;
export ledger round: Counter;
export circuit increment(): [] { round.increment(1); }
```

Compiled with `compact compile` on the matrix toolchain 0.31.1 (1.9 s, full ZK keys).
Deployed with plain `deployContract` — one shot, no batching, no hand-built state, no
maintenance updates. Called with `findDeployedContract(...).callTx.increment()`.

### On Preview — deploy lands, call never does

```
contract address   4996ab7fb52c9eb74b8099fe25e4027782e04bc0b93d2efec71d5dfaf3b4965d
deploy tx hash     c74e120aa47fadaefddb0f27ca8668be7b96d03d9d2d417b42f1dac35202eef2
                   (SDK identifier 002aeb69ebee0060a59e03d2b342911752e71d28ce6fe2eb468683e80bdf97e05e)
deploy block       1547724
```

Then two `increment()` attempts, both of which proved cleanly and were never included:

| Attempt (UTC) | `POST /check` | `POST /prove` | Node response | Inclusion |
|---|---|---|---|---|
| 2026-11-01 14:32:45 | 200, 13.7 ms | 200, 2.58 s | **none** | none after 42 min |
| 2026-11-01 15:23:04 | 200, 2.3 ms | 200, 0.079 s | **none** | none after 4 min (polled every 15 s) |

The node returned no `1010`, no `Custom error`, nothing. We polled the indexer directly
rather than trusting the hanging client:

```graphql
{ contractAction(address: "4996ab7f…4965d") { __typename transaction { block { height } } } }
```
```json
{ "contractAction": { "__typename": "ContractDeploy",
    "transaction": { "block": { "height": 1547724 } } } }
```

Still `ContractDeploy` — no `ContractCall` has ever existed on this contract.

Preview was healthy throughout: blocks every ~6 s (observed 1554099 → 1554440 live),
indexer current with the node.

### On a local node — the same call lands

Same contract artifacts, same client, endpoints switched to the local stack:

```
contract address   641d475a8dba95626261bfd3e22c317502f889ea5071ab968578d0e6fa9bb3f3
deploy  tx         0064375c3f0eae01fdd9fb6e5ceb5d0f76eb396a334a9fa7bbea289eac12cd77d3   block 10   20.1 s
increment tx       000b42d088a3665834139a21bb711214feaf7add78a7163f981f17fdcb31fc62f1   block 14   23.1 s
```

Local indexer confirms the call:

```json
{ "contractAction": { "__typename": "ContractCall",
    "transaction": { "hash": "097ac413122248f9d815e62c0ee304b0dc56ec60dadfaef5122676e9c03674b2",
                     "block": { "height": 14 } } } }
```

The local node log has **zero** rejection lines — no `Rejecting transaction … at
pre-dispatch`, no `Rejected … from mempool`, no `guaranteed execution would fail`. Both
transactions appear only as:

```
2026-11-01 16:20:46 📋 Validated transaction be8a647b0c08382984b2356b448f545c11e33c4c117787fde32fce0f97d5c52a for mempool
2026-11-01 16:21:06 📋 Validated transaction 097ac413122248f9d815e62c0ee304b0dc56ec60dadfaef5122676e9c03674b2 for mempool
```

## Reproduction 2 — the original symptom, `117` on Preview

Our real contract, `epoch_proof` (11 exported circuits), at
`48e2cfceccd0a7b771f5bb71337455f2df03540aadcaf0bc3687d310e52d9eb6` on Preview.

`register(1, now-60s)` proved cleanly (`/prove` 200, 8–10 s) and was then rejected
instantly, twice (2026-10-31 20:29 UTC and 21:19 UTC):

```
RPC-CORE: submitAndWatchExtrinsic(extrinsic: Extrinsic): ExtrinsicStatus:: 1010: Invalid Transaction: Custom error: 117

Error: Unexpected error submitting scoped transaction '<unnamed>':
  (FiberFailure) SubmissionError: Transaction submission error
  └─ SubmissionError: Transaction submission failed
     └─ RpcError: 1010: Invalid Transaction: Custom error: 117
```

`117` on node 1.0.x = `Malformed.NotNormalized`.

### The asymmetry, on the same contract and wallet

This contract was deployed batched (8 verifier keys in the deploy, 3 added by separate
maintenance updates, because all 11 overflow one block's `bytesWritten`). **All of that
landed:**

| Contract | Deploy path | Latest on-chain action on Preview | `ContractCall` ever? |
|---|---|---|---|
| `48e2cfce…2d9eb6` (epoch_proof) | batched + 3 maintenance updates | `ContractUpdate` @ 1535552 | **never** |
| `4996ab7f…4965d` (counter) | plain one-shot | `ContractDeploy` @ 1547724 | **never** |

Deploys land. Maintenance updates land. Calls never land. Same wallet in every case.

### The same contract, the same circuit, batched the same way — lands locally

We reproduced `epoch_proof` end to end on the local node: the **same** batched deploy path
(8 verifier keys in the deploy, 3 added by maintenance update) and then the **same**
`register` circuit that returns `117` on Preview.

```
[EXECUTE] 11 provable circuits, 22541 verifier-key bytes
[EXECUTE] batch 1 (deploy): 8 circuits: register, proveEpoch, claim, activate, postBond, settleEpoch, releaseEpoch, voidUnfunded
[EXECUTE]   stopped at 'defaultEngagement': would exceed bytesWritten 30405 > 30000
[EXECUTE] contract address: 404dd5be82e60fa64c98b73dd4f72ca1c556e9e98ed418a93de748c3e5fdea73
[EXECUTE] batch 1 finalized in block 157 (tx 004beba50405929ce85af38fee02ade9077b52e5ce1f109f409104cdee0db64a07)
  + defaultEngagement inserted (block 160) [1/3]
  + publishRoot inserted (block 163) [2/3]
  + proveFunding inserted (block 166) [3/3]

confirming findDeployedContract()…
  attached to       404dd5be82e60fa64c98b73dd4f72ca1c556e9e98ed418a93de748c3e5fdea73

proof-server sanity check: proving `register`…
  register tx       007f0b9243cb7a0098964caca85128a60b7751fb466991f952ac8f1a67df09cdea
  block height      171
  proof + submit    29.4s
```

**`register` is included at block 171**, with zero rejection lines in the node log. The
identical call on Preview returns `1010 … Custom error: 117`.

So for the one circuit where Preview gives us an actual error code, we have a direct A/B:

| | Local node `1.0.400-87c0fbdb` / ledger `=8.1.3` | Preview `1.0.400-87c0fbdb` / ledger `=8.1.3` |
|---|---|---|
| batched deploy (8 + 3 updates) | included, blocks 157–166 | included, blocks 1535539–1535552 |
| `register(1, now-60s)` | **included, block 171** | **`117 NotNormalized`, rejected at pool** |

The contract, the deploy path, the circuit, the witnesses, the client and the node build
are the same in both columns.

## What we have eliminated

A node on ledger 8.1.3 with Preview's exact build hash accepts a call transcript built by
midnight-js 4.1.1 on `ledger-v8` 8.1.0. Therefore:

- **Not** the ledger 8.1.3 stricter call-transcript rules (GHSA-wr7g-rr4v-jmj8). We
  initially suspected these — `noop 0` / non-canonical field values in `push`/`pushs`/`idx`
  path keys — but 8.1.3 accepts our calls locally.
- **Not** the 8.1.0-client ↔ 8.1.3-node pairing. That exact pairing works.
- **Not** our dependency topology. `onchain-runtime-v3` is a single physical copy at 3.1.2;
  the same tree produces both outcomes. `register` also returns `117` under 3.0.0.
- **Not** the compiler, circuits or ZKIR. Identical artifacts (`ir-source[v2]`, compiler
  0.31.1) succeed locally and fail on Preview. The proof server accepted **every** proof we
  ever submitted — `/check` and `/prove` both 200, six separate calls, no `400 bad input`.
- **Not** the batched deploy or our hand-built contract state. The plainly-deployed counter
  fails on Preview the same way, and the batched `epoch_proof` — with `register` — succeeds
  locally.
- **Not** wallet sync. Our sync gate waits for `isSynced`; balances are correct
  (NIGHT 5000000000, DUST 25000000000000000000) and deploys from that synced wallet land.
- **Not** chain health. Preview produced blocks every ~6 s throughout.

## Leading hypothesis: registration-derived DUST in the fee spend

The remaining difference between the two rows is Preview itself, and the narrowest
candidate is **the wallet's DUST**:

- Our Preview wallet obtained DUST by **registering** NIGHT UTXOs for DUST generation.
- The local wallet is the `CFG_PRESET=dev` genesis wallet (seed `00…01`), whose DUST is
  natively full (`total == capacity`) and never registered.

There is direct precedent for `NotNormalized` arising from the DUST portion of a
transaction rather than the contract transcript. midnight-node's own changelog, in
`node-0.22.0` through `node-0.22.3`:

> **Fix `NotNormalized` error when dust spends and registrations are empty** — "Fixes the
> toolkit to omit `DustActions` in a transaction if it's a No-op. Resolves `NotNormalized`
> errors." (PR midnightntwrk/midnight-node#758, PM-21958)

That fix was applied to the **node toolkit**. If the wallet SDK / midnight-js call path can
likewise emit a no-op or otherwise non-normalized `DustActions` for a transaction whose fee
is paid from registration-derived DUST, it would explain all of our observations at once —
including why deploys and maintenance updates from the same wallet land while calls do not,
if their DUST spend structure differs.

We have not been able to confirm this ourselves; we cannot inspect the built transaction's
`DustActions` through the public SDK surface, and we cannot read Preview's producer logs.

## What we are asking for

1. **Please confirm or refute the DUST hypothesis** — specifically, whether a transaction
   whose fee is paid from registration-derived DUST can carry a `DustActions` structure
   that ledger 8.1.3 considers not normalized, and whether the node#758 toolkit fix has an
   equivalent on the wallet-SDK / midnight-js 4.1.1 path.
2. **Is there a client-side fix or workaround for midnight-js 4.1.1?** Note the ledger
   8.1.3 release notes direct midnight-js 4.1.1 projects to **stay** on `ledger-v8` 8.1.0
   ("the copy that Midnight.js uses"), so bumping the client ledger to 8.1.3 is not
   presented as an available option. If it is in fact the right move here, please say so.
3. **Please check a Preview block producer's log** for the pre-dispatch rejection of our
   dropped `increment` transactions and share the reason verbatim — the
   `Rejecting transaction <hash> at pre-dispatch: guaranteed execution would fail: …` line.
   This is the one piece of evidence we cannot obtain: the drop returns no code to the
   client, so **we never learn the transaction hash of a dropped call** and cannot look it
   up ourselves. To locate them, these are the submissions:

   | What | When (UTC) | Contract | Submitter (shielded address) |
   |---|---|---|---|
   | `increment()` attempt 1 | 2026-11-01, just after 14:32:45 | `4996ab7f…4965d` | `mn_shield-addr_preview19fk8ll9hxf0hdyaxzy7r8ht8lu4t99wn2jsdyxwuvy6cx2xst6gw8mly7ddfcl6kvl29h8s3l8cu0w30j3d9m5k8haxg8wx4p7n9rwcx2yzyg` |
   | `increment()` attempt 2 | 2026-11-01, just after 15:23:04 | `4996ab7f…4965d` | same |
   | `register()` attempt 1 (got `117`) | 2026-10-31, 20:29 | `48e2cfce…2d9eb6` | same |
   | `register()` attempt 2 (got `117`) | 2026-10-31, 21:19 | `48e2cfce…2d9eb6` | same |

4. **Is this known / are others affected?** A scan of the last 40 Preview blocks found
   **zero contract actions network-wide**, so we had no control group and cannot tell
   whether anyone else's calls are currently landing on Preview.

## Reproducing the local (working) side

```sh
git clone https://github.com/midnightntwrk/midnight-local-dev.git
cd midnight-local-dev
```

`standalone.override.yml`, to raise the repo's pins (node 1.0.0, proof-server 8.1.0) to
Preview's versions:

```yaml
services:
  node:
    image: 'midnightntwrk/midnight-node:1.0.400'
  proof-server:
    image: 'midnightntwrk/proof-server:8.1.3'
```

```sh
docker compose -f standalone.yml -f standalone.override.yml up -d

# must report =8.1.3
curl -s -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"midnight_ledgerVersion","params":[]}' \
  http://localhost:9944

docker logs -f midnight-node     # watch for Rejecting / Rejected lines
```

Then deploy the counter above with plain `deployContract` and call `increment()`, pointing
the client at `http://localhost:9944`, `http://localhost:8088/api/v4/graphql` and
`http://localhost:6300`, with `NETWORK_ID=undeployed` and the genesis seed
`0000000000000000000000000000000000000000000000000000000000000001`. The call lands.

Point the same client at Preview with a registration-funded wallet and the call never
lands.

## Checking inclusion without trusting the client

The client hangs rather than erroring on a dropped call, so inclusion must be checked
against the indexer:

```sh
curl -s -H 'content-type: application/json' \
  --data '{"query":"{contractAction(address:\"<addr>\"){__typename transaction{hash block{height}}}}"}' \
  <indexer>/api/v4/graphql
```

`__typename` stays `ContractDeploy` for as long as no call has landed.
