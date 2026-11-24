# Competitive landscape & gap analysis

_Market research for BonaFide v2. Dated 2026-11-16._

This studies the class of product we sit in — **privacy-preserving, verifiable
reputation / attestation infrastructure** — through eight comparable projects,
extracts what they get right, and maps the gaps on both sides of our market: the
**client** (who consumes an MM's reputation) and the **market maker** (who produces
it). It closes with a ranked list of must-dos and the three we implement now.

Sources are listed at the end. Where a claim rests only on a vendor's own material
or a low-authority SEO blog, it is marked; treat those as directional.

---

## 1. Where we sit

We let a market maker prove, per engagement and per epoch, that they met measurable
delivery targets (depth, uptime, utilization, custody, no round-trips) with
zero-knowledge proofs on Midnight, checked against a **deterministic, independently
recomputable** on-chain index (Uniswap v3 on Base + Ethereum), without revealing their
books. The public surface is a reputation profile + tear sheet; the trust spine is:
deterministic indexer → per-pool Merkle trees → epoch root-of-roots → IPFS → a 2-of-3
attester committee → an independent watcher that recomputes the root from published data.

That combination — **private inputs, public verifiable outcome, recomputable from
source** — is exactly the design space the projects below occupy. None of them does
our specific thing (MM delivery reputation), but each has solved a sub-problem we
either share or have under-built.

## 2. Eight comparables

### 2.1 Credora (now "Credora by RedStone") — the closest analog
Private, real-time **credit/risk ratings for crypto borrowers, explicitly including
market makers** (Wintermute is a cited user; on Clearpool a firm's Credora rating sets
its rate, borrow cap and risk premium). Original model: borrowers' private financials
are evaluated so that *no one, including Credora, sees the raw data*, with ZK proofs
attesting the privacy, neutrality and integrity of the risk computation. Reported
$1bn+ in uncollateralized loans across 100+ counterparties.
- **What we learn:** the market for "prove you're trustworthy without opening your
  books" is real and monetizes through lending terms — our natural demand-side pull.
- **The telling pivot:** Credora later launched a **Consensus Ratings Protocol** that
  aggregates assessments from multiple expert contributors, and was acquired by
  RedStone. Pure single-party ZK scoring was hard to make _credible and decentralized_;
  they added a committee/consensus layer. We already have a 2-of-3 attester committee —
  that instinct is validated, and the lesson is to lean into multi-attester credibility
  rather than a single prover's say-so.

### 2.2 Ethereum Attestation Service (EAS) — the attestation primitive
The de-facto standard for on/off-chain attestations: typed **schemas**, a stable
**UID** per attestation, **revocation** (a schema-level `revocable` flag; revoke by
UID; verifiers must check revocation against the canonical contract), **resolver**
hooks for custom accept/reject logic, and **refUID** chaining to link attestations.
Off-chain attestations are EIP-712-signed JSON distributed with the data.
- **What we learn:** a reputation claim should be a **portable, typed, independently
  verifiable artifact with first-class revocation** — not a figure rendered only in our
  UI. We publish roots and can recompute them, but we do not emit a portable attestation
  object a client can carry into their own tooling, nor do we model revocation/expiry.

### 2.3 UMA Optimistic Oracle — dispute economics
Answers are proposed, then subject to a **liveness/challenge window** (default ~2h)
during which anyone can dispute by posting a **matching bond**; undisputed answers
settle, disputes **escalate to a token-holder vote**, and the loser's bond is
reallocated (disputer gets ~half in OOV3).
- **What we learn:** our settlement state machine already has a challenge window and
  void/default/slash paths — the UMA parallel confirms the shape. The gaps UMA makes
  obvious: **who may dispute, with what bond, over what window, and how it escalates**
  must be explicit and _client-facing_, not back-office only. A reputation nobody can
  practically challenge is just a vendor assertion.

### 2.4 Summa (PSE) & Proof-of-Reserves v2 — Merkle-commitment privacy done rigorously
Exchanges commit customer liabilities in a **Merkle sum tree**, publish only the root
on-chain, and prove in ZK that a user is included with the right balance, the tree
hashes to the commitment, aggregates satisfy constraints, and nothing overflowed — all
without revealing other users' data.
- **What we learn:** this is our exact commitment pattern, and it carries two sharp
  warnings. (a) **Sum-tree/commitment design is subtle** — the original Maxwell scheme
  had an _understatement_ vulnerability; aggregation and overflow must be constrained in
  the circuit (we should keep auditing our depth/flow commitments for the analogous
  "understate the bad, overstate the good" attack). (b) **One-sidedness proves little**:
  reserves without liabilities is meaningless. Our analog — _good metrics without proof
  the record is complete_ — is the single biggest conceptual hole (see §3, cherry-pick).

### 2.5 Reclaim Protocol (zkTLS) — bringing off-chain venues in
Generates a ZK proof over a real TLS session so a user can prove a specific fact from
an authenticated web2 page (e.g., **CEX account ownership/balance**) without revealing
the rest; phone-fast (seconds). Already used (e.g., Hinkal) to prove CEX account
ownership with no data disclosed to the verifier.
- **What we learn:** MMs do the majority of their volume on **centralized venues**. A
  reputation built only on Uniswap v3 is a narrow slice. zkTLS is the credible path to
  let an MM attest CEX depth/uptime/flow privately. This is our largest _scope_ gap.

### 2.6 Sismo — selective disclosure, nullifiers, and a cautionary tale
A user-controlled **Data Vault** with **selective disclosure**; attesters used
**nullifiers** (an anonymous deterministic per-vault id) to stop one identity minting a
badge twice. ~65k users / ~160k badges — then **sunset in Sept 2023**, reportedly amid
difficulty making technical/commercial progress (unconfirmed, anonymous sources).
- **What we learn:** two things. (a) **Nullifiers** are the standard primitive against
  replay/double-counting and against one entity claiming the same thing twice — we
  should pin down our replay story. (b) **Adoption risk is existential**: strong ZK tech
  is not enough; the product has to be pulled by a concrete demand (lending terms,
  allocation decisions). Keep the client's job-to-be-done central.

### 2.7 Spectral Finance / Cred Protocol — on-chain credit scores
ML models over on-chain behavior output soulbound/non-transferable **credit scores**
other protocols query.
- **What we learn:** their persistent weak point is **Sybil resistance and
  whitewashing** — wallets are cheap ($0.01–$50), and a bad actor can abandon a poor
  history and start fresh; plus a **cold-start** problem for new entities. Our record
  must bind an MM identity and make a _fresh start costly_, or a bad MM just re-registers.

### 2.8 Gitcoin / Human Passport + Verax — aggregation, standards, forgery cost
Reputation as **weighted stamps** with a pass threshold, moved on-chain by storing
Passport data in **EAS**; on Linea, read through **Verax**. 2M+ users; nine defended
grant rounds (vendor figures).
- **What we learn:** (a) build on a **shared attestation registry/standard** (they chose
  EAS) rather than a bespoke store, for composability and to avoid a single vendor
  point-of-failure; (b) frame Sybil resistance honestly as **cost-of-forgery** (expensive,
  not impossible); (c) centralized control of schema/scoring is a criticized SPOF —
  our multi-attester + recomputable-from-source design is a genuine differentiator to
  lean on.

### Scorecard — do we have it?
| Capability (from comparables) | Us today |
|---|---|
| Private inputs, public outcome | ✅ core design |
| Recomputable from source (determinism) | ✅ indexer + watcher |
| Multi-party credibility (committee/consensus) | ◑ 2-of-3 on-chain; no live fleet |
| Portable, typed attestation artifact (EAS-style) | ❌ |
| Revocation / expiry / freshness | ❌ |
| Explicit, client-facing dispute economics (UMA) | ◑ state machine only |
| Completeness / anti-cherry-pick (PoR lesson) | ❌ conceptual hole |
| Replay/nullifier hardening (Sismo/Summa) | ◑ needs pinning |
| Sybil / anti-whitewashing identity binding | ❌ |
| Off-chain / CEX coverage (zkTLS) | ❌ scope |
| Client-side independent verification tool | ◑ watcher exists, not client-packaged |

---

## 3. Gaps we have missed or under-built

### Client side (the reputation consumer)
- **C1 — No portable, client-verifiable attestation.** The watcher can recompute a
  root, but a client gets a number in our UI, not a typed artifact they can verify in
  their own stack. (EAS, Passport, Summa.)
- **C2 — No revocation / expiry / freshness.** Reputation never goes stale and can't be
  revoked. A 2-year-old record reads the same as last week's; a root later found wrong
  can't be marked so. (EAS.)
- **C3 — Cherry-pick / completeness.** _The biggest one._ Nothing stops an MM from only
  ever making their **good** engagements public and silently omitting the bad. "96%
  uptime across 6 engagements" is unfalsifiable if the denominator is self-selected.
  This is the PoR "reserves without liabilities" failure in our domain. (Summa.)
- **C4 — Dispute path is not client-facing.** The challenge window, bond, who-may-dispute
  and escalation aren't surfaced or usable by a client who thinks a result is wrong. (UMA.)

### Market-maker side (the reputation producer)
- **M1 — On-chain-only scope.** Uniswap v3 Base/ETH misses CEX and most other venues
  where MMs operate; the record undercounts real activity. (Reclaim/zkTLS.)
- **M2 — Witness capture tool missing.** The private depth/uptime/flow recorder that
  produces the MM's witnesses does not exist yet — the core input to the whole proof.
- **M3 — Sybil / whitewashing.** Nothing makes abandoning a bad identity and
  re-registering costly; reputation can be reset. (Spectral/Passport.)
- **M4 — Replay / double-counting.** We should pin, with nullifiers, that the same
  on-chain activity or epoch can't be counted into two engagements/claims. (Sismo/Summa.)
- **M5 — Attester operations.** 2-of-3 is enforced on-chain; a live Jubjub-Schnorr
  signing fleet and the fee-sponsor (DUST self-relay) are not yet operational.

---

## 4. Ranked must-dos (by importance)

Ranked by impact on the product's _trustworthiness and adoption_, with feasibility in
the current (no-live-Midnight) environment noted.

1. **Completeness / anti-cherry-pick (C3).** Without it the headline numbers are
   gameable and the product's core claim — "a reputation you can trust" — is hollow.
   _Feasible now_ (scope disclosure + client-anchored engagements + no-gap verification;
   full cryptographic completeness is a protocol track).
2. **Portable, client-verifiable attestation + verification kit (C1).** Clients must
   verify without trusting us; this is the composability and credibility unlock. _Feasible now._
3. **Revocation + freshness/recency (C2).** A reputation that can't expire or be revoked
   is misleading and unsafe. _Feasible now._
4. **Sybil / anti-whitewashing identity binding (M3).** Make a fresh start costly; bind
   identity and carry bond/stake continuity. _Partly feasible_ (design + read-model;
   full enforcement is circuit/on-chain).
5. **Replay / nullifier hardening (M4).** Prevent double-counting across
   engagements/epochs. _Circuit-level; design now, enforce on Midnight._
6. **MM witness-capture tool (M2).** The missing private-input recorder. _Feasible now_
   (TS tool), large.
7. **Off-chain / CEX coverage via zkTLS (M1).** Biggest scope expansion; highest effort.
   _Roadmap._
8. **Client-facing dispute economics (C4).** Surface window/bond/escalation + a challenge
   path. _Partly feasible_ (UI + API; enforcement on-chain).
9. **Attester fleet + fee-sponsor (M5).** Operational; needs the live Midnight path.

## 5. What we implement now (top 3)

The top three are all feasible in this environment and attack the three worst _trust_
holes. See `specs/progress_tracker.md` for the dated build entries.

1. **Completeness & scope integrity (#1).** An honest, machine-readable **coverage/scope**
   statement on every record (chains, venues, and the explicit "self-selected public
   engagements — not a complete trading history" caveat), surfaced in the profile, tear
   sheet, and the new attestation; plus a **no-epoch-gap** verifier check so an MM can't
   silently drop epochs _inside_ a registered engagement. The cherry-pick threat and the
   client-anchored-registration mitigation are written up as a design decision.
2. **Portable attestation + client verification kit (#2).** A new `@mmr/attest` package:
   an EAS-style typed **EpochAttestation** (chain, epoch, range, root-of-roots, attester
   set, timestamps, revocation/expiry, schema id + deterministic uid) and a
   **client-side verifier** that re-derives the root from the published tree (reusing the
   watcher) and rejects anything revoked, expired, or mismatched — shipped with a CLI so a
   client runs it themselves, no trust in us.
3. **Revocation + freshness (#3).** The attestation carries `attestedAt` / `expiresAt` /
   `revoked`; the verifier enforces them; the read model and UI compute and show a
   **freshness** state (fresh / ageing / stale) and a revoked badge, so consumers see how
   current — and how valid — a record is.

---

## Sources
- Credora: [FIA — Announcing Credora, the Credit Oracle](https://www.fia.org/marketvoice/articles/announcing-credora-credit-oracle); [Credora — Brings Credit Scores On-Chain](https://credora.medium.com/credora-brings-credit-scores-on-chain-71516927912b); [Credora — Where We Are Going (3/3)](https://medium.com/credora/credora-where-we-are-going-part-3-of-3-8585836f003c).
- EAS: [EIP draft on EAS attestations](https://eips.ethereum.org/EIPS/eip-8176); [EAS contracts (SchemaResolver)](https://cdn.jsdelivr.net/npm/@ethereum-attestation-service/eas-contracts@1.9.0/contracts/resolver/SchemaResolver.sol); [Builder guide: agent-based attestations](https://mirror.xyz/0xeee68aECeB4A9e9f328a46c39F50d83fA0239cDF/doCr8LbTnKjiVlRHItbwAlmuGuw20oY1xKEANfPgi7U).
- UMA: [Setting custom bond & liveness parameters](https://docs.uma.xyz/developers/setting-custom-bond-and-liveness-parameters); [Optimistic oracle glossary](https://pm.wiki/id/data/glossary/optimistic-oracle).
- Proof of reserves / Summa: [OtterSec — PoRv2: ZK proof of reserves](https://osec.io/blog/2025-08-27-how-proof-of-reserves-uses-zk-to-protect-your-funds); [PSE — From CEX to CCEX with Summa (Part 1)](https://pse.dev/blog/from-cex-to-ccex-with-summa-part-1); [Spark — Proof of reserves after FTX](https://www.spark.money/research/bitcoin-exchange-proof-of-reserves-standards).
- Reclaim / zkTLS: [What is Reclaim Protocol](https://blog.reclaimprotocol.org/posts/what-is-reclaim-protocol); [Reclaim — understanding the tech](https://docs.reclaimprotocol.org/understanding-the-tech); [Hinkal compliance (CEX proof via Reclaim)](https://hinkal-team.gitbook.io/hinkal/hinkal-wallet/compliance).
- Sismo: [Sismo — ZKPs as a service / ZK badges to Sismo Connect](https://sismo.mirror.xyz/MimvqFv45hohMwDBD9rGqY4XGZIHRR8On7nx6q9YFRc); [The Big Whale — Sismo in difficulty](https://en.thebigwhale.io/article-en/exclusive-sismo-in-difficulty-could-soon-be-shut-down).
- On-chain credit (Spectral / Cred): [ChainScore Labs — reputation oracles / on-chain credit](https://www.chainscorelabs.com/blog/decentralized-identity-did-and-reputation/reputation-oracle-design/why-reputation-oracles-are-the-missing-link-for-on-chain-credit) _(secondary/promotional)_.
- Gitcoin / Human Passport + Verax: [Gitcoin — Passport onchain stamps](https://www.gitcoin.co/blog/gitcoin-passport-onchain-stamps); [Gitcoin — Building Sybil resistance using cost of forgery](https://gitcoin.co/blog/cost-of-forgery); [Human Passport — proof of personhood](https://human.tech/blog/proof-of-personhood-human-passport).
