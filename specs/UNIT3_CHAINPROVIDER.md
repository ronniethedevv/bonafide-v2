# Unit 3 — live `ChainProvider` data extraction (handoff)

> **For the session/machine that can reach the archive RPC.** Units 1–2 (chain
> config, JSON-RPC client, keccak/ABI/CREATE2 decoding) are done and KAT-verified
> in `packages/indexer/src/evm/`. Unit 3 implements the three remaining
> `ChainProvider` methods against **live Base + Ethereum** and verifies each one
> against on-chain truth. **Nothing here may be guessed** — every formula is either
> derived from existing code or checked against an independent source (block
> explorer / Uniswap subgraph) before it ships.

Branch: **`ccr-0ae4f61d-euy47e`**. Keep CI green; commit + push per working unit;
update `specs/progress_tracker.md` at the end of each.

## 0. Preflight (confirm the environment is actually live)

The whole reason for a fresh session is network + secrets. Verify first:

```ts
import { uniswapV3Provider } from "@mmr/indexer";
const base = uniswapV3Provider(8453); // reads BASE_ARCHIVE_RPC_URL
await base.assertChainId();            // must NOT throw
console.log(await base.finalizedBlock());
const eth = uniswapV3Provider(1);      // reads ETH_ARCHIVE_RPC_URL
await eth.assertChainId();
```

If `assertChainId` throws or a raw `eth_chainId` 403s, the host isn't allowlisted
or the secret isn't set — **stop and report**, don't work around it. Quick check
from a shell: a keyless `eth_chainId` POST to the Alchemy host should return, not
`CONNECT tunnel failed, 403`.

## 1. The contract you must satisfy

`buildEpoch` (packages/indexer/src/epoch.ts) already orchestrates the pipeline; you
only fill the three methods it calls. **Do not change the interfaces** — the leaf
builder (`leaves.ts`), commitments (`commit.ts`), TWAP (`twap.ts`), tree + root
(`@mmr/merkle`) all consume these exact shapes (`provider.ts`):

- `poolsAboveFloor(floor, atBlock) → PoolDescriptor[]`
  (`poolAddr, token0, token1, liquidity, dex`)
- `poolActivity(pool, range) → AddressActivity[]`
  (`addr, isProtocol, baseStart, baseEnd, quoteEnd, lpBase, lpQuote, xferIn,
  xferOut, fromTreasury, swapBaseIn/Out, swapQuoteIn/Out, depthBuckets[],
  flowWindows[], lpFirstActiveBlock`)
- `poolPriceSamples(pool, range) → PriceSample[]` (`ts, price`)

Config that drives the math (`config.ts`): `bandsBps` (default `[50,100,200,500]`),
`epochSeconds` (24h), `bucketSeconds` (30m → 48 buckets/epoch — matches the
circuit's `Vector<48>` depth/flow witnesses), `twapWindowSeconds`, `winsorFraction`,
`kMinSeconds` (anti-JIT; was `kMinBlocks` before DD-31), `liquidityFloor`.

**Before writing any extraction, read `packages/prover/src/oracle.ts` and
`packages/contracts/INVARIANTS.md`** — they define what each metric *means*
(base vs quote orientation, custody floor using `baseStart/baseEnd/quoteEnd`, the
I5 outflow identity, I7 round-trips from flow windows). Derive orientation and
signs from there, not from intuition.

## 2. Suggested order (simplest + most verifiable first)

### 2a. `poolPriceSamples` — spot price replay
> **Done (2026-10-22, DD-19 + DD-20).** Orientation = ranked quote allowlist; price
> = Q96 raw quote per raw base. Samples are *not* bucket boundaries any more: the
> caller passes `twapSampleTimes(config, endTs)` — every `priceSampleSeconds` (60 s)
> across the TWAP window, endTs included. The notes below are the original plan.

- Map each sample time (bucket boundaries across `[startTs, endTs]`) to a block:
  binary-search `eth_getBlockByNumber` on timestamps, or walk blocks. Record the
  real block, don't interpolate.
- Read `slot0()` via `eth_call` at that block → `sqrtPriceX96`.
- Price from `sqrtPriceX96`: `price = (sqrtPriceX96^2) / 2^192`, then adjust for
  token decimals (`decimals()` via `eth_call`, cache per token). **[DECIDE +
  verify]** orientation (price of base in quote) and the fixed-point scale must
  match what `winsorizedTwap` + the oracle expect — pin it by checking one sample
  against the pool's price on a block explorer / Uniswap subgraph at the same block.
- Determinism: all inputs are (pool, block) — no clocks.

### Range rule (applies to 2b and 2c, decided 2026-10-22)
An `EpochRange` for `[startTs, endTs]` is pinned as **`startBlock` = the last block
with timestamp ≤ `startTs`** and **`endBlock` = the last block with timestamp ≤
`endTs`** (`lastBlockAtOrBefore`, `evm/price.ts`). So the state at a time `t` is
always the state after some in-range block, and epochs tile without gaps:
- **State reads** (balances, `liquidity()`, `slot0`) for "start of epoch" are at
  `startBlock`; for "end of epoch" at `endBlock`.
- **Event scans** (`eth_getLogs` for Transfer/Swap/Mint/Burn) cover
  **`(startBlock, endBlock]`** — i.e. `fromBlock = startBlock + 1` — because events in
  `startBlock` happened at or before `startTs` and belong to the previous epoch.
- Build ranges with one shared helper (added in 2b) so 2b, 2c and the watcher agree.
  On Base, blocks land on odd seconds: the start block is at `startTs − 1`.

### 2b. `poolsAboveFloor` — discovery
> **Done (2026-10-22, DD-21) — differently from the plan below.** The RPC key is
> Alchemy Free tier (`eth_getLogs` ≤ 10 blocks), so there is no `PoolCreated`
> scan: pools are enumerated as `baseTokens × quoteAssets × FEE_TIERS` through
> `factory.getPool` (Multicall3), each checked against `computePoolAddress`. Range
> helper: `resolveEpochRange` (`evm/range.ts`). The notes below are the original plan.

- Enumerate pools from the chain's UniswapV3Factory `PoolCreated` logs
  (`TOPIC0.poolCreated`), paged over block ranges (respect the provider's
  `eth_getLogs` range cap — chunk, e.g., ≤ 10k blocks, and surface, don't swallow,
  a "range too large" rpc error). `decodePoolCreated` gives `token0/token1/fee/pool`.
  - Cross-check each derived address against `computePoolAddress` (unit 2) — they
    must match; a mismatch means wrong constants, fail loudly.
- For each pool, read `liquidity()` (active) via `eth_call` at `atBlock`; keep
  those `≥ floor`. Fill `PoolDescriptor` (dex `"uniswap-v3"`).
- Verify: on Base, discovery must include a known high-liquidity pool (e.g. a
  WETH/USDC pool) at a recent block; confirm its address against the explorer.

### 2c. `poolActivity` — per-address metrics (the hard one; split further)
> **Log budget:** with the Free-tier key, one epoch of logs for one pool is
> ~4 320 `eth_getLogs` calls on Base (43 200 blocks / 10). Filter by pool address
> + topic0 per request; consider a paid key before running many pools/epochs.

Collect the address set from Transfer/Swap/Mint/Burn logs over `[startBlock,
endBlock]`, then per address:
- **Balances** `baseStart` (at `startBlock`), `baseEnd`, `quoteEnd` (at `endBlock`):
  `balanceOf(addr)` via `eth_call` at the pinned blocks. Orientation per §1.
- **Transfers** `xferIn/xferOut`: sum ERC-20 `Transfer` (`decodeTransfer`) where
  `to`/`from` == addr, per token. `fromTreasury`: inflows whose `from` is in the
  engagement's treasury/loan-source set. **[DECIDE]** the indexer indexes all
  addresses; the treasury set is an *input* — thread it through, don't hard-code.
- **LP** `lpBase/lpQuote`, `lpFirstActiveBlock`: from `Mint`/`Burn`
  (`decodeMint/decodeBurn`) for the address's positions; `lpFirstActiveBlock` =
  block of its first `Mint` (feeds anti-JIT in `leaves.ts`).
- **Swaps** `swapBaseIn/Out/swapQuoteIn/Out` + `flowWindows` (buy/sell per 30m
  window): from `Swap` (`decodeSwap`), signed `amount0/amount1`. **[DECIDE +
  verify]** Uniswap v3 `Swap.sender/recipient` are usually a *router*, not the MM —
  attribution needs the real trader (tx `from`, or the Transfer leg to/from the
  MM). Pick an attribution rule, verify it on a known swap tx against the explorer,
  and write it down; do **not** guess silently.
- **`depthBuckets`** (per bucket, per band `minBid/minAsk`): the hardest. Within
  ±`bandBps` of mid price, the quote available to buy (bid) and base available to
  sell (ask) come from Uniswap v3 **concentrated liquidity** across the tick range
  for that band. Reconstruct active liquidity per tick (from `Mint`/`Burn` history
  or `ticks()`/`tickBitmap()` `eth_call`), convert to token amounts with the v3
  amount math (`getAmount0Delta`/`getAmount1Delta` over the price sub-range), take
  the **min across the bucket's blocks**. **Verify** one (pool, bucket, band)
  depth against an independent computation before trusting the series.

## 3. Verification plan (this is the point of the live session)

Pick **one pool + one closed 24h epoch** on **each** chain. Pin `EpochRange`
(`startBlock/endBlock/endBlockHash/startTs/endTs`) from real blocks.
1. **Determinism (invariant #4):** run the full `buildEpoch` twice (independent
   provider instances) → byte-identical `rootOfRootsHex`. Then recompute with
   `@mmr/watcher` and confirm it matches.
2. **Spot-checks against an independent source** (explorer / Uniswap subgraph at
   the same blocks): one price sample, one pool's membership, one address's
   `xferIn/xferOut`, one LP's depth. Each must match within a stated tolerance.
3. Commit the pinned fixtures (block numbers, hashes, expected roots) as KAT
   vectors so later runs stay honest **without** re-hitting the RPC — but **never
   commit the RPC URL/key** (golden rule; use a gitignored `.env`).

## 4. Guardrails

- **Determinism:** no `Date.now`/`Math.random`/float in anything feeding a root;
  sort explicitly; everything keyed by (pool, block).
- **Numeric discipline:** `bigint` for all amounts; reject on overflow.
- **Boundaries fail loudly:** typed errors, no silent fallback on proof-feeding
  data (code_standards).
- **Secrets:** never commit the RPC URL/key or `.env*`.
- **Per-chain:** Base and Ethereum are independent; a proof opens one chain's root.
- **When a `[DECIDE]` point is genuinely ambiguous, verify against a primary source
  or ask — do not ship a guess.** That constraint is the whole reason this is a
  live session and not a blind one.
