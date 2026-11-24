# Deploy the public UI to Vercel

The web app (`apps/web`) is the one surface a **non-technical reviewer** can open
and understand without a terminal. It renders the public reputation record — the
profile, the tear sheet, the depth/uptime chart — from **bundled fixture data**.
No database, no API, no wallet, and **no environment variables** are required for
it to run fully; the fixtures ship in the repo.

This is a pnpm monorepo, so the one setting that matters is the **Root Directory**.

## One-time setup (≈ 3 minutes)

1. Go to **vercel.com → Add New → Project** and import
   `ronniethedevv/bonafide-v2`.
2. **Root Directory:** click *Edit* and set it to **`apps/web`**.
   (Vercel detects the pnpm workspace above it and installs the whole workspace
   from the repo root automatically — that is how the shared `@mmr/read-model`
   package resolves.)
3. **Framework Preset:** `Next.js` — auto-detected; leave it.
4. **Build / Install / Output commands:** leave all on **Default**. Do not set any.
5. **Environment Variables:** **none** are needed for the sample pages. The live
   engagement pages read the contract from Midnight's public Preview indexer (override
   with `MIDNIGHT_INDEXER_URL`).
6. Click **Deploy**.

That's it. The dynamic routes (`/mm/[handle]`, `/mm/[handle]/tear-sheet`) are
server-rendered on Vercel's Next.js runtime; the landing page is static.

## After it deploys

Send the production URL back and it gets wired into the top of `README.md` (the
**For reviewers** block) so a reviewer lands on a clickable link, not a wall of
terminal commands.

Pages a reviewer can open:

| Path | What it shows |
|------|---------------|
| `/` | Plain-language landing + the market-maker directory |
| `/mm/vega-mm` | A full public reputation profile with the depth/uptime chart |
| `/mm/vega-mm/tear-sheet` | The compact, shareable summary |
| `/mm/helix-lq` | A second market maker, to show it's a directory |

## Notes

- **Node:** pinned to `22.x` via `apps/web/package.json` `engines`, matching the
  repo's `node >= 22`.
- **Config:** `apps/web/vercel.json` only pins the framework to `nextjs`; nothing
  else is overridden.
- **What this proves:** the product and its UX — what a client/MM actually sees.
  It does **not** run the zero-knowledge proofs; that's the terminal demos in
  [`DEMO.md`](../DEMO.md). A non-technical reviewer should look at the UI; a
  technical one runs the one-line verify.
