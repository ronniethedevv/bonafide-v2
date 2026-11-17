# UX landscape & gap analysis

_Second market study — this one on **UX**, how comparable products present verifiable,
privacy-preserving reputation/trust to the people who consume and produce it. Dated
2026-11-16. Companion to `specs/COMPETITIVE_LANDSCAPE.md` (which covered protocol/feature
gaps)._

The hard UX problem in our class is **legibility of "private but verifiable"**: a viewer
must believe a number they can't see the inputs to, and a producer must keep that number
current. Below: how eight products solve pieces of it, what our current UI misses on both
sides, and a ranked list of UX must-dos.

Sources are listed at the end; vendor/secondary material is marked.

---

## 1. Eight UX comparables

### 1.1 EAScan (attestation explorer)
An Etherscan-style explorer: an address page shows attestations made/received, an
on/off-chain filter, and a table with **UID · Schema · From · To · Type · Age**. Crucially
it **decodes attestation data by its schema** so a verifier reads contents, not raw bytes;
it **resolves ENS names** for attesters; and it renders **refUID relationships** between
linked attestations. Off-chain attestations appear only if published (e.g. to IPFS).
- **Lesson:** use a familiar explorer pattern; decode raw commitments into human-readable,
  schema-labelled content; resolve identities; show how records relate.

### 1.2 Credora / RedStone (credit ratings dashboard)
Each rated entity shows a **letter grade (A+ → D)** mapped to a **probability-of-default
band**, a numeric risk score, **the number of reviewers behind the rating**, **historical
trend** charts, and distribution charts; headline tiles show rated TVL and counts. An
honest cap: entities that don't provide real-time visibility are **capped at A**. Lenders
pull scores by **API**.
- **Lesson:** a single instantly-legible grade + what it means (PD band); surface **how
  many attesters stand behind it**; a time trend, not just a point; honest caps; be
  machine-consumable.

### 1.3 Proof-of-reserves dashboards (OKX / Binance / Kraken / Ledn)
Framed as **"verify, don't trust."** The strongest pattern is a **per-user inclusion
check** — Ledn/Kraken let an individual confirm *their own balance* is in the latest
audit via their dashboard or an auditor's explorer. Best practice is to show **liabilities
next to reserves** (solvency is a relationship, not a number) and to **state plainly what
the dashboard does not prove**. Cautionary case: a protocol advertised "continuous
cryptographic proof" and collapsed months later — a label implied more assurance than the
proof gave.
- **Lesson:** give each client a **"confirm my engagement is included and verify it"**
  path; show both sides of any claim; never imply more assurance than the proof provides.

### 1.4 ZK privacy UX (Concordium / Brave / HackerNoon)
Explaining zero-knowledge to non-technical users is **the** problem; even family-level
explanations fail, so lean on **analogy** ("like 'your chat is encrypted' — you trust it
without the maths"). Make the proof **work in the background** — but still **let users see
the statement being proved**, and **don't make them configure** selective disclosure (it's
a cognitive burden). Trust in the **issuer and verifier** persists, so the UI must cue
**who attested and who checks**. Framing: a shift from **"trust by exposure" to "trust by
proof."**
- **Lesson:** abstract the cryptography; surface **what is proven** and **who stands
  behind it**; never ask the user to operate the ZK machinery.

### 1.5 Gitcoin / Human Passport (score + stamps)
Score shown top-right; **signing in auto-renews stamps so they don't expire** (freshness
handled for the user); a ~20 pass threshold reachable in a few verifications (~5 min);
**two paths** — on-chain history for power users, in-app stamps for newcomers. Weights
change over time, so **a score can move without the user acting** — a transparency burden.
- **Lesson:** make verification low-friction and **auto-refresh freshness**; offer
  progressive paths; tell people when the ground shifts under their number.

### 1.6 Verifiable-credential wallets (academic usability work)
Disclosure mistakes are common (~15%, cut to ~7% with a guidance aid). **Terminology
confuses users** — "Credential", "DID" read as jargon. A recurring idea: a **receipt of
what a verifier *asked* for**, not only what was sent, since verifiers over-ask.
- **Lesson:** **plain language over jargon**; a guided, low-mistake verify flow; show what
  was requested/shared.

### 1.7 Fintech trust UX (Stripe / Wise / general)
Verified **badges borrow familiar symbols** (lock, SSL) for instant recognition — but
**badges alone don't earn trust**; transparency, speed and control do. The strongest signal
is **"an interface where users can verify the company's claims themselves."** Verification
**microcopy lifts onboarding completion ~20–30%** (vendor figure); explain **why** data is
needed and **how** it's used; attach a **provider badge to each data point**; **progressive**
verification (start before finishing) cuts drop-off.
- **Lesson:** a verified badge is only as good as the **tooltip that says what was checked,
  by whom, and when**, plus a real self-verify affordance; invest in microcopy.

### 1.8 Financial tear sheets / credit reports (Equifax redesign, report design)
Equifax's consumer-researched redesign **leads with the headline score, then the factors
that help and hurt it** (CFPB focus groups informed it). Report-design best practice:
**strip chart junk, label data directly**, design facing pages as a unit, support
**random access** (it's a reference doc), **add narrative context** ("tell the full
story"), and keep formatting consistent.
- **Lesson:** lead with the headline and its **factor breakdown**; label directly; add a
  sentence of narrative; keep it consistent and skimmable.

### Scorecard — how our UI does today
| UX pattern | Us today |
|---|---|
| Decoded, schema-labelled, explorer-style record | ◑ profile/tear-sheet, no decoded attestation view |
| Single legible grade/standing + what it means | ❌ (we show 96% + tier counts, no standing) |
| "How many attesters stand behind this" surfaced | ❌ (committee is in data, not UI) |
| Historical trend | ✅ depth/uptime epoch chart |
| Per-client inclusion / self-verify in the UI | ❌ (verifier is a CLI only) |
| "How to trust this" explainer (plain-language) | ◑ privacy-note only |
| Who attested / who verifies, cued in UI | ❌ |
| Freshness shown / auto-refreshed | ◑ freshness chip (viewer-side), no MM refresh prompt |
| Honest scope / "what this does not prove" | ✅ coverage note (from the last pass) |
| Factor breakdown behind the headline | ❌ |
| MM-side dashboard (capture/prove/claim status) | ❌ (specced in ui_context, unbuilt) |
| Microcopy / jargon-free | ◑ mixed |

---

## 2. Gaps

### Client side (reputation consumer)
- **CX1 — No in-UI self-verification.** Every comparable's strongest trust signal is "an
  interface where you can verify the claim yourself." Our verifier is a CLI; the UI asks
  for trust. (Fintech, PoR, ZK.)
- **CX2 — "Who attested / how to trust this" is invisible.** The 2-of-3 committee and the
  independent-recompute story live in data, not on screen. ZK/VC research says cueing the
  issuer/verifier is essential. (Credora shows "number of reviewers.")
- **CX3 — No per-engagement inclusion/verify path.** A client can't confirm *their*
  engagement is in the record and check its figures — the PoR per-user-inclusion pattern.
- **CX4 — No legible standing + factor breakdown.** We lead with "96%" but no single
  standing or the factors behind it (uptime, custody, consistency, tiers). (Credora/Equifax.)
- **CX5 — Jargon & thin explanation.** No plain-language "trust by proof" explainer; terms
  assume context. (ZK/VC usability.)

### Market-maker side (reputation producer)
- **MX1 — No MM dashboard.** `ui_context.md` specs `/dashboard` (engagement states,
  proving/epoch status, bond, claim queue); it's unbuilt. The witness-capture tool now
  produces coverage/verdict data with nowhere to show it.
- **MX2 — No freshness/renew prompt for the MM.** Passport auto-renews on sign-in; our MM
  gets no "capture the next epoch / your record is ageing" nudge.
- **MX3 — No capture→prove→attest→settle progress.** Async status (Passport stamps take
  weeks) needs a per-epoch progress view; the MM can't see where an epoch is in the pipeline.

---

## 3. Ranked UX must-dos (by impact on trust + adoption)
1. **In-UI self-verification + "how to trust this" panel** (CX1+CX2+CX5) — the single
   cross-cutting pattern in every comparable, and the cheapest credibility unlock: surface
   who attested (2-of-3), the "independently recomputable from published data" story in
   plain language, and a real verify affordance. _Feasible now._
2. **Legible standing + factor breakdown** (CX4) — lead the profile/tear-sheet with a
   plainly-derived standing and the factors behind it (uptime, custody, consistency, tier
   mix), Equifax/Credora-style, **without** inventing an opaque score. _Feasible now._
3. **Per-engagement "independently verifiable" affordance** (CX3) — each engagement shows
   it's attested + recomputable, with the verify path, moving toward the PoR per-client
   inclusion check. _Feasible now (full client-auth flow is later)._
4. **MM dashboard** (MX1–MX3) — capture coverage (from `@mmr/witness`), proving/claim
   progress, and a freshness/renew prompt. _Feasible now, larger._
5. **Microcopy & jargon pass** (CX5) — plain-language across the UI; explain why/what/when
   on every verification cue. _Ongoing._

## 4. Implemented now
Consistent with the earlier pass, the **top item** is implemented in this change (it's pure
surfacing of existing capability — no new product framing to litigate): an in-UI
**"How to trust this record"** panel on the profile and tear sheet that states, in plain
language, that the record is **attested by a 2-of-3 committee** and **independently
recomputable from published data**, and gives the **self-verify path** (the `@mmr/attest`
verifier a client runs themselves). Items 2–5 are scoped above and await a design steer.

---

## Sources
- EAScan: [EAS docs — explorer](https://optimism.easscan.org/learn/page_3); [QuickNode — what is EAS](https://www.quicknode.com/guides/ethereum-development/smart-contracts/what-is-ethereum-attestation-service-and-how-to-use-it).
- Credora / RedStone: [Credora — Public Ratings](https://x.com/CredoraNetwork/status/1904567425888325712); [Credora app](https://app.credora.network/); [Cointelegraph — RedStone launches Credora ratings](https://cointelegraph.com/news/redstone-launches-credora-defi-risk-ratings-after-20b-liquidation).
- Proof of reserves: [Blockworks — can proof of reserves build trust](https://blockworks.co/news/what-are-proof-of-reserves-and-can-they-build-back-trust); [CryptoSlate — proving assets without proving solvency](https://cryptoslate.com/four-years-after-ftx-crypto-exchanges-still-prove-assets-without-proving-solvency/); [DeFiLlama — two generations of reserve proofs](https://defillama.com/research/spotlight/two-generations-of-reserve-proofs-msusd-main-street).
- ZK privacy UX: [Concordium — understanding ZK proofs](https://www.concordium.blog/understanding-zero-knowledge-proofs-the-privacy-infrastructure-powering-trust-2/); [Brave — limits of ZK for age verification](https://brave.com/blog/zkp-age-verification-limits/).
- Passport UX: [Human Passport docs — key terms](https://docs.passport.human.tech/overview/key-terms); [Passport — scoring 20, for humans](https://support.passport.xyz/passport-knowledge-base/stamps/scoring-20-for-humans).
- Verifiable-credential usability: [De Gruyter — Hidy wallet usability (icom 2024-0057)](https://www.degruyterbrill.com/document/doi/10.1515/icom-2024-0057/html); [NIST NCCoE — mDL usability findings](https://pages.nist.gov/nccoe-mdl-project-static-website/use-case-1/usability-results.html).
- Fintech trust UX: [LogRocket — trust-driven UX examples](https://blog.logrocket.com/ux-design/trust-driven-ux-examples/); [Raw.studio — Wise transparency-first UX](https://raw.studio/blog/how-wise-uses-3-transparency-first-ux-principles/) _(secondary)_.
- Tear sheets / credit reports: [ConsumerAffairs — Equifax credit-report makeover](https://www.consumeraffairs.com/news/equifax-gives-its-credit-report-a-makeover-060925.html); [Made Good Designs — report design](https://madegooddesigns.com/?p=5503) _(secondary)_.
