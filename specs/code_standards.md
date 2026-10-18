# code_standards.md

## Language & config

- **TypeScript strict everywhere.** Root `tsconfig.json` sets `strict: true`,
  `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`,
  `noImplicitOverride: true`, `verbatimModuleSyntax: true`. Packages extend it.
- **ESM only** (`"type": "module"`). Node ≥ 22, pnpm workspaces.
- Target `ES2023`; `moduleResolution: "bundler"` for apps, `"nodenext"` for libs.

## Numeric discipline (critical)

- All on-chain-mirrored amounts are **unsigned** and represented as `bigint`,
  never `number`. Serialize as decimal strings at API/JSON boundaries.
- Field widths from the leaf schema are enforced at the boundary:
  `Uint128` ≤ 2^128−1, `Uint160` ≤ 2^160−1. Reject on overflow — never wrap.
- Signed quantities are modelled as explicit `{ in: bigint; out: bigint }`
  pairs, matching the circuit (Compact has no signed ints). Never pre-subtract.

## Determinism rules (indexer & merkle)

- No `Date.now()`, `Math.random()`, map/set iteration-order dependence, or
  floating point in any value that feeds a root. Sort explicitly; hash over a
  canonical byte encoding.
- Hash/commitment functions are injected via interface so they can be swapped
  for the Midnight-native primitive without touching call sites.

## Error handling

- Boundaries (RPC, IPFS, DB, HTTP, file I/O) validate input and return typed
  `Result`-style errors or throw typed errors; internal code trusts its callers.
- No silent fallbacks on data that feeds a proof — fail loudly and deterministically.

## Structure & naming

- `packages/*` are pure libraries (no side effects at import). `apps/*` own I/O.
- Files: `kebab-case.ts`. Types/classes: `PascalCase`. Values/functions: `camelCase`.
  Constants: `UPPER_SNAKE`. One primary export concept per file.
- Public API of each package is re-exported from its `src/index.ts`.

## Testing

- **Vitest.** Every `packages/*` ships unit tests; determinism tests assert
  byte-identical roots across repeated/independent runs.
- Known-answer vectors for Merkle paths and the leaf encoder live in
  `__fixtures__/`.

## Comments

Default to none. Comment only non-obvious *why* (an invariant, a Compact
constraint, a known-answer source). Never narrate *what* the code does.

## Secrets

Never commit `.env*`, salts, witnesses, RPC/Blockfrost tokens, or keys.
`.gitignore` covers them; config is read from env at runtime only.
