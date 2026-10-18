# ui_context.md

The UI is **read-mostly**: a public reputation profile, a client's per-engagement
view (behind opened commitments), and the MM's own dashboard. No trading UI in
v1 — this product proves performance, it does not place orders.

## Surfaces

1. **Public profile** (`/mm/[handle]`) — completed engagements, KPI hit-rates,
   custody record, bond history, difficulty tier. Never shows clients, tokens,
   wallets, KPI targets, or live results.
2. **Tear sheet export** — a shareable, signed PDF/PNG summarising the public
   record. Generated in a background worker; stored in Blob.
3. **Client view** (`/engagement/[id]`, gated) — exact per-epoch figures for the
   client's own engagement, via opened commitments.
4. **MM dashboard** (`/dashboard`) — engagement states, proving/epoch status,
   bond status, claim queue.

## Design tokens (dark-first)

Defined once as CSS variables on `:root`, redefined under
`@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]`.

```css
:root {
  --bg: #0b0d12;        --surface: #12151c;    --surface-2: #171b24;
  --border: #242a36;    --text: #e6e9ef;       --text-muted: #9aa3b2;
  --accent: #5b8cff;    --pos: #3ecf8e;        --neg: #ff6b6b;
  --warn: #f5a623;      --radius: 10px;        --gap: 16px;
}
```

- **Semantics:** `--pos` = KPI met / proof verified / bond intact; `--neg` =
  missed / defaulted / slashed; `--warn` = flagged / grace / challenged.
- Tier badges: A/B/C with distinct, colour-blind-safe treatments (not red/green
  alone — pair with shape/label).

## Component rules

- shadcn/ui primitives; Tailwind for layout. 16px side gutter, no horizontal
  scroll at phone width.
- Numbers: monospace tabular figures; always render `bigint` amounts via a
  formatter (never raw). Show units and bands explicitly.
- Privacy affordance: anything hidden-by-design shows a lock glyph + tooltip
  explaining *why* it's private (reinforces the product's honesty about leaks).
- Charts follow the `dataviz` guidance; depth/uptime over epochs is the hero chart.

## State

- Server components fetch read models from the API/DB. Client components
  subscribe to job status (proving/indexing) over WS.
- No wallet connect / signing in v1 UI; the MM's keys and witnesses never touch
  the browser.
