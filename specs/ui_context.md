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
  --bg: #090a0f;        --surface: #121420;    --surface-2: #181b28;
  --border: rgba(255,255,255,.07);  --border-strong: rgba(255,255,255,.13);
  --text: #eef0f6;      --text-muted: #949db2;
  --accent: #6d7cff;    --accent-2: #a569ff;   --accent-soft: rgba(109,124,255,.14);
  --grad: linear-gradient(135deg,#5b8cff,#7c6cff,#a569ff); /* hero / gradient text */
  --pos: #3ecf8e;       --neg: #ff6b6b;        --warn: #f5a623;
  --radius: 14px;       --radius-sm: 10px;     --gap: 16px;
}
```

**Look & feel (console-dashboard inspired):** near-black cool canvas with soft
indigo/violet radial glows; hairline (white-alpha) borders; 14px card radii;
electric-indigo accent with a blue→violet gradient used for the brand mark, hero
banners (subtle grid texture), gradient headline figures, and the primary button.
Typography is **Inter** (loaded at runtime via a Google-Fonts `<link>` — no
build-time fetch, so offline CI builds still pass) over a system-sans fallback.
Reusable utilities live in `globals.css`: `.hero`, `.pill`, `.badge-new`, `.btn`
/`.btn-primary`/`.btn-ghost`, `.meter`, `.gradient-text`, `.eyebrow`.

- **Semantics:** `--pos` = KPI met / proof verified / bond intact; `--neg` =
  missed / defaulted / slashed; `--warn` = flagged / grace / challenged.
- **Colour is for exceptions.** On record cards, labels use `--text-muted` and values
  `--text`; an outcome that went as agreed stays in the text colours, and `--neg` marks
  only what a reader must notice (custody breached, bond slashed). Data bars use one hue
  (`.meter-data`: `--accent-2` on a pale track of the same blue), never a red/amber/green
  scale: a KPI's target is private, so the public record has no threshold to colour against.
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
