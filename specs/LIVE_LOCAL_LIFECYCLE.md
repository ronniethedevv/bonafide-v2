# Live local lifecycle — `epoch_proof` on a real Midnight node (ledger 8.1.3)

Recorded **2026-11-01** on a local midnight-local-dev stack pinned to Preview's versions:
node `1.0.400-87c0fbdb`, `midnight_ledgerVersion =8.1.3`, `indexer-standalone:4.3.3`,
`proof-server:8.1.3`. Fresh chain. Client: midnight-js 4.1.1, `ledger-v8` 8.1.0,
`onchain-runtime-v3` 3.1.2, `compact-runtime` 0.16.0; contract compiled with matrix Compact
0.31.1, ZKIR `ir-source[v2]`.

Every row below is a **real ZK proof** and a **real `ContractCall` included in a block**,
verified from the indexer rather than from the client's own log.

Contract: `e45ab7133cc3ff96e9a641a4983274cdebb5ecb5e14a0aa93f1725bd6f1c97ce`

## B1 — live on-chain (`register → proveFunding`)

```
pnpm --filter @mmr/dapp run batch-deploy          # MMR_BATCH_EXECUTE=1
MMR_STOP_AFTER=proveFunding pnpm --filter @mmr/dapp run interact
```

| block | action | entryPoint | tx hash |
|---|---|---|---|
| 10 | `ContractDeploy` | — (8 verifier keys) | `821a0a31dfc129261b8321b7039114596b2cac3cd2af74a464fd0f182b76bdff` |
| 13 | `ContractUpdate` | `defaultEngagement` key | `c0a5a643f92a0281261ab7bd5ee7ea9d38a8881c68b02e2489778e1c5b35174f` |
| 17 | `ContractUpdate` | `publishRoot` key | `fc2208b97e79397872fff950c30b4d1ddecce0b87c66dda1481b5deb0f18aa87` |
| 20 | `ContractUpdate` | `proveFunding` key | `2ec445b7dfa54161633796878594610f035d69382f253e54a427e7423e6692a3` |
| 29 | `ContractCall` | `register` (deploy sanity check) | `6b575dbce61df0fd249cf22cf19043ca54ccc2dc5038758e5cf5bbcdd1f5220e` |
| **37** | `ContractCall` | **`register`** | `5d6573e7160dbb7ac411b8c6b3a6fefec8adaf62347f3827a3e6033a2029fcf1` |
| **41** | `ContractCall` | **`activate`** | `e5047d63ce1b2b32eafaa4356a7d785dac35c484b16b6746df3d9280dee722a1` |
| **45** | `ContractCall` | **`publishRoot`** (attester 0) | `17aaf3f3819507bd865477adb87b6a6082b03694b69c3618de756bcff9107486` |
| **49** | `ContractCall` | **`publishRoot`** (attester 1) | `ce9baf072e95744775ea027c9d33f691bafe067a0b0a68ee87e702b7da8098c8` |
| **62** | `ContractCall` | **`proveFunding`** | `71d81d3dba1521eef1a4bece748b069dd0081855cc70255e1252be7e74b1ea43` |

**6 `ContractCall`s**, 1 deploy, 3 maintenance updates. The two `publishRoot` votes are
distinct committee members (DD-26: membership is proven by the `attesterSecret` witness, not
the tx signer), so they cross the 2-of-3 threshold and publish the epoch-1 root.

### Client transcript, verbatim

```
mmr batch-deploy — epoch_proof (runbook Phase 3.5)
  network        undeployed
  node           http://localhost:9944
  committee (2-of-3 attester ids)
    [0] 040c6b4645eb33f0d7dec3c83a63c7bc3dfb6967ec2cf389c8271215be2136cc
    [1] 8adcbf519a0fbfcfcd667688f2d0f1f99def228d72be495fe61c47c25bcda812
    [2] 455a8b3136dfcc33292fc0b7d0fee81bb9e2a9c0fc41eca8eb6b8fcef9d05325

[EXECUTE] 11 provable circuits, 22541 verifier-key bytes
[EXECUTE] batch 1 (deploy): 8 circuits: register, proveEpoch, claim, activate, postBond, settleEpoch, releaseEpoch, voidUnfunded
[EXECUTE]   stopped at 'defaultEngagement': would exceed bytesWritten 30405 > 30000
[EXECUTE] contract address: e45ab7133cc3ff96e9a641a4983274cdebb5ecb5e14a0aa93f1725bd6f1c97ce
[EXECUTE] batch 1 finalized in block 10 (tx 0031ffaed59dcdf06a46acd3ba758f4431105308fa6f8ff6e19e5ba0bb1cce6b27)
  + defaultEngagement inserted (block 13) [1/3]
  + publishRoot inserted (block 17) [2/3]
  + proveFunding inserted (block 20) [3/3]
[EXECUTE] done. All 11 circuits have verifier keys; findDeployedContract() will now succeed.
    elapsed             80.7s

confirming findDeployedContract()…
  attached to       e45ab7133cc3ff96e9a641a4983274cdebb5ecb5e14a0aa93f1725bd6f1c97ce

proof-server sanity check: proving `register`…
  register tx       008dc7db42091196efb0a2f6aa67e48763b37c8936ae4b8174abd44617fe39523d
  block height      29
  proof + submit    51.8s

mmr interact — epoch_proof lifecycle
  contract  e45ab7133cc3ff96e9a641a4983274cdebb5ecb5e14a0aa93f1725bd6f1c97ce
  restoring wallet state from cache (skips genesis sync)…
  shielded  mn_shield-addr_undeployed1r020sfa…  NIGHT 250000000000000  DUST 1250000000000000000000000
  ✓ register         tx 00c5b3b2f686f67786953bf7d8bd424eaaa5122a1e8f226e32a8ac02e02aaa64a3  block 37
    id 5109f0f0dc0dfc50d2733dad45f5491841264b7ba3534be997e1a45589e26bc1
  · postBond            skipped (set MMR_POST_BOND=1 with a real escrow coin)
  ✓ activate         tx 00eb964e30851a532e38203139378b9262b5d91a00cfdb20248f418886771d5856  block 41
  ✓ publishRoot[1]#0 tx 006138659f9564d54673e76fb2b17c502d4d8e8a15d24d1c6349a5403d080a99b8  block 45
  ✓ publishRoot[1]#1 tx 00d74a41cb32b0f8a6b84c7dc8f1f81ef00077db0874e160ee31e6d2c97ef47c90  block 49
  ✓ proveFunding     tx 0028f12f1d0456cb0c33937522bc06d22c2117c45090c24169a03bc029b14d273f  block 62

Stopped after `proveFunding` (MMR_STOP_AFTER). Every call above is a real proof and a real ContractCall in a block.
  The remaining circuits run in the KAT suite against the same compiled contract:
    pnpm --filter @mmr/contracts test
```

Note the two id forms: the client prints the SDK transaction **identifier**
(`00c5b3b2…`), the indexer reports the chain transaction **hash** (`5d6573e7…`). Same
transaction.

## Why the run stops at `proveFunding`

Two hard limits of this machine and of midnight-node, not of the contract:

1. **`proveEpoch` is k=20** (~599.5k rows, 305 MB prover key) and its proof peaks around
   **9.5 GB**, which OOM-kills a 16 GB host. Everything in B1 is ≤ k=17.
2. **`settleEpoch` → `releaseEpoch` → `claim` are time-gated** on
   `epochEnd = activatedAt + e × 86400` plus the challenge window. midnight-node advances
   block time only in **real time** — AURA uses fixed slots, and the image exposes no
   manual-seal, `--dev-block-time` or timestamp-override flag (checked
   `/midnight-node --help`; midnight-local-dev has no time knob either). So they cannot be
   on-chain transactions without waiting 24 h.

Both are covered by the KAT suite against the **same compiled contract** via
`@midnight-ntwrk/compact-runtime`, with the block clock driven directly
(`runLifecycle(..., { blockTime })`):

```
pnpm --filter @mmr/contracts test
```

Run 2026-11-01, green:

```
 Test Files  7 passed (7)
      Tests  123 passed (123)
   Duration  161.61s
```

Those 123 KATs include the circuits B1 cannot put on chain here: `proveEpoch`, `claim`,
`settleEpoch` and `releaseEpoch` — among them the time-gated
`H4: claim credits only on-ledger epochs (DD-12)` cases, which drive the block clock
directly. Same compiled contract as the on-chain calls above; nothing mocked.

## Reproducing

```sh
git clone https://github.com/midnightntwrk/midnight-local-dev.git
cd midnight-local-dev   # add standalone.override.yml (node 1.0.400 + proof-server 8.1.3)
docker compose -f standalone.yml -f standalone.override.yml up -d
```

Then, with the dapp pointed at the local stack (`NETWORK_ID=undeployed`,
node `:9944`, indexer `:8088/api/v4/graphql`, proof server `:6300`, genesis seed
`00…01`):

```sh
MMR_BATCH_EXECUTE=1 pnpm --filter @mmr/dapp run batch-deploy
MMR_STOP_AFTER=proveFunding pnpm --filter @mmr/dapp run interact
```

`MMR_STOP_AFTER` accepts `register`, `postBond`, `activate`, `publishRoot`, `proveFunding`,
`proveEpoch`. The engagement secret is random per run (register asserts its derived id is
not already on the status map, so a fixed secret would be single-use per chain); pin it with
`MMR_ENGAGEMENT_SECRET=<64 hex>`.

Verify independently of the client:

```sh
curl -s -H 'content-type: application/json' \
  --data '{"query":"{block(offset:{height:62}){transactions{hash contractActions{__typename ... on ContractCall{entryPoint}}}}}"}' \
  http://localhost:8088/api/v4/graphql
```

## Note on Preview

This same lifecycle does **not** work on Preview: no `ContractCall` has ever been included
there, for any contract — `register` returns `1010 … Custom error: 117`
(`Malformed.NotNormalized`) and a trivial counter's call is silently dropped, while deploys
and maintenance updates land. See [`CALL_SUBMISSION_BLOCKER.md`](CALL_SUBMISSION_BLOCKER.md)
and [`SERVICEDESK_REPORT.md`](SERVICEDESK_REPORT.md). The local node here is byte-identical
in version to Preview's, which is what makes that blocker Preview-specific.
