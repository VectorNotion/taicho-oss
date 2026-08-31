# Prospect Qualification & Scoring System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the dimension-based Account/Prospect qualification system from `docs/icp-update-v2.md`: ICP fit scoring, Persona fit scoring, decaying Timing scoring, confidence routing, qualification statuses, and freshness-driven re-research — replacing the current flat persona score inside `qualify_lead`.

**Architecture:** Pure deterministic scoring engine (`products/outreach/domain/`) + FalkorDB graph persistence (`products/outreach/data/`) + LLM research/evaluation with DI (`products/outreach/agent/`) + a rewritten `runQualifyLead` orchestrator that keeps the existing `qualify_lead` action id, route, billing, and event wiring. UI: QualificationCard v2 showing status + three scores + dimension breakdown.

**Tech Stack:** TypeScript ESM, zod, FalkorDB via `getSession()` seam (openCypher 9: `localdatetime()`, no COUNT{}/EXISTS{}/CALL{}), OpenRouter raw-fetch structured output (same pattern as `lead-research.ts`), Tavily via `searchTavily`, `node --import tsx --test`.

## Global Constraints

- openCypher 9 dual-compatible Cypher only: `localdatetime()` not `datetime()`, no `COUNT{}`/`EXISTS{}`/`CALL{}` subqueries (docs/graph-backend.md).
- FalkorDB integers come back as IntLike — coerce numerics with the `toNumberValue` pattern from `lead-repository.ts:1400`.
- All LLM/business-policy separation from spec §12–13: LLM never judges recency or owns policy; recency is arithmetic; hard exclusions are deterministic checks on extracted facts.
- `Fit gates. Timing ranks.` Timing Score must never gate qualification (spec §2, §11).
- Existing action id `qualify_lead` (registry, billing 40 credits, routes, streaming) is preserved; internals are replaced.
- Existing `:Persona` nodes/pages stay untouched (legacy audience definitions). New system uses `:DimensionDefinition`.
- Tests: pure logic via DI stubs (style of `tests/qualify-lead.test.ts`); repositories via live FalkorDB (style of `tests/persona-repository.test.ts`). Run: `pnpm test:outreach`, `pnpm typecheck`.
- Thresholds configurable, defaults: `ICP_MINIMUM = 70`, `PERSONA_MINIMUM = 65`, low-confidence cutoff `0.5` (spec §8, §11).

## Locked Design Decisions

1. **ICP/Persona/Timing definitions = sets of `:DimensionDefinition` nodes** distinguished by `appliesTo: 'account' | 'prospect'` × `dimensionType: 'fit' | 'timing'`. ICP = account+fit, Timing = account+timing, Persona = prospect+fit. No separate ICPDefinition/PersonaDefinition container nodes (YAGNI — one profile per org today; spec §17 separation is preserved at the data level that matters: definitions vs observations vs matches vs qualification).
2. **Account resolution:** `MERGE (:Account {normalizedName})` per org graph from `lead.company` (lowercased, trimmed, collapsed whitespace). `(:Contact:Lead)-[:BELONGS_TO]->(:Account)`.
3. **Observations:** `:AccountObservation` / `:ProspectObservation` nodes, one latest per dimension key (prior one deleted on re-research, but expired ones are kept until replaced — spec §14 "expired observations are not deleted": we keep the node and let *effective confidence* decay; deletion only happens on replacement by fresh research). Evidence stored as `evidenceJson` string property. Timing signals stored as `signalsJson`.
4. **Decay math** (spec §7): `signalValue = confidence × e^(−ageDays/halfLife)`; `dimensionValue = min(Σ signalValues, 1)` (cap = dimension max of 1); `TimingScore = 100 × Σ(weight_d × dimensionValue_d) / Σ weight_d`.
5. **Fit math** (spec §4, §8): `effectiveMatch = matchScore × confidence`; `FitScore = 100 × Σ(weight_i × effectiveMatch_i) / Σ weight_i` over dimensions that have observations.
6. **Freshness decay** (spec §14): if `ageDays > freshnessWindow`, `effectiveConfidence = confidence × e^(−(ageDays − freshnessWindow)/freshnessWindow)`; else `effectiveConfidence = confidence`. Flows into §8 automatically.
7. **Confidence routing** (spec §8): recompute the decision with every dimension of `effectiveConfidence < 0.5` excluded; if the status differs → `REVIEW`.
8. **Research batching:** one Tavily search per lapsed dimension; then ONE synthesis LLM call per entity (account, prospect) that returns all observations (Shape A prose for fit, Shape B `{signal, date, evidence, confidence}` lists for timing, ISO dates only). ONE evaluation LLM call per entity returning all fit matches `{dimensionKey, matchScore, classification, hardExclusionTriggered}`. Timing dimensions never go to the evaluator.
9. **Hard exclusion:** a fit DimensionDefinition may carry `hardExclusionRule` (text). The evaluator returns `hardExclusionTriggered: boolean` per dimension; deterministic gate: any triggered → `HARD_EXCLUDED`.
10. **Orchestrator:** `runQualifyLead(leadId)` becomes: resolve account → load active definitions → determine lapsed dimensions (freshness) → research lapsed only (`runType: leadId-first run = 'full'`, else `'refresh'`) → evaluate matches → compute scores → decide status → persist `:ProspectQualification` + record `:ResearchRun` → `emitProductEventFromContext({name:'lead.qualified', payload:{status, icpScore, personaScore, timingScore}})` → `updateLeadPriorityByScore(leadId, icpScore)`. Full DI (`QualifyLeadDeps`) for tests.
11. **Touch list** (spec §11): `GET /api/outreach/touch-list?limit=N` → QUALIFIED prospects ordered by timingScore desc.
12. **Seeding:** first call to `getDimensionDefinitions()` on an empty graph seeds the spec's example dimensions (§4 ICP five, §5 Persona seven, §6 Timing four) with the spec's weights/half-lives/freshness windows where given, sensible defaults elsewhere.

## File Map

- Create: `products/outreach/domain/qualification.ts` — types + constants
- Create: `products/outreach/domain/scoring.ts` — pure engine
- Create: `products/outreach/data/account-repository.ts`
- Create: `products/outreach/data/dimension-repository.ts` (+ `default-dimensions.ts`)
- Create: `products/outreach/data/qualification-repository.ts` — observations, matches, ProspectQualification, ResearchRun, touch list
- Create: `products/outreach/agent/dimension-research.ts` — Tavily + synthesis (Shapes A/B)
- Create: `products/outreach/agent/match-evaluator.ts` — fit evaluation LLM call
- Rewrite: `products/outreach/agent/qualify-lead.ts` — orchestrator (keep exported names `runQualifyLead`, `QualifyLeadResult`, DI type `QualifyLeadDeps`)
- Modify: `products/outreach/package.json` — subpath exports for new modules
- Create: `apps/outreach/app/api/outreach/touch-list/route.ts`, `apps/outreach/app/api/outreach/dimensions/route.ts` (+ `[id]/route.ts`), `apps/outreach/app/api/outreach/leads/[id]/qualification/route.ts`; re-export shells in `apps/unified`
- Modify: `products/outreach/ui/components/leads/QualificationCard.tsx` — v2
- Modify: `apps/outreach/app/outreach/leads/[id]/page.tsx` — fetch new qualification shape
- Tests: `products/outreach/tests/scoring.test.ts`, `tests/account-repository.test.ts`, `tests/dimension-repository.test.ts`, `tests/qualification-repository.test.ts`, `tests/dimension-research-schema.test.ts`, `tests/qualify-lead.test.ts` (rewrite)

---

### Task 1: Domain types + pure scoring engine (TDD)

**Files:** Create `products/outreach/domain/qualification.ts`, `products/outreach/domain/scoring.ts`, `products/outreach/tests/scoring.test.ts`.

**Produces (exact):**

```ts
// domain/qualification.ts
export type DimensionType = 'fit' | 'timing';
export type DimensionAppliesTo = 'account' | 'prospect';
export interface DimensionDefinition {
  id: string; key: string; name: string;
  dimensionType: DimensionType; appliesTo: DimensionAppliesTo;
  researchInstruction: string; idealValue?: string;
  weight: number; halfLifeDays?: number; freshnessWindowDays: number;
  hardExclusionRule?: string; isActive: boolean;
  createdAt: string; updatedAt?: string;
}
export interface TimingSignal { signal: string; date: string; evidence: string[]; confidence: number }
export interface ObservationRecord {
  id: string; dimensionKey: string; shape: 'prose' | 'signals';
  observedValue?: string; signals?: TimingSignal[];
  evidence: string[]; confidence: number; researchedAt: string; runId: string;
}
export type MatchClassification = 'strong_match' | 'partial_match' | 'weak_match' | 'mismatch';
export interface DimensionMatch {
  dimensionKey: string; matchScore: number; effectiveMatch: number;
  classification: MatchClassification; hardExclusion: boolean; confidence: number;
}
export type QualificationStatus = 'QUALIFIED' | 'UNQUALIFIED' | 'REVIEW' | 'HARD_EXCLUDED' | 'CONTACT_DISCOVERY_REQUIRED';
export interface QualificationThresholds { icpMinimum: number; personaMinimum: number; lowConfidenceCutoff: number }
export const DEFAULT_THRESHOLDS: QualificationThresholds = { icpMinimum: 70, personaMinimum: 65, lowConfidenceCutoff: 0.5 };
export interface ProspectQualificationResult {
  status: QualificationStatus; icpScore: number; personaScore: number; timingScore: number;
  icpMatches: DimensionMatch[]; personaMatches: DimensionMatch[];
  timingBreakdown: Array<{ dimensionKey: string; dimensionValue: number; signalCount: number }>;
  reviewReason?: string; computedAt: string;
}
```

```ts
// domain/scoring.ts (all pure, `now: Date` always injected)
export function ageDays(iso: string, now: Date): number
export function effectiveConfidence(confidence: number, researchedAt: string, freshnessWindowDays: number, now: Date): number
export function signalValue(signal: TimingSignal, halfLifeDays: number, now: Date): number
export function timingDimensionValue(signals: TimingSignal[], halfLifeDays: number, now: Date): number  // min(sum, 1)
export function computeTimingScore(dims: DimensionDefinition[], observations: ObservationRecord[], now: Date): { score: number; breakdown: Array<{dimensionKey; dimensionValue; signalCount}> }
export function computeFitScore(matches: DimensionMatch[], dims: DimensionDefinition[]): number  // weighted, 0–100, 0 if no matches
export function decideStatus(input: { icpScore: number; personaScore: number; hardExcluded: boolean; thresholds: QualificationThresholds }): QualificationStatus  // spec §11 tree
export function applyConfidenceRouting(input: { icpMatches; personaMatches; icpDims; personaDims; hardExcluded; thresholds }): { status: QualificationStatus; reviewReason?: string }
```

**Steps:**

- [ ] **Step 1: Write failing tests** in `tests/scoring.test.ts` covering: decay math (`signalValue` halves at exactly `halfLife` days: `confidence 1, age 45, halfLife 45 → e^-1 ≈ 0.3679`), dimension cap at 1, freshness (fresh obs keeps confidence; obs 2× past window decays by `e^-1`), fit weighting (`effectiveMatch = match × confidence`, weighted mean × 100), decision tree (all five statuses incl. `CONTACT_DISCOVERY_REQUIRED` when ICP ≥ min and Persona < min), confidence routing (a decisive low-confidence dimension flips status → REVIEW with reason; non-decisive low-confidence dim does not).
- [ ] **Step 2:** `pnpm --filter @content-automation/outreach test` → new tests FAIL (module not found).
- [ ] **Step 3:** Implement `qualification.ts` + `scoring.ts` per signatures above. `applyConfidenceRouting`: compute baseline status; recompute icp/persona scores with `<cutoff`-confidence matches removed; if statuses differ → `{status:'REVIEW', reviewReason: 'low-confidence dimension <key> is decisive'}`.
- [ ] **Step 4:** Tests pass. Add exports `./domain/qualification`, `./domain/scoring` to `products/outreach/package.json`.
- [ ] **Step 5:** Commit `feat(outreach): qualification domain types and deterministic scoring engine`.

---

### Task 2: Account + dimension repositories (live-graph TDD)

**Files:** Create `products/outreach/data/account-repository.ts`, `data/dimension-repository.ts`, `data/default-dimensions.ts`, tests `tests/account-repository.test.ts`, `tests/dimension-repository.test.ts`.

**Produces:**

```ts
// account-repository.ts
export function normalizeCompanyName(name: string): string
export async function resolveAccountForLead(lead: { id: string; company?: string }): Promise<{ id: string; name: string } | null>  // MERGE :Account, MERGE (l)-[:BELONGS_TO]->(a); null when no company
export async function getAccountById(id: string): Promise<{ id; name; normalizedName; createdAt } | null>
export async function getAccountLeads(accountId: string): Promise<string[]>  // lead ids

// dimension-repository.ts
export async function getDimensionDefinitions(opts?: { activeOnly?: boolean; seedIfEmpty?: boolean }): Promise<DimensionDefinition[]>
export async function createDimensionDefinition(input: Omit<DimensionDefinition,'id'|'createdAt'|'updatedAt'>): Promise<DimensionDefinition>
export async function updateDimensionDefinition(id: string, patch: Partial<...>): Promise<DimensionDefinition | null>
export async function deleteDimensionDefinition(id: string): Promise<boolean>

// default-dimensions.ts
export const DEFAULT_DIMENSIONS: Array<Omit<DimensionDefinition,'id'|'createdAt'|'updatedAt'>>
```

`DEFAULT_DIMENSIONS` content (spec §4/§5/§6, verbatim instructions/ideals where the spec gives them): account+fit: `internal_ai_capability` (w .25, freshness 120, hardExclusionRule "Currently hiring substantive AI/ML engineering roles"), `internal_engineering_capability` (.15, 180), `operational_scale` (.2, 180), `human_process_intensity` (.2, 180), `economic_capacity` (.2, 120). prospect+fit (weight 1/7 ≈ .14 each, freshness 180): `decision_authority`, `problem_ownership`, `scale_of_responsibility`, `change_mandate`, `budget_proximity`, `external_solution_fit`, `technical_builder_conflict`. account+timing: `hiring_activity` (w .35, halfLife 45, freshness 14), `leadership_public_posts` (.25, 21, 7), `funding_events` (.25, 90, 30), `expansion_signals` (.15, 60, 30).

- [ ] **Step 1:** Failing live-graph tests (copy harness from `tests/persona-repository.test.ts`: FALKORDB env at top, `runWithGraphOrganization`, wipe graph before/after, `closeDriver()` last): account MERGE is idempotent for "Acme Corp"/" acme  corp "; lead gets `BELONGS_TO`; `getDimensionDefinitions({seedIfEmpty:true})` on empty graph returns 16 seeded dims and is idempotent; CRUD round-trip.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (Cypher style of `persona-repository.ts`; JSON-encode nothing here — all scalar props; arrays fine). **Step 4:** Tests pass; add package exports. **Step 5:** Commit `feat(outreach): account resolution and dimension definition repositories`.

---

### Task 3: Observation / match / qualification / research-run repository

**Files:** Create `products/outreach/data/qualification-repository.ts`, test `tests/qualification-repository.test.ts`.

**Produces:**

```ts
export async function upsertObservation(entity: { kind: 'account'|'prospect'; id: string }, obs: Omit<ObservationRecord,'id'>): Promise<ObservationRecord>  // deletes prior obs for same dimensionKey, CREATEs new; label :AccountObservation | :ProspectObservation; rel HAS_OBSERVATION
export async function getObservations(entity: { kind; id }): Promise<ObservationRecord[]>
export async function saveMatches(entity: { kind; id }, matches: DimensionMatch[]): Promise<void>  // replace-all per entity; :DimensionMatch via HAS_MATCH
export async function getMatches(entity: { kind; id }): Promise<DimensionMatch[]>
export async function saveProspectQualification(leadId: string, result: ProspectQualificationResult): Promise<void>  // replace prior :ProspectQualification via HAS_PROSPECT_QUALIFICATION; scores + status scalar, breakdown/matches as JSON string props
export async function getProspectQualification(leadId: string): Promise<ProspectQualificationResult | null>
export async function recordResearchRun(accountId: string, run: { runType: 'full'|'refresh'; refreshedDimensions: string[] }): Promise<void>  // :ResearchRun via HAS_RESEARCH_RUN
export async function hasAnyResearchRun(accountId: string): Promise<boolean>
export async function getTouchList(limit: number): Promise<Array<{ leadId; name; company; icpScore; personaScore; timingScore }>>  // MATCH (l:Lead)-[:HAS_PROSPECT_QUALIFICATION]->(q {status:'QUALIFIED'}) ORDER BY q.timingScore DESC LIMIT $limit
```

`signals`/`evidence`/`breakdown`/`matches` persisted as JSON string properties (pattern: `customAttributes` in lead-repository); numerics coerced on read.

- [ ] **Step 1:** Failing live-graph tests: obs upsert replaces same-key only; prose and signal shapes round-trip exactly; matches replace-all; qualification round-trip (all fields incl. `reviewReason` absent/present); touch list orders by timingScore and filters status. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; package export. **Step 5:** Commit `feat(outreach): observation, match and qualification graph persistence`.

---

### Task 4: Dimension research (Shapes A + B) with DI

**Files:** Create `products/outreach/agent/dimension-research.ts`, test `tests/dimension-research-schema.test.ts`.

**Produces:**

```ts
export interface DimensionResearchDeps {
  search?: typeof searchTavily;                      // default real
  completeJson?: (args: { schemaName: string; schema: z.ZodType; system: string; prompt: string }) => Promise<unknown>;  // default: raw OpenRouter fetch, strict json_schema, release-owned fixed model, temp 0.2
}
export const fitObservationSchema: z.ZodType   // { dimensionKey, observedValue: string, evidence: string[], confidence: 0..1 }
export const timingObservationSchema: z.ZodType // { dimensionKey, signals: [{signal, date: ISO yyyy-mm-dd, evidence: string[], confidence}] }
export function buildDimensionQuery(dim: DimensionDefinition, entity: { name: string; company?: string; title?: string }, now: Date): string
export function buildSynthesisPrompt(dims: DimensionDefinition[], searches: Array<{dimensionKey; results: TavilySearchOutput['results']}>, entity, now: Date): string  // instructs: extract only; NEVER judge recency; every timing signal MUST carry its literal source date; omit undated signals; confidence per observation
export async function researchDimensions(dims: DimensionDefinition[], entity: { kind:'account'|'prospect'; name; company?; title? }, runId: string, now: Date, deps?: DimensionResearchDeps): Promise<Array<Omit<ObservationRecord,'id'>>>
```

`researchDimensions`: one `search()` per dim (maxResults 5, topic `'company'`), then one `completeJson` call returning `{ observations: fitObs[], timingObservations: timingObs[] }`; map to `ObservationRecord` shape (`shape:'prose'|'signals'`, `researchedAt: now.toISOString()`).

- [ ] **Step 1:** Failing tests with stubbed `search`/`completeJson`: fit dims produce prose records, timing dims produce signal records with dates passed through untouched; a timing signal without a date is dropped; prompt text contains each research_instruction and the "do not judge recency" rule; confidence clamped to [0,1]. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; package export. **Step 5:** Commit `feat(outreach): per-dimension research producing prose and signal observations`.

---

### Task 5: Fit match evaluator with DI

**Files:** Create `products/outreach/agent/match-evaluator.ts`, tests added to `tests/dimension-research-schema.test.ts` (same DI style).

**Produces:**

```ts
export const matchEvaluationSchema: z.ZodType  // { matches: [{ dimensionKey, matchScore: 0..1, classification, hardExclusionTriggered: boolean, rationale: string }] }
export function buildEvaluationPrompt(dims: DimensionDefinition[], observations: ObservationRecord[]): string  // per dim: ideal_value, hardExclusionRule if any, observation prose; instructs semantic comparison only, policy stays deterministic
export async function evaluateFitMatches(dims: DimensionDefinition[], observations: ObservationRecord[], now: Date, deps?: { completeJson?: DimensionResearchDeps['completeJson'] }): Promise<DimensionMatch[]>
```

`evaluateFitMatches` combines LLM output with deterministic pieces: `confidence = effectiveConfidence(obs.confidence, obs.researchedAt, dim.freshnessWindowDays, now)`, `effectiveMatch = matchScore × confidence`, `hardExclusion = hardExclusionTriggered && dim.hardExclusionRule != null`. Dims without observations are skipped (not zero-scored).

- [ ] Steps: failing test (stubbed completeJson: effectiveMatch multiplication, freshness-decayed confidence flows in, hardExclusion only honored when the dim defines a rule, missing-observation dims skipped) → FAIL → implement → PASS → commit `feat(outreach): semantic fit match evaluator with confidence propagation`.

---

### Task 6: Orchestrator — rewrite `qualify-lead.ts`

**Files:** Rewrite `products/outreach/agent/qualify-lead.ts`; rewrite `tests/qualify-lead.test.ts`; keep `packages/platform/agents/registry.ts` untouched (same export name).

**Consumes:** everything above. **Produces:**

```ts
export interface QualifyLeadDeps {
  getLeadById; resolveAccountForLead; getDimensionDefinitions; getObservations; upsertObservation;
  researchDimensions; evaluateFitMatches; saveMatches; saveProspectQualification; recordResearchRun;
  hasAnyResearchRun; updateLeadPriorityByScore; now?: () => Date; thresholds?: QualificationThresholds;
}
export interface QualifyLeadResult { status: 'success' | 'skipped'; qualification?: ProspectQualificationResult; reason?: string }
export async function runQualifyLead(leadId: string, deps?: Partial<QualifyLeadDeps>): Promise<QualifyLeadResult>
```

Flow (inside `observeOperation('outreach.lead.qualify', …)`):
1. Load lead; no lead → skipped. Resolve account (null account → persona-only path: personaScore computed, icpScore 0, status `REVIEW`, reason `no company on lead`).
2. `getDimensionDefinitions({activeOnly:true, seedIfEmpty:true})`; split account-fit / account-timing / prospect-fit.
3. For account and prospect separately: lapsed = dims whose latest observation is missing or older than `freshnessWindowDays`. `runType = hasAnyResearchRun(account) ? 'refresh' : 'full'`. Research lapsed dims only; upsert observations; `recordResearchRun`.
4. `evaluateFitMatches` per entity on ALL current fit observations (fresh + retained-stale, freshness handled by effectiveConfidence); `saveMatches`.
5. `computeFitScore` ×2, `computeTimingScore`, `hardExcluded = any match.hardExclusion`, `applyConfidenceRouting` → status.
6. Persist qualification; `updateLeadPriorityByScore(leadId, icpScore)`; emit `lead.qualified` with `{status, icpScore, personaScore, timingScore}` payload; return.

Also: keep legacy exports that other files import — recon showed `qualify/stream/route.ts` imports `streamingScorePersona`; replace the streaming route's run with plain `runQualifyLead(id)` (streaming per-persona scoring no longer exists; `actionStreamResponse` still emits `data-final`). Delete now-unused `scorePersona`/`buildQualificationInstructions`/`getPersonas` usage.

- [ ] **Step 1:** Rewrite `tests/qualify-lead.test.ts` with full DI stubs + recorder (existing style): full-run happy path hits QUALIFIED and emits `lead.qualified` with new payload (assert via `setProductEventSinkForTests`/`drainProductEvents`); refresh run only researches lapsed dims (recorder proves non-lapsed dims skipped); hard-exclusion path; CONTACT_DISCOVERY_REQUIRED path; no-company REVIEW path; timing does not gate (low timing + high fits still QUALIFIED).
- [ ] **Step 2:** FAIL. **Step 3:** Implement; update `qualify/stream/route.ts`. **Step 4:** `pnpm test:outreach` + `pnpm typecheck` green. **Step 5:** Commit `feat(outreach): dimension-based qualification orchestrator behind qualify_lead`.

---

### Task 7: API routes

**Files:** Create `apps/outreach/app/api/outreach/leads/[id]/qualification/route.ts` (GET → `getProspectQualification` + matches + account), `apps/outreach/app/api/outreach/touch-list/route.ts` (GET `?limit=25` → `getTouchList`), `apps/outreach/app/api/outreach/dimensions/route.ts` (GET list / POST create, zod-validated) and `dimensions/[id]/route.ts` (PATCH/DELETE); create matching one-line re-export files under `apps/unified/app/api/outreach/…`. Auth: `getAuthorizationContext(await headers())` gate exactly as `personas/route.ts` does. No billing (reads + config CRUD, no LLM).

- [ ] Steps: implement routes (shape copied from `personas/route.ts`), `pnpm typecheck`, commit `feat(outreach): qualification, touch-list and dimension APIs`.

---

### Task 8: UI — QualificationCard v2

**Files:** Modify `products/outreach/ui/components/leads/QualificationCard.tsx`, `apps/outreach/app/outreach/leads/[id]/page.tsx` (fetch `/api/outreach/leads/${id}/qualification`, pass through; keep `useActionStream` requalify wiring).

Card v2 (design-language §8 compliant, semantic tokens only): status badge (5 statuses with distinct semantic colors — QUALIFIED success, REVIEW warning, HARD_EXCLUDED destructive, CONTACT_DISCOVERY_REQUIRED info, UNQUALIFIED muted), three labeled scores (ICP / Persona / Timing) using existing `ScoreRing`, collapsible per-dimension breakdown (fit: name, effectiveMatch bar, classification; timing: dimensionValue bar, signal count), `reviewReason` line when present, "Fit gates. Timing ranks." caption on the timing score. Falls back to legacy flat-score rendering when only a legacy qualification exists.

- [ ] Steps: implement; `pnpm typecheck`; verify `pnpm test:ui` untouched-green; commit `feat(outreach): qualification card v2 with ICP/persona/timing scores`.

---

### Task 9: Final verification

- [ ] `pnpm test:outreach && pnpm test:platform && pnpm typecheck` all green (platform run guards against registry/type drift).
- [ ] Re-read spec §1–§14 against implementation; fix gaps.
- [ ] Commit any fixes; push per user's merge+push workflow (fetch first).

## Explicitly Deferred (spec marks these "eventually"/later-lifecycle)

Classical ML / lookalike models (§13, §16), feedback fitting (§15), Touchpoint/EngagementState/Opportunity objects (§18 "later lifecycle"), automated weekly cron (refresh runs happen on qualify calls; a scheduler can call the same route later), CONTACT_DISCOVERY prospect auto-search (§10 — status is surfaced; discovery execution deferred).
