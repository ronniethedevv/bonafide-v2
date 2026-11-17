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

## Accounts & sign-in (web)

- **Sign-In with Ethereum (EIP-4361)** on Ethereum (1) or Base (8453). Wallets are
  discovered with EIP-6963; the server issues a one-time nonce (httpOnly cookie),
  checks domain, origin, nonce, chain, statement and a ≤10-min lifetime, then verifies
  the signature: locally for EOAs, via ERC-1271/6492 on the chain's RPC for smart
  wallets (Safe, Coinbase Smart Wallet). Session = HS256 JWT in an httpOnly cookie,
  signed with `SESSION_SECRET` (required in production; absent → wallet sign-in off).
- **Identity wallet ≠ quoting wallet.** Signing in links an address to an account on
  our server; quoting wallets are never sent to us (they stay on the MM's machine,
  committed by hash). The UI says so at sign-in.
- **Accounts** (`Account`, `AccountWallet` in `packages/db`) map identity wallets to an
  MM (public handle) or a client. Until `DATABASE_URL` is set, accounts are "preview":
  a signed cookie in the user's browser. Operators can link a wallet to a demo account
  with `DEMO_WALLET_LINKS`. Demo accounts remain for walkthroughs without a wallet.
- **Not yet:** WalletConnect (custody / mobile wallets: Fireblocks, Safe{Wallet}) needs a
  Reown project id; team members per account; email/SSO for non-crypto client staff.

## Backend plan (v1)

The backend is a coordinator that never sees an MM's books:

| Concern | Choice | Notes |
|---------|--------|-------|
| User-facing API | Next.js route handlers (same Vercel project) | Auth, accounts, engagement registry metadata, client inbox. Short request/response only. |
| Database | Postgres (Neon via Vercel Marketplace) + Prisma | Accounts, engagement registry (id, MM, client, public commitment, status), attestation status, read models. Never terms, wallets or salts. |
| Long-running work | Trigger.dev workers (invariant #1) | Indexing, witness capture service, attester runs, proof orchestration, read-model projection. |
| Heavy payloads | IPFS via Pinata (invariant #3) | Published Merkle trees, attestation bundles. Content-addressed, so a second mirror can be added without changing CIDs. |
| Client-visible figures | Encrypted MM → client | The MM's tool encrypts opened per-epoch figures to the client's key; the server stores ciphertext it cannot read. |
| Public read API | `apps/api` (Fastify) or folded into Next | Serves the public projection only. |

**0G Labs** — evaluated, not adopted for v1. 0G Storage is a credible decentralised
storage layer (an alternative or mirror for published trees), but it adds a second
chain and token to fund, and our published data is small and already content-addressed
on IPFS. 0G Compute targets AI inference, not Midnight proving; 0G DA and 0G Chain
solve problems we don't have (we post roots to Midnight; we deploy nothing on EVM).
Revisit 0G Storage as a redundancy mirror once published volumes grow.

**GraphQL / hosted indexers** — not for the proof path. Subgraphs (The Graph) and
hosted indexers (Envio, Goldsky) are third-party indexes and cannot be a proof input
(invariant #4: anyone with an archive RPC recomputes every root). Acceptable for
non-proof UI conveniences (e.g. pool discovery and TVL in the register wizard), and
HyperSync-style raw-log APIs may speed up the indexer only if results are spot-checked
against archive RPC. Our own API stays REST: the surface is small and typed end to end.



| Parameter | Default |
|-----------|---------|
| Epoch | 24h |
| Attester timeout | 6h after epoch end (missing root → void, no penalty) |
| Challenge window | 12h |
| Proving window | 24h after challenge window |
| Grace | one extra epoch (late proof flagged, not defaulted) |
| Funding window | 72h after registration (unfunded → void) |
