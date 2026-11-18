# Circuit work — getting the Compact circuits compiling + correct

This is the handoff brief for the ZK-circuit stage (build-order items 3–4). It is
best done **with the Compact compiler in the loop** (locally on a Midnight-capable
machine), because the skeletons in `packages/contracts/src/*.compact` were written
without a compiler and need a real grammar + semantics pass.

## Goal

1. Each circuit compiles clean: `compact compile --skip-zk src/<x>.compact build/<x>`
   (drop `--skip-zk` only for the final proving-key build — it's slow).
2. The circuits enforce the invariants in [`INVARIANTS.md`](../packages/contracts/INVARIANTS.md) (I1–I10).
3. Their verdict matches the **known-answer reference oracle** in
   `packages/prover/src/oracle.ts` (`evaluateEpoch`, I1–I8) — that TS code is the
   spec; the circuit must agree with it on the same inputs.

## Toolchain (confirmed working)

- `compact` CLI 0.5.3, compiler **0.31.1**, language version **0.23.0**.
- Pin with `compact update 0.31` (ledger 8 / mainnet). Never bare `compact update`
  (pulls 0.35/ledger 9).
- Compile form: `compact compile <flags> <source> <target-dir>`.

## Grammar facts learned so far (verify against the reference as you go)

- **`pragma language_version 0.23.0;`** — the *language* version, not the toolchain
  version. (Fixed.)
- **No top-level `const`.** `const … = …;` at module scope is a parse error
  ("found keyword const looking for a program element"). Inline the literals, or
  bind `const` locally inside a circuit body where allowed. Affected: `SLOTS`,
  `BUCKETS` and the bond timing constants in `epoch_proof.compact`.
- **Numeric type is likely `Unsigned<N>`**, not `Uint<N>` — real contracts use
  `Unsigned<64>` and literals like `0u64`. Replace every `Uint<8|128|160|…>` with
  the correct `Unsigned<N>` form and use typed literals (`0u64`, etc.). **Verify
  the exact spelling and max width against the language reference.**
- Confirmed constructs from real contracts: `import CompactStandardLibrary;`,
  `export ledger <name>: <Type>;`, `export circuit <name>(…): <Ret> { … }`,
  `constructor() { … }`, `assert`, `disclose(...)`, `return`.
- **To verify against the reference** (docs host, reachable from a normal machine —
  it would not load through the build sandbox's proxy):
  - Language reference: https://docs.midnight.network/develop/reference/compact/lang-ref
  - Writing a contract: https://docs.midnight.network/compact/reference/writing
  - Bulletin-board tutorial (structs, witnesses, disclose): https://docs.midnight.network/tutorials/bboard/smart-contract
  Specifically confirm: top-level `const` support, `struct` syntax, bounded `for`
  loop syntax, `Vector<N,T>` / `Bytes<N>` / `Field` availability and spelling,
  `persistentHash` / `persistentCommit` signatures, `Map`/`Set`/`Counter` ledger
  types, and how Merkle-path checks are expressed.

## Suggested order

1. `epoch_proof.compact` first — it exercises the most grammar (structs, loops,
   vectors, arithmetic, asserts). Getting it clean unblocks the patterns for the rest.
2. Registration, bond and `claim` — now all inside `epoch_proof.compact` (H4, H3b: no cross-contract calls).
3. Once all four compile with `--skip-zk`, do a full build (drop the flag) to
   generate proving keys, then run the **proving benchmark**: measure proving time
   for the 16-slot epoch circuit and fix `BUCKETS` (currently 48/epoch placeholder).

## After the circuits compile

- Replace the SHA-256 placeholder hasher in `@mmr/merkle` with the circuit's
  native hash so TS-computed roots match in-circuit roots (see `DD-8` in
  `progress_tracker.md`).
- Implement real Jubjub Schnorr signing behind `AttesterCommittee` (`@mmr/protocol`
  has the mock).
- Implement the live Base `ChainProvider` and IPFS `TreePublisher` (`@mmr/indexer`
  defines the interfaces; both are tested against in-memory fakes today).

## Keep the oracle and the circuit in lockstep

Any change to an invariant's meaning must land in BOTH `packages/prover/src/oracle.ts`
and the corresponding `.compact` circuit, or the known-answer check is meaningless.
