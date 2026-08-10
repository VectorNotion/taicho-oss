# Targeting & Account/Prospect Research Split — Design

**Status:** Approved (brainstorm 2026-08-10). Build document for the plan that follows.

**Context:** `docs/icp-update-v2.md` is the functional spec. The scoring engine, dimension data model, observations, matches, and qualification already exist (`products/outreach/domain/`, `products/outreach/data/`). This design re-cuts *where research lives and how it is defined and shown* to match the spec's separation (§17: what-we-want / what-we-found / how-well-it-matches). The database can be wiped — no migration or backward-compat constraints.

---

## 1. Objective

Make the definition of "who we pursue" a first-class, editable, workspace-level concept (**Targeting**), and split research by entity so a **company** is researched and scored on its own (ICP fit + timing), a **person** is researched and scored on their own (persona fit), and **qualification** becomes an instant decision that reads those scores. Every research finding is shown as raw evidence *and* as a match against the ideal — so the user can see the scoring and audit the data behind it.

## 2. Core concept — Targeting is a set of lenses

**Targeting** is the "what we want" side of the whole system. It holds two **lenses**, edited identically:

- **ICP** — the *account* dimensions: `dimensionType: fit` (stable structure) + `dimensionType: timing` (dated buying-window signals).
- **Persona** — the *prospect* dimensions: `dimensionType: fit` (the person's fit).

A **dimension** is the unit (already modeled as `DimensionDefinition`): `key`, `name`, `dimensionType` (fit|timing), `appliesTo` (account|prospect), `researchInstruction` (what to hunt for), `idealValue` (what a strong match looks like), `weight`, `freshnessWindowDays`, `halfLifeDays` (timing), `hardExclusionRule` (fit), `isActive`.

**v1:** exactly one ICP and one Persona — i.e. the single set of `appliesTo:account` dimensions *is* the ICP, and the single set of `appliesTo:prospect` dimensions *is* the Persona. **Forward-compatibility (not built in v1):** a nullable `lensId` grouping on `DimensionDefinition` would later allow multiple named ICPs/Personas ("lenses") that the user switches to re-score the same accounts/prospects. v1 leaves the column absent; adding it later is additive, not a migration of meaning.

Targeting is consumed by three things: the researchers ("go find these"), the scoring ("match findings against ideal"), and the account/prospect pages ("here's what we wanted vs found"). Because Nurture and Content can also read Targeting later, it lives at **workspace root**, not inside Outreach.

## 3. Data model (clean redesign)

Keep (already correct): `DimensionDefinition`, `AccountObservation` / `ProspectObservation` (shape `prose|signals`, `observedValue` | `signals[]`, `evidence[]`, `confidence`, `researchedAt`, `runId`), `DimensionMatch` (`matchScore`, `effectiveMatch`, `classification`, `hardExclusion`, `confidence`), `ResearchRun` (`runType`, `refreshedDimensions`).

**Change — scores move to the entity they describe:**
- **Account** owns its **ICP score** and **Timing score**. New node `:AccountScore` (one per account, replace-on-write) via `(:Account)-[:HAS_SCORE]->(:AccountScore {icpScore, timingScore, hardExcluded, computedAt})`, plus `timingBreakdownJson` and `reviewReason`. Account scores exist independently of any prospect.
- **Prospect** owns its **Persona score**. New node `:ProspectScore` via `(:Prospect)-[:HAS_SCORE]->(:ProspectScore {personaScore, hardExcluded, computedAt, reviewReason})`.
- **Qualification** (`:ProspectQualification`, kept) is now purely the *decision*: `status`, plus references to the inputs (`icpScore`, `personaScore`, `timingScore` copied at decision time), `reviewReason`, `computedAt`. No matches/observations stored here anymore — those live on the entities.

**Delete (DB wipe):**
- `prospectResearchSchema` / `generateProspectResearch` / `runProspectResearch` / `storeProspectResearch` / `:ProspectResearch` / `:CompanyInsight` / `:Competitor` and the `/api/outreach/research` streaming route — company research stapled to a person. Company facts become account ICP observations.
- `talkingPoints` / `outreachAngle` leave *research* entirely — they are outreach *generation* inputs, produced by the existing outreach generator when a draft is created, not stored as research.
- Legacy `:Persona` nodes, `persona-repository.ts`, the old Personas page (target-titles/company-size), and `:LegacyQualification` — replaced by the Persona dimension set.

## 4. Navigation / IA

Workspace root nav becomes: `People · Targeting · Content · Brain · Resonance` (Targeting replaces the current Personas item). Services (Outreach, Content tools, Nurture) unchanged. Update `apps/unified/components/unified-sidebar.tsx` and `apps/outreach/components/product-sidebar.tsx`. Remove `/outreach/personas` and the root Personas nav; add `/targeting`.

## 5. Targeting page (`/targeting`)

Design-language compliant (PageHeader, dense surfaces). Two lenses shown as **Tabs** (`ICP`, `Persona`) or two sections; each is a record list of its dimensions using the §8 `ListRow`/`ListCard` recipe:

- Row: dimension `name` + `Badge` for type (fit/timing) + meta line (`weight`, `freshness`, `half-life` for timing, "hard exclusion" if set).
- Header action: **+ Add dimension** → `Dialog` form: name, type (fit/timing; timing only for ICP/account), research instruction (textarea), ideal value (textarea; fit only), weight, freshness window, half-life (timing), hard-exclusion rule (fit, optional).
- Row actions: edit (same dialog), delete (confirm dialog).
- Backed by the existing `dimension-repository` CRUD and `/api/outreach/dimensions` routes (org-scoped via `withOrgScope`). Seed defaults from `default-dimensions.ts` on first load (already implemented).

An empty Targeting (no dimensions) shows the §4 empty state with "Add your first dimension" and offers to seed the spec defaults.

## 6. Research operations (Option A, streaming)

Two independent operations, each streams the generative UI. Both are **dimension-driven** — the lanes shown are the active dimensions of the relevant lens, not a fixed topic list.

### `research_account`
Input: account id. Flow: load active `appliesTo:account` dimensions → freshness filter (research only lapsed, §14) → `researchDimensions` (Tavily per dimension + one synthesis call producing prose observations for fit, dated signal lists for timing) → `upsertObservation` per dimension → `evaluateFitMatches` on fit dims → `computeTimingScore` on timing dims → `saveMatches` + write `:AccountScore` (icpScore from `computeFitScore`, timingScore, hardExcluded, timingBreakdown) → `recordResearchRun`. Triggers a re-qualify of the account's prospects (§9, cheap). Emits, per dimension: `searching` → `found` (observation + evidence) → `matched` (score).

### `research_prospect`
Input: prospect id. Flow: load active `appliesTo:prospect` dimensions → freshness filter → `researchDimensions` (person) → `upsertObservation` → `evaluateFitMatches` → `saveMatches` + write `:ProspectScore` (personaScore) → `recordResearchRun` → re-qualify this prospect. Emits per persona dimension the same lane lifecycle.

Both use the existing `dimension-research.ts` / `match-evaluator.ts` (LLM extracts facts + dates and judges match; recency and policy stay deterministic). Streaming via `actionStreamResponse` (durable job) with a generalized `data-dimension-progress` part type: `{ dimensionKey, name, type, phase: 'searching'|'found'|'matched', observation?, evidence?, signals?, matchScore?, classification? }`. Actions registered as `research_account` and `research_prospect` (contracts, catalog, registry, payloads, pricing, capabilities, MCP).

### Generative-UI surface (generalized)
Replace the fixed-5-topic `ResearchLiveSurface` with a **dimension-lane surface**: one lane per active dimension, showing the dimension name, a live status (searching → found → matched), the observation prose or dated signals as they arrive, evidence links, and the match score when scored. Reuses the genui primitives (`ReasoningTicker`, `StreamSection`, `LiveDot`, `ScoreRing`, `StreamingText`) and `useActionStream`. The account page and prospect page both render this surface for their own research.

## 7. Display — "what we wanted → what we found → how well it matched"

### Account page (`/outreach/accounts/[id]`)
- **Header**: account name, Target badge, **Research account** button (streaming; live dimension surface renders below on run).
- **Scores**: ICP + Timing rings (from `:AccountScore`).
- **ICP fit** — per fit dimension, a card/row: ideal value (muted) → the observation prose → clickable evidence sources → match score bar + classification. This is the auditable "match happened on this raw data".
- **Timing** — per timing dimension: the dated signals as a timeline (signal, date, evidence, decayed contribution), plus the dimension's decayed value.
- **Prospects table** — as built (add prospect, per-row research prospect, persona score, qualification status).

### Prospect page (`/outreach/prospects/[id]`)
- **Persona fit** — per persona dimension: ideal → observation + evidence → match. Persona score ring.
- **Qualification** — the decision status (QUALIFIED / CONTACT_DISCOVERY_REQUIRED / …) with reason.
- **Company context** — a compact card linking up to the account (ICP score, timing, "View account") instead of duplicating company research.
- **Research prospect** button (streaming dimension surface).

`getAccountDetail` / a new `getProspectResearch`-equivalent must return the **observations and evidence**, not just matches. Extend `getAccountDetail` to include `icpObservations` (fit prose + evidence) and `timingSignals` (dated), keyed by dimension.

## 8. Qualification — instant decision (§9 of this doc)

`qualify_prospect` no longer researches or calls an LLM. It reads `:AccountScore` (icp, timing, hardExcluded) for the prospect's account and `:ProspectScore` (persona, hardExcluded) for the prospect, then runs the existing pure `applyConfidenceRouting` / `decideStatus` (spec §11 tree) and writes `:ProspectQualification`. It runs automatically after either research op completes and is cheap enough to run on demand. No company → REVIEW with reason (as today). Timing never gates; it ranks (touch list unchanged).

## 9. Out of scope / future

- **Multiple lenses** (multiple named ICPs/Personas the user switches between to re-score). v1 is single; the `lensId` grounding note in §2 keeps it additive.
- **Nurture/Content consumption** of Targeting. Targeting is placed at root to allow it; wiring other products to read it is later work.
- **Talking points / outreach angle** generation moving into the outreach draft flow (they leave research in v1; regenerating them in the generator is a follow-up if missed).

## 10. Testing

- **Pure** (exists, keep): scoring/decay/decision/routing.
- **Repositories** (live FalkorDB): `:AccountScore` / `:ProspectScore` round-trip; `getAccountDetail` returns observations + evidence + timing signals; dimension CRUD.
- **Research operations** (DI-stubbed search + completion): `research_account` produces account observations + score for fit and timing; `research_prospect` produces persona observations + score; freshness filter researches only lapsed dims; streaming emits per-dimension parts.
- **Qualification-as-decision** (DI): reads scores, applies the §11 tree, emits `prospect.qualified`; no research/LLM invoked.
- **Architecture guards**: Targeting route org-scoped; nav contains Targeting not Personas.

## 11. Migration

None. The database is wiped before first run of the new system. A one-time `MATCH (n) DETACH DELETE n` per org graph (dev) plus dropping the removed Postgres artifacts is the entire "migration".
