# architecture.md

Decoupled tiers per the blueprint, adapted: the **protocol tier is Compact on
Midnight**, and **Base is read-only** (indexed, never written).

```
+----------------------------------------------------------------+
|                 PRESENTATION LAYER (apps/web)                  |
|   Next.js (App Router) · TS · Tailwind · shadcn/ui             |
|   Public reputation profile · tear-sheet export · MM dashboard |
+----------------------------------------------------------------+
        | HTTP / WS (read models, job status)
        v
+--------------------------------+   +---------------------------+
|  BACKEND (apps/api)            |   |  PROTOCOL (packages/      |
|  Node · Fastify/Express        |   |  contracts) — Compact     |
|  Attester service              |   |  0.31.x on Midnight       |
|  Prover orchestration          |   |  Registration · bond      |
|  Fee-sponsor (DUST + relay)    |   |  escrow · epoch proof     |
|  Trigger.dev durable workers   |   |  (I1-I8) · claim/nullifier|
+--------------------------------+   +---------------------------+
        |  read/write                    ^ proofs, signed roots, bonds
        v                                | (rebuildable from Base)
+----------------------------------------------------------------+
|           DATA / INDEX LAYER                                   |
|  packages/indexer (deterministic Base → leaves → trees)       |
|  packages/merkle  (indexed Merkle tree, root-of-roots)        |
|  PostgreSQL + Prisma (read models, engagement state)          |
|  IPFS (published trees)  ·  Blob (tear sheets, archives)       |
+----------------------------------------------------------------+
```

## Tech stack (consolidated)

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | Next.js (App Router) / React / TypeScript | SSR + reactive read-only views |
| Styling | Tailwind + shadcn/ui | Utility-first, dark-theme tokens |
| Backend | Node + TypeScript (Fastify) | Lightweight async API; WS for job status |
| Async workers | Trigger.dev | Durable long-running indexing/proving (invariant #1) |
| Protocol | **Compact 0.31.x (ledger 8) on Midnight** | ZK contracts; `disclose()`-gated flows |
| Chain (read) | **Base + Ethereum** archive RPC (Uniswap v3; Aerodrome on Base) | Deterministic source data; per-chain roots; no deploy |
| ZK primitives | Jubjub Schnorr (attester sigs), Poseidon-family hash (trees) | Midnight-native |
| DB / ORM | PostgreSQL / Prisma | Typed read models, fast indexing |
| Off-chain store | IPFS (trees) · Vercel Blob (tear sheets) | Avoid on-chain bloat (invariant #3) |
| Host | Vercel / Cloudflare edge + IPFS mirror | HA, decentralized fallback |

## Data layer — leaf schema (per indexed address, one pool)

Per-pool **address-sorted indexed Merkle tree, depth 16 (65,536 leaves)**. Each
leaf points to the next address, so one path proves a wallet was inactive
(non-membership). Signed amounts are split into in/out pairs (Compact has only
unsigned ints).

| Field | Type | Meaning |
|-------|------|---------|
| `addr`, `next_addr` | Uint<160> | sort key + next address in tree |
| `is_protocol` | Boolean | pool/router/position-manager; can't join a wallet set |
| `base_start`, `base_end` | Uint<128> | client-token balance at epoch start/end |
| `quote_end` | Uint<128> | quote balance at end (native ETH counts when quote is WETH) |
| `lp_base`, `lp_quote` | Uint<128> | tokens + uncollected fees in owned LP positions, at end |
| `xfer_in`, `xfer_out` | Uint<128> | client-token transfers outside pool flows, at emitted amounts |
| `from_treasury` | Uint<128> | tokens received from client's registered treasury |
| `swap_base_in`, `swap_base_out` | Uint<128> | client tokens bought/sold via swaps |
| `swap_quote_in`, `swap_quote_out` | Uint<128> | quote received/paid in swaps |
| `depth_root` | Bytes<32> | commitment to min bid/ask depth per band (50/100/200/500 bps) per bucket |
| `flow_root` | Bytes<32> | commitment to buy/sell per window (round-trip checks) |

The epoch's **root-of-roots** covers every Base CL pool above a liquidity floor,
so an engagement never reveals its pool.

## Indexer determinism rules

- **Deterministic:** recomputable from chain + pool list + block range + end-block hash.
- **Published:** full tree → IPFS before the root is signed.
- **Final:** index only blocks past Base's L1 finality.
- **Reference price:** winsorized 30-min TWAP from replayed pool state (not `observe()`).
- **Anti-JIT:** positions alive < `K_min` blocks get no depth credit.
- **Signed:** 2-of-3 attesters sign `(epoch, root_of_roots, IPFS_CID)` with
  Jubjub Schnorr keys; then a 12-hour challenge window.

## Trust & private-state boundary

Wallets, salts and terms exist **only on the MM's machine** (encrypted at rest;
witnesses deleted after claim). Midnight sees signed roots, proofs and bonds.
Anyone can rebuild the roots from Base.

## Timing defaults (tune in pilot)

| Parameter | Default |
|-----------|---------|
| Epoch | 24h |
| Attester timeout | 6h after epoch end (missing root → void, no penalty) |
| Challenge window | 12h |
| Proving window | 24h after challenge window |
| Grace | one extra epoch (late proof flagged, not defaulted) |
| Funding window | 72h after registration (unfunded → void) |
