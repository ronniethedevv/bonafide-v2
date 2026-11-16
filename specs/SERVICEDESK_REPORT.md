# Contract calls are not included on Preview (117 NotNormalized / silent drop), but the same call works on a local node of the same version

**Status:** DRAFT. Internal review before submitting.

Contract **calls** submitted to the Preview testnet are never included in a block. Contract
**deploys** and maintenance updates from the same wallet, client, and proof server land
without trouble. The same call **succeeds** on a local node built from the identical
Midnight version (same `system_version` hash, same `midnight_ledgerVersion`), so this looks
specific to Preview, not to our client or contract.

> **Honest note on format.** This is a Preview testnet behaviour report, not a bug we can
> localise to one source line. The failure happens on Preview, which we cannot put in a
> self-contained failing unit test. The runnable reproduction below **passes** on a local
> node of the same version, and we give the exact steps to watch it **fail** on Preview.
> We flag this because `ai-reports.md` asks for a failing test, and here the only testable
> side is the one that works.

## 1. Branch and commit SHA

- **Reproduction code:** `github.com/ronniethedevv/mm-reputation`, branch
  `ccr-0ae4f61d-euy47e`, commit `d62b804` (current). The repro drivers are committed there
  (paths in section 2).
- **Node under test, both sides:** `system_version` `1.0.400-87c0fbdb`,
  `midnight_ledgerVersion` `=8.1.3`. Both values queried live from the local node and from
  `rpc.preview.midnight.network`. The build-hash strings are identical.

## 2. File paths and line references

Our reproduction files (in the repo above):

- `packages/dapp/scratch/counter.compact` (the minimal contract)
- `packages/dapp/src/counter-check.ts` (deploys with plain `deployContract`, attaches with
  `findDeployedContract`, calls `increment()`, checks inclusion via the indexer not the
  client)
- `packages/dapp/scratch/local-dev.standalone.override.yml` (raises midnight-local-dev to
  Preview's node and proof-server versions)

Suspected area in Midnight's own code, **unconfirmed**: the `DustActions` portion of the
transaction built on the wallet-SDK / midnight-js 4.1.1 submit path. The closest known
precedent is a prior node fix, PR `midnightntwrk/midnight-node#758` (PM-21958), "Fix
`NotNormalized` error when dust spends and registrations are empty".

We cannot give a confirmed Midnight source line. The failure is on Preview infrastructure,
we cannot read Preview's producer logs, and we cannot inspect the built transaction's
`DustActions` through the public SDK surface.

## 3. A runnable test case

The whole contract:

```compact
pragma language_version 0.23;
import CompactStandardLibrary;
export ledger round: Counter;
export circuit increment(): [] { round.increment(1); }
```

Compiled with `compact compile` on the matrix toolchain 0.31.1 (1.9 s, full ZK keys).
Deployed with plain `deployContract` (one shot, no batching). Called with
`findDeployedContract(...).callTx.increment()`.

Bring up a local node of Preview's exact version:

```sh
git clone https://github.com/midnightntwrk/midnight-local-dev.git
cd midnight-local-dev
# local-dev.standalone.override.yml:
#   services:
#     node:          { image: 'midnightntwrk/midnight-node:1.0.400' }
#     proof-server:  { image: 'midnightntwrk/proof-server:8.1.3' }
docker compose -f standalone.yml -f local-dev.standalone.override.yml up -d

# must report =8.1.3
curl -s -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"midnight_ledgerVersion","params":[]}' \
  http://localhost:9944

docker logs -f midnight-node     # watch for Rejecting / Rejected lines
```

Deploy the counter and call `increment()`, pointing the client at `http://localhost:9944`,
`http://localhost:8088/api/v4/graphql`, `http://localhost:6300`, with
`NETWORK_ID=undeployed` and the genesis seed
`0000000000000000000000000000000000000000000000000000000000000001`.

**On the local node the call lands.** To observe the failure, point the same client at
Preview with a registration-funded wallet. The call never lands (section 5).

## 4. Expected behaviour

The `increment()` (and `register()`) call is proved and then **included in a block**, the
same way it is on the local node: `increment` at block 14, `register` at block 171 (full
numbers in section 6).

## 5. Actual behaviour on Preview

- `epoch_proof.register(1, now-60s)` is rejected at mempool validation with
  `1010 Invalid Transaction: Custom error: 117` (`Malformed.NotNormalized`), in seconds.
- A one-circuit `counter.increment()` gets **no error at all**. It is admitted to the
  mempool, then never included. The client waits forever.
- Deploys and maintenance updates from the same wallet land normally.

## 6. Relevant logs, stack traces, and error output

### Preview `register` (error 117), twice (2026-10-31 20:29 and 21:19 UTC)

```
RPC-CORE: submitAndWatchExtrinsic(extrinsic: Extrinsic): ExtrinsicStatus:: 1010: Invalid Transaction: Custom error: 117

Error: Unexpected error submitting scoped transaction '<unnamed>':
  (FiberFailure) SubmissionError: Transaction submission error
    SubmissionError: Transaction submission failed
      RpcError: 1010: Invalid Transaction: Custom error: 117
```

`117` on node 1.0.x is `Malformed.NotNormalized`. Contract
`48e2cfceccd0a7b771f5bb71337455f2df03540aadcaf0bc3687d310e52d9eb6`.

### Preview `increment` (silent drop), twice

```
contract address   4996ab7fb52c9eb74b8099fe25e4027782e04bc0b93d2efec71d5dfaf3b4965d
deploy tx hash     c74e120aa47fadaefddb0f27ca8668be7b96d03d9d2d417b42f1dac35202eef2
deploy block       1547724
```

| Attempt (UTC) | `POST /check` | `POST /prove` | Node response | Inclusion |
|---|---|---|---|---|
| 2026-11-01 14:32:45 | 200, 13.7 ms | 200, 2.58 s | none | none after 42 min |
| 2026-11-01 15:23:04 | 200, 2.3 ms | 200, 0.079 s | none | none after 4 min (polled every 15 s) |

Indexer query (the client hangs, so inclusion is checked against the indexer):

```graphql
{ contractAction(address: "4996ab7f...4965d") { __typename transaction { block { height } } } }
```
```json
{ "contractAction": { "__typename": "ContractDeploy", "transaction": { "block": { "height": 1547724 } } } }
```

Still `ContractDeploy`. No `ContractCall` has ever existed on this contract. Preview was
healthy throughout (blocks every 6 s or so, 1554099 to 1554440 observed live).

### Local node, same artifacts, same client, endpoints switched

```
contract address   641d475a8dba95626261bfd3e22c317502f889ea5071ab968578d0e6fa9bb3f3
deploy  tx         0064375c3f0eae01fdd9fb6e5ceb5d0f76eb396a334a9fa7bbea289eac12cd77d3   block 10   20.1 s
increment tx       000b42d088a3665834139a21bb711214feaf7add78a7163f981f17fdcb31fc62f1   block 14   23.1 s
```
```json
{ "contractAction": { "__typename": "ContractCall",
    "transaction": { "hash": "097ac413122248f9d815e62c0ee304b0dc56ec60dadfaef5122676e9c03674b2", "block": { "height": 14 } } } }
```

Local node log, no rejection lines (no `Rejecting ... at pre-dispatch`, no `Rejected ... from
mempool`, no `guaranteed execution would fail`), only:

```
2026-11-01 16:20:46 Validated transaction be8a647b0c08382984b2356b448f545c11e33c4c117787fde32fce0f97d5c52a for mempool
2026-11-01 16:21:06 Validated transaction 097ac413122248f9d815e62c0ee304b0dc56ec60dadfaef5122676e9c03674b2 for mempool
```

### The same real contract (`epoch_proof`) also lands locally

Reproduced end to end: the same batched deploy (8 verifier keys in the deploy, 3 added by
maintenance update) and then the same `register` that returns 117 on Preview.

```
[EXECUTE] contract address: 404dd5be82e60fa64c98b73dd4f72ca1c556e9e98ed418a93de748c3e5fdea73
[EXECUTE] batch 1 finalized in block 157 (tx 004beba50405929ce85af38fee02ade9077b52e5ce1f109f409104cdee0db64a07)
  + defaultEngagement inserted (block 160)
  + publishRoot inserted (block 163)
  + proveFunding inserted (block 166)
proof-server sanity check: proving `register`...
  register tx       007f0b9243cb7a0098964caca85128a60b7751fb466991f952ac8f1a67df09cdea
  block height      171
```

`register` included at block 171, no rejection lines. The identical call on Preview returns
117.

## Side by side

| | Local `1.0.400-87c0fbdb` / ledger `=8.1.3` | Preview `1.0.400-87c0fbdb` / ledger `=8.1.3` |
|---|---|---|
| counter `increment()` | included, block 14 | admitted to mempool, never included |
| epoch_proof batched deploy (8 plus 3 updates) | included, blocks 157 to 166 | included, blocks 1535539 to 1535552 |
| epoch_proof `register(1, now-60s)` | included, block 171 | `117 NotNormalized`, rejected at mempool |

The contract, deploy path, circuit, witnesses, client, and node build are the same in both
columns. Only the endpoints differ.

## Client and toolchain versions (both sides)

| Component | Version |
|---|---|
| `@midnight-ntwrk/midnight-js-*` | 4.1.1 |
| `@midnight-ntwrk/ledger-v8` | 8.1.0 (the copy midnight-js 4.1.1 pins) |
| `@midnight-ntwrk/onchain-runtime-v3` | 3.1.2 (pnpm override, single physical copy, confirmed with `pnpm why`) |
| `@midnight-ntwrk/compact-runtime` | 0.16.0 |
| Compact compiler / language / runtime | 0.31.1 / 0.23.0 / 0.16.0 |
| ZKIR | `midnight:ir-source[v2]` |
| Proof server | 8.1.3 (`midnightntwrk/proof-server:8.1.3`, local both sides) |
| Indexer | Preview indexer, and `indexer-standalone:4.3.3` locally |

`register` returns 117 under `onchain-runtime-v3` 3.0.0 and 3.1.2, the same way.

## What we have ruled out

A node on ledger 8.1.3 with Preview's exact build hash accepts a call built by midnight-js
4.1.1 on `ledger-v8` 8.1.0. So the cause is none of these:

- **Not** the ledger 8.1.3 stricter call-transcript rules (GHSA-wr7g-rr4v-jmj8). 8.1.3
  accepts our calls locally.
- **Not** the 8.1.0-client with 8.1.3-node combination. That combination works.
- **Not** our dependency setup. `onchain-runtime-v3` is a single physical copy; the same tree
  produces both outcomes; 117 also appears under 3.0.0.
- **Not** the compiler, circuits, or ZKIR. The same artifacts succeed locally. The proof
  server accepted every proof (six calls, all `/check` and `/prove` 200, no `400 bad input`).
- **Not** the batched deploy or our hand-built contract state. The plainly-deployed counter
  fails on Preview too, and the batched `epoch_proof` with `register` succeeds locally.
- **Not** wallet sync. The gate waits for `isSynced`; balances are correct
  (NIGHT 5000000000, DUST 25000000000000000000); deploys from that wallet land.
- **Not** chain health. Preview produced blocks every 6 s or so throughout.

## Our best guess: the wallet's DUST, which came from registration

The only difference left is Preview itself, and the narrowest candidate is the wallet's DUST:

- Our Preview wallet got its DUST by **registering** NIGHT UTXOs for DUST generation.
- The local wallet is the `CFG_PRESET=dev` genesis wallet (seed `00...01`), whose DUST is
  natively full and was never registered.

There is a direct precedent for `NotNormalized` coming from the DUST part of a transaction.
From midnight-node's changelog, `node-0.22.0` through `node-0.22.3`:

> **Fix NotNormalized error when dust spends and registrations are empty.** "Fixes the
> toolkit to omit `DustActions` in a transaction if it's a No-op. Resolves `NotNormalized`
> errors." (PR `midnightntwrk/midnight-node#758`, PM-21958)

That fix was applied to the node toolkit. If the wallet SDK or midnight-js 4.1.1 call path
can emit a no-op or otherwise non-normalized `DustActions` for a transaction whose fee is
paid from registration-derived DUST, it would explain every observation at once, including
why deploys and maintenance updates from the same wallet land while calls do not, if their
DUST spend structure differs.

## What we are asking for

1. **Confirm or rule out the DUST guess:** can a transaction whose fee is paid from
   registration-derived DUST carry a `DustActions` structure that ledger 8.1.3 treats as not
   normalized, and does the node#758 toolkit fix have an equivalent on the wallet-SDK or
   midnight-js 4.1.1 path?
2. **Is there a client-side fix or workaround for midnight-js 4.1.1?** The ledger 8.1.3 notes
   tell 4.1.1 projects to stay on `ledger-v8` 8.1.0, so bumping the client ledger is not
   presented as an option.
3. **Please check a Preview block producer's log** for the pre-dispatch rejection of our
   dropped `increment` transactions and share the reason verbatim. This is the one piece of
   evidence we cannot get: the drop returns no code, so we never learn a dropped call's tx
   hash. Submissions to look up:

   | What | When (UTC) | Contract | Submitter (shielded address) |
   |---|---|---|---|
   | `increment()` attempt 1 | 2026-11-01, just after 14:32:45 | `4996ab7f...4965d` | `mn_shield-addr_preview19fk8ll9hxf0hdyaxzy7r8ht8lu4t99wn2jsdyxwuvy6cx2xst6gw8mly7ddfcl6kvl29h8s3l8cu0w30j3d9m5k8haxg8wx4p7n9rwcx2yzyg` |
   | `increment()` attempt 2 | 2026-11-01, just after 15:23:04 | `4996ab7f...4965d` | same |
   | `register()` attempt 1 (117) | 2026-10-31, 20:29 | `48e2cfce...2d9eb6` | same |
   | `register()` attempt 2 (117) | 2026-10-31, 21:19 | `48e2cfce...2d9eb6` | same |

4. **Is this known, and are others affected?** A scan of the last 40 Preview blocks found no
   contract actions network-wide, so we had no control group.
