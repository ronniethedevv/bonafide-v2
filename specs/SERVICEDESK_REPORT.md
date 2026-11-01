# Contract calls are not included on Preview (117 NotNormalized / silent drop), but the same call works on a local node of the same version

**Status:** DRAFT. Internal review before submitting.
**Reporter environment:** Linux x86_64 (WSL2), Node 24.22.0, Docker 28.x.
**Dates observed:** 2026-10-31 and 2026-11-01.

## The problem in plain terms

When we send a contract **call** to the Preview testnet, it never makes it into a block.
Contract **deploys** and maintenance updates from the same wallet, same client, and same
proof server go through fine. Only calls fail.

We ran the exact same client against a **local** Midnight node built from the same version
(same `system_version` hash, same `midnight_ledgerVersion`), and there the same call
**succeeds**. So the problem is specific to Preview. It is not the ledger version, and as
far as we can tell it is not our code.

There are two symptoms, which we think are one problem caught at two different checks:

1. `epoch_proof.register(...)` is rejected right away at mempool validation with
   `1010 Invalid Transaction: Custom error: 117` (`Malformed.NotNormalized`).
2. A one-circuit `counter.increment()` gets no error at all. It is accepted into the
   mempool, then never included. The client waits forever.

## Side by side

| Node | `system_version` | `midnight_ledgerVersion` | Call result |
|---|---|---|---|
| **Local** (midnight-local-dev, `CFG_PRESET=dev`) | `1.0.400-87c0fbdb` | `=8.1.3` | LANDED. `ContractCall` at block 14 |
| **Preview** (`rpc.preview.midnight.network`) | `1.0.400-87c0fbdb` | `=8.1.3` | `register` returns 117. `increment` is dropped, never included |

The build-hash strings are identical. We queried both nodes live. The client is the same
working tree in both rows. Only the endpoint environment variables changed. No dependency,
pin, or contract change between the two runs.

## Client and toolchain versions (both rows)

| Component | Version |
|---|---|
| `@midnight-ntwrk/midnight-js-*` | 4.1.1 |
| `@midnight-ntwrk/ledger-v8` | 8.1.0 (the copy midnight-js 4.1.1 pins) |
| `@midnight-ntwrk/onchain-runtime-v3` | 3.1.2 (pnpm override, single physical copy, confirmed with `pnpm why`) |
| `@midnight-ntwrk/compact-runtime` | 0.16.0 |
| Compact compiler / language / runtime | 0.31.1 / 0.23.0 / 0.16.0 |
| ZKIR | `midnight:ir-source[v2]` |
| Proof server | 8.1.3 (`midnightntwrk/proof-server:8.1.3`, local in both rows) |
| Indexer | Preview indexer, and `indexer-standalone:4.3.3` locally |

This is the Preview support-matrix set, except for `onchain-runtime-v3`, which the matrix
lists as 3.0.0. We tried both. `register` returns 117 under 3.0.0 and under 3.1.2, the same
way.

## Reproduction 1: a one-circuit counter

The whole contract:

```compact
pragma language_version 0.23;
import CompactStandardLibrary;
export ledger round: Counter;
export circuit increment(): [] { round.increment(1); }
```

Compiled with `compact compile` on the matrix toolchain 0.31.1 (1.9 s, full ZK keys).
Deployed with plain `deployContract`: one shot, no batching, no hand-built state, no
maintenance updates. Called with `findDeployedContract(...).callTx.increment()`.

### On Preview: the deploy lands, the call never does

```
contract address   4996ab7fb52c9eb74b8099fe25e4027782e04bc0b93d2efec71d5dfaf3b4965d
deploy tx hash     c74e120aa47fadaefddb0f27ca8668be7b96d03d9d2d417b42f1dac35202eef2
                   (SDK identifier 002aeb69ebee0060a59e03d2b342911752e71d28ce6fe2eb468683e80bdf97e05e)
deploy block       1547724
```

Two `increment()` attempts. Both proved cleanly and were never included:

| Attempt (UTC) | `POST /check` | `POST /prove` | Node response | Inclusion |
|---|---|---|---|---|
| 2026-11-01 14:32:45 | 200, 13.7 ms | 200, 2.58 s | none | none after 42 min |
| 2026-11-01 15:23:04 | 200, 2.3 ms | 200, 0.079 s | none | none after 4 min (polled every 15 s) |

The node returned no `1010`, no `Custom error`, nothing. We polled the indexer directly
instead of trusting the client, which hangs:

```graphql
{ contractAction(address: "4996ab7f...4965d") { __typename transaction { block { height } } } }
```
```json
{ "contractAction": { "__typename": "ContractDeploy",
    "transaction": { "block": { "height": 1547724 } } } }
```

Still `ContractDeploy`. No `ContractCall` has ever existed on this contract.

Preview was healthy the whole time: blocks every 6 s or so (we watched 1554099 go to
1554440 live), indexer current with the node.

### On a local node: the same call lands

Same contract artifacts, same client, endpoints switched to the local stack:

```
contract address   641d475a8dba95626261bfd3e22c317502f889ea5071ab968578d0e6fa9bb3f3
deploy  tx         0064375c3f0eae01fdd9fb6e5ceb5d0f76eb396a334a9fa7bbea289eac12cd77d3   block 10   20.1 s
increment tx       000b42d088a3665834139a21bb711214feaf7add78a7163f981f17fdcb31fc62f1   block 14   23.1 s
```

The local indexer confirms the call:

```json
{ "contractAction": { "__typename": "ContractCall",
    "transaction": { "hash": "097ac413122248f9d815e62c0ee304b0dc56ec60dadfaef5122676e9c03674b2",
                     "block": { "height": 14 } } } }
```

The local node log has no rejection lines. No `Rejecting transaction ... at pre-dispatch`,
no `Rejected ... from mempool`, no `guaranteed execution would fail`. Both transactions
show up only as:

```
2026-11-01 16:20:46 Validated transaction be8a647b0c08382984b2356b448f545c11e33c4c117787fde32fce0f97d5c52a for mempool
2026-11-01 16:21:06 Validated transaction 097ac413122248f9d815e62c0ee304b0dc56ec60dadfaef5122676e9c03674b2 for mempool
```

## Reproduction 2: the original symptom, 117 on Preview

Our real contract, `epoch_proof` (11 exported circuits), at
`48e2cfceccd0a7b771f5bb71337455f2df03540aadcaf0bc3687d310e52d9eb6` on Preview.

`register(1, now-60s)` proved cleanly (`/prove` 200, 8 to 10 s) and was then rejected
instantly, twice (2026-10-31 20:29 UTC and 21:19 UTC):

```
RPC-CORE: submitAndWatchExtrinsic(extrinsic: Extrinsic): ExtrinsicStatus:: 1010: Invalid Transaction: Custom error: 117

Error: Unexpected error submitting scoped transaction '<unnamed>':
  (FiberFailure) SubmissionError: Transaction submission error
    SubmissionError: Transaction submission failed
      RpcError: 1010: Invalid Transaction: Custom error: 117
```

`117` on node 1.0.x is `Malformed.NotNormalized`.

### The pattern, on the same contract and wallet

This contract was deployed in batches (8 verifier keys in the deploy, 3 added by separate
maintenance updates, because all 11 overflow one block's `bytesWritten`). All of that
landed:

| Contract | Deploy path | Latest on-chain action on Preview | Any `ContractCall`? |
|---|---|---|---|
| `48e2cfce...2d9eb6` (epoch_proof) | batched, plus 3 maintenance updates | `ContractUpdate` at 1535552 | never |
| `4996ab7f...4965d` (counter) | plain one-shot | `ContractDeploy` at 1547724 | never |

Deploys land. Maintenance updates land. Calls never land. Same wallet in every case.

### The same contract, same circuit, batched the same way, lands locally

We reproduced `epoch_proof` end to end on the local node. The same batched deploy path
(8 verifier keys in the deploy, 3 added by maintenance update), then the same `register`
circuit that returns 117 on Preview.

```
[EXECUTE] 11 provable circuits, 22541 verifier-key bytes
[EXECUTE] batch 1 (deploy): 8 circuits: register, proveEpoch, claim, activate, postBond, settleEpoch, releaseEpoch, voidUnfunded
[EXECUTE]   stopped at 'defaultEngagement': would exceed bytesWritten 30405 > 30000
[EXECUTE] contract address: 404dd5be82e60fa64c98b73dd4f72ca1c556e9e98ed418a93de748c3e5fdea73
[EXECUTE] batch 1 finalized in block 157 (tx 004beba50405929ce85af38fee02ade9077b52e5ce1f109f409104cdee0db64a07)
  + defaultEngagement inserted (block 160) [1/3]
  + publishRoot inserted (block 163) [2/3]
  + proveFunding inserted (block 166) [3/3]

confirming findDeployedContract()...
  attached to       404dd5be82e60fa64c98b73dd4f72ca1c556e9e98ed418a93de748c3e5fdea73

proof-server sanity check: proving `register`...
  register tx       007f0b9243cb7a0098964caca85128a60b7751fb466991f952ac8f1a67df09cdea
  block height      171
  proof + submit    29.4s
```

`register` is included at block 171, with no rejection lines in the node log. The identical
call on Preview returns `1010 ... Custom error: 117`.

So for the one circuit where Preview gives us an actual error code, we have a direct A/B:

| | Local node `1.0.400-87c0fbdb` / ledger `=8.1.3` | Preview `1.0.400-87c0fbdb` / ledger `=8.1.3` |
|---|---|---|
| batched deploy (8 plus 3 updates) | included, blocks 157 to 166 | included, blocks 1535539 to 1535552 |
| `register(1, now-60s)` | included, block 171 | `117 NotNormalized`, rejected at mempool |

The contract, the deploy path, the circuit, the witnesses, the client, and the node build
are the same in both columns.

## What we have ruled out

A node on ledger 8.1.3 with Preview's exact build hash accepts a call built by midnight-js
4.1.1 on `ledger-v8` 8.1.0. So the cause is none of these:

- **Not** the ledger 8.1.3 stricter call-transcript rules (GHSA-wr7g-rr4v-jmj8). We suspected
  these at first (`noop 0` or non-canonical field values in `push`/`pushs`/`idx` path keys),
  but 8.1.3 accepts our calls locally.
- **Not** the 8.1.0-client with 8.1.3-node combination. That exact combination works.
- **Not** our dependency setup. `onchain-runtime-v3` is a single physical copy at 3.1.2. The
  same tree produces both outcomes. `register` also returns 117 under 3.0.0.
- **Not** the compiler, circuits, or ZKIR. The same artifacts (`ir-source[v2]`, compiler
  0.31.1) succeed locally and fail on Preview. The proof server accepted every proof we sent.
  `/check` and `/prove` both 200, six separate calls, no `400 bad input`.
- **Not** the batched deploy or our hand-built contract state. The plainly-deployed counter
  fails on Preview the same way, and the batched `epoch_proof` with `register` succeeds
  locally.
- **Not** wallet sync. Our sync gate waits for `isSynced`. Balances are correct
  (NIGHT 5000000000, DUST 25000000000000000000), and deploys from that synced wallet land.
- **Not** chain health. Preview produced blocks every 6 s or so throughout.

## Our best guess: the wallet's DUST, which came from registration

The only difference left between the two rows is Preview itself, and the narrowest candidate
is the wallet's DUST:

- Our Preview wallet got its DUST by **registering** NIGHT UTXOs for DUST generation.
- The local wallet is the `CFG_PRESET=dev` genesis wallet (seed `00...01`). Its DUST is
  natively full (`total == capacity`) and was never registered.

There is a direct precedent for `NotNormalized` coming from the DUST part of a transaction
rather than the contract transcript. From midnight-node's own changelog, `node-0.22.0`
through `node-0.22.3`:

> **Fix NotNormalized error when dust spends and registrations are empty.** "Fixes the
> toolkit to omit `DustActions` in a transaction if it's a No-op. Resolves `NotNormalized`
> errors." (PR midnightntwrk/midnight-node#758, PM-21958)

That fix was applied to the node toolkit. If the wallet SDK or midnight-js call path can
emit a no-op or otherwise non-normalized `DustActions` for a transaction whose fee is paid
from registration-derived DUST, it would explain everything we see at once, including why
deploys and maintenance updates from the same wallet land while calls do not, if their DUST
spend structure differs.

We could not confirm this ourselves. We cannot inspect the built transaction's `DustActions`
through the public SDK surface, and we cannot read Preview's producer logs.

## What we are asking for

1. **Please confirm or rule out the DUST guess.** Specifically: can a transaction whose fee
   is paid from registration-derived DUST carry a `DustActions` structure that ledger 8.1.3
   treats as not normalized, and does the node#758 toolkit fix have an equivalent on the
   wallet-SDK or midnight-js 4.1.1 path?
2. **Is there a client-side fix or workaround for midnight-js 4.1.1?** The ledger 8.1.3
   release notes tell midnight-js 4.1.1 projects to stay on `ledger-v8` 8.1.0 ("the copy
   that Midnight.js uses"), so bumping the client ledger to 8.1.3 is not presented as an
   option. If it is in fact the right move here, please say so.
3. **Please check a Preview block producer's log** for the pre-dispatch rejection of our
   dropped `increment` transactions and share the reason, the
   `Rejecting transaction <hash> at pre-dispatch: guaranteed execution would fail: ...` line.
   This is the one piece of evidence we cannot get. The drop returns no code to the client,
   so we never learn the transaction hash of a dropped call and cannot look it up. To find
   them, these are the submissions:

   | What | When (UTC) | Contract | Submitter (shielded address) |
   |---|---|---|---|
   | `increment()` attempt 1 | 2026-11-01, just after 14:32:45 | `4996ab7f...4965d` | `mn_shield-addr_preview19fk8ll9hxf0hdyaxzy7r8ht8lu4t99wn2jsdyxwuvy6cx2xst6gw8mly7ddfcl6kvl29h8s3l8cu0w30j3d9m5k8haxg8wx4p7n9rwcx2yzyg` |
   | `increment()` attempt 2 | 2026-11-01, just after 15:23:04 | `4996ab7f...4965d` | same |
   | `register()` attempt 1 (got 117) | 2026-10-31, 20:29 | `48e2cfce...2d9eb6` | same |
   | `register()` attempt 2 (got 117) | 2026-10-31, 21:19 | `48e2cfce...2d9eb6` | same |

4. **Is this known, and are others affected?** A scan of the last 40 Preview blocks found no
   contract actions network-wide, so we had no control group and cannot tell whether anyone
   else's calls are landing on Preview right now.

## How to reproduce the local (working) side

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
the client at `http://localhost:9944`, `http://localhost:8088/api/v4/graphql`, and
`http://localhost:6300`, with `NETWORK_ID=undeployed` and the genesis seed
`0000000000000000000000000000000000000000000000000000000000000001`. The call lands.

Point the same client at Preview with a registration-funded wallet and the call never lands.

## How to check inclusion without trusting the client

The client hangs rather than erroring on a dropped call, so inclusion has to be checked
against the indexer:

```sh
curl -s -H 'content-type: application/json' \
  --data '{"query":"{contractAction(address:\"<addr>\"){__typename transaction{hash block{height}}}}"}' \
  <indexer>/api/v4/graphql
```

`__typename` stays `ContractDeploy` for as long as no call has landed.
