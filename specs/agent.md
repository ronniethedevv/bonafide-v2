# agent.md — the market-maker agent

The agent is ordinary software (no AI) that a market maker runs on their own server.
It does the daily work of an engagement so nobody has to: capture each epoch from
public chain data, (later) prove it, and keep the client informed. It is the only
place an MM's private data (quoting wallets, terms, secrets) is ever combined with the
chain data — which is why it runs on the MM's side and never on ours.

## What it holds (MM's machine only)

| Item | Where it comes from | Never sent to us |
|------|---------------------|------------------|
| Engagement file (terms, quoting wallets, engagement secret, salts) | saved at registration | ✓ |
| Passphrase for that file | the MM (env `MMR_ENGAGEMENT_PASSPHRASE` or prompt) | ✓ |
| Witnesses (per-epoch private records + carry state) | produced daily | ✓ |
| Agent token | "Connect agent" in the workspace (shown once) | stored hashed by us |

It never needs the private keys of any trading wallet: it only reads public activity.

## Creating and proposing an engagement (recommended path)

The web wizard can create an engagement, but then the trading wallets are typed into a web
page. The agent keeps them on the market maker's machine:

1. `create` fetches the client's public keys (inbox key; the Midnight key the bond names),
   draws fresh secrets, computes the commitments and the registration, seals the engagement
   file locally, and writes the ownership message each wallet must sign.
2. Each trading wallet signs its message: a signature (EIP-191), not a transaction, naming
   the wallet, its chain and the registration fingerprint, so it cannot be reused for another
   engagement. Custody platforms approve it under a signing policy; smart wallets work too.
3. `propose` verifies every signature, keeps them in the sealed file, seals the client's copy
   (terms, wallets, salts, signatures; never the engagement secret) to the client's inbox key
   and posts only the two commitments and that ciphertext (`POST /api/agent/v1/engagements`).

The client's portal opens the copy, recomputes both commitments, verifies every ownership
signature and only then lets the client accept.

## Daily loop (per engagement, per 24h epoch)

1. **Fetch the epoch's public activity** for the engagement's pool — every address's
   balances, transfers, swaps and per-bucket depth. Sources, in order of preference:
   - `published`: the day's published record from our indexer (IPFS / API), checked
     against the attested root. No RPC key needed. *(Once the daily indexer service runs.)*
   - `rpc`: the MM's own archive RPC, running the same deterministic indexer locally.
   - `replay`: activity files from `packages/indexer/scripts/replay-run.mts` (dev/test).
2. **Filter to the committed wallets** and **capture** the witness with `@mmr/witness`
   (I1–I8 checks, carry-forward chaining). The genesis carry salt is derived from the
   engagement secret, so the chain of witnesses is reproducible from the file alone.
3. **Report the phase** to the server: `captured` (later `proven`, `submitted`). The
   server learns only that an epoch reached a phase — not whether it passed.
4. **Seal the client's figures** (buckets at target, uptime, round-trip share, custody,
   outflow, met/missed) to the client's inbox key, bound to `epoch:<engagement>:<n>`,
   and post the envelope. Only the client can open it.
5. **Prove and submit** to Midnight — *pending the Midnight write path*; until then the
   epoch stays at `captured` and the workspace says "proof pending".

## Server side (what we run)

- `agent_token`: per-account tokens, stored as SHA-256 hashes, revocable, last-used time.
- `engagement_epoch`: (engagement, epoch) → phase, for the workspace and portal.
- Agent API (Bearer token, market-maker accounts only, own engagements only):
  `GET /api/agent/v1/me`, `GET /api/agent/v1/engagements`,
  `PUT /api/agent/v1/engagements/:id/epochs/:n` (phase),
  `POST /api/agent/v1/engagements/:id/epochs/:n/figures` (sealed envelope).
- Epoch reports are accepted only for engagements the client has accepted.

## Failure handling

- Re-running an epoch is safe: the witness store is append-only per epoch, phase
  updates only move forward, and a second figures envelope for the same epoch is refused.
- A missing day blocks the next (carry chaining); the agent reports which epoch is stuck.
- RPC hiccups retry with backoff; the on-disk RPC cache makes re-runs resume.

## Not in v1

Docker image and scheduler (cron-style daemon), the `published` source (needs the daily
indexer service), proving/submission (needs Midnight), sealing a copy of the figures to
the MM's own inbox for the browser workspace.
