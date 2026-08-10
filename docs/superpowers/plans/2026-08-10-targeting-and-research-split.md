# Targeting & Account/Prospect Research Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make Targeting a root workspace surface (ICP + Persona dimension lenses), split research into standalone streaming account-research and prospect-research operations that write scores onto the entities, demote qualification to an instant score-reading decision, and show every finding as raw observation + evidence + match.

**Architecture:** Reuse the existing dimension engine (`domain/scoring.ts`, `dimension-research.ts`, `match-evaluator.ts`, `qualification-repository.ts`). Add `:AccountScore`/`:ProspectScore` graph nodes. Three orchestrators (`runAccountResearch`, `runProspectResearch` rewritten to persona-only, `runQualifyProspect` rewritten to decision-only). Generalized dimension-lane streaming UI. New `/targeting` page. DB is wiped — no migration.

**Tech Stack:** TS ESM, zod, FalkorDB via `getSession()` (openCypher 9), `actionStreamResponse` streaming, `useActionStream`/`@ai-sdk/react`, shadcn primitives, `node --import tsx --test`.

## Global Constraints

- openCypher 9: `localdatetime()` not `datetime()`; no `COUNT{}`/`EXISTS{}`/`CALL{}` subqueries; coerce IntLike with the `toNumber` pattern.
- Every prospect/account API route wrapped in `withProspectOrg`/`withOrgScope` (org isolation); guard test enforces it.
- Design-language.md §8/§10 for all UI: PageHeader, semantic tokens, ListRow/Table/Dialog/Skeleton, sonner toasts, one filled button per view.
- Actions stay org-scoped + billed via `reserveBackgroundAction`; streaming via `actionStreamResponse`.
- Fit gates. Timing ranks. Timing never gates qualification.
- Gate each phase: `pnpm test:outreach` + `pnpm typecheck` green, commit.

## Scoping decisions (locked)

- **v1 = one ICP + one Persona** (the `appliesTo:account` dim set = ICP; `appliesTo:prospect` set = Persona). No `lensId` column yet (additive later).
- **Legacy `ProspectResearch` read-compat kept**: `getProspectResearch` stays returning `null`/empty; consumers in content-generator/atlas/intelligence/mcp are NOT rewired (deferred). We stop *producing* it and remove its UI on the prospect page. Full removal of the type is out of scope.
- **talkingPoints/outreachAngle** leave research; not regenerated in v1 (outreach generator already builds its own prompt).

## File Map

- Modify `products/outreach/data/qualification-repository.ts` — add `saveAccountScore`/`getAccountScore`/`saveProspectScore`/`getProspectScore`; keep `saveProspectQualification` (decision only).
- Modify `products/outreach/data/account-repository.ts` — `getAccountDetail` returns observations+evidence+timing signals; list/detail read `:AccountScore`.
- Create `products/outreach/agent/account-research.ts` — `runAccountResearch`.
- Rewrite `products/outreach/agent/prospect-research.ts` — `runProspectResearch` (persona-only) + `buildProspectResearchInput`; delete old company-research producer.
- Rewrite `products/outreach/agent/qualify-prospect.ts` — decision-only `runQualifyProspect`.
- Modify agent-registration seams: `contracts.ts`, `action-catalog.json`, `registry.ts`, `payloads.ts`, `auth/commercial.ts`, `capabilities/operation-service.ts`, `capabilities/catalog.ts`, `mcp/operations.ts` — add `research_account`.
- Create streaming routes: `apps/outreach/app/api/outreach/accounts/[id]/research/stream/route.ts`, rewrite `.../prospects/[id]/research/stream/route.ts` shape; unified re-exports.
- Create `products/outreach/ui/components/research/DimensionResearchSurface.tsx` + `ResearchTrigger.tsx` (generalized; replace ResearchMastra/ResearchLiveSurface use).
- Create `apps/outreach/app/targeting/page.tsx` (+ unified re-export) + `products/outreach/ui/components/targeting/*` (dimension list + editor dialog).
- Modify `apps/outreach/app/outreach/accounts/[id]/page.tsx` — dimension want→found→match display + Research account.
- Modify `apps/outreach/app/outreach/prospects/[id]/page.tsx` — persona dimension display + Research prospect; drop ProspectResearch UI.
- Nav: `apps/unified/components/unified-sidebar.tsx`, `apps/outreach/components/product-sidebar.tsx` — add Targeting root, remove Personas root/page.
- Tests: extend `tests/account-repository.test.ts`, `tests/qualification-repository.test.ts`; new `tests/account-research.test.ts`, `tests/qualify-prospect.test.ts` (rewrite), `tests/prospect-research.test.ts`.

---

### Phase 1 — Entity scores in the graph

**Files:** Modify `products/outreach/data/qualification-repository.ts`; test `tests/qualification-repository.test.ts`.

**Produces:**
```ts
export interface AccountScoreRecord { icpScore: number; timingScore: number; hardExcluded: boolean; reviewReason?: string; timingBreakdown: TimingDimensionBreakdown[]; computedAt: string }
export interface ProspectScoreRecord { personaScore: number; hardExcluded: boolean; reviewReason?: string; computedAt: string }
export async function saveAccountScore(accountId: string, score: AccountScoreRecord): Promise<void>   // replace :AccountScore via HAS_SCORE
export async function getAccountScore(accountId: string): Promise<AccountScoreRecord | null>
export async function saveProspectScore(prospectId: string, score: ProspectScoreRecord): Promise<void> // replace :ProspectScore via HAS_SCORE
export async function getProspectScore(prospectId: string): Promise<ProspectScoreRecord | null>
```
Scalars stored as props; `timingBreakdown` as `timingBreakdownJson`. Replace-on-write (DETACH DELETE prior, CREATE new).

- [ ] Failing live-graph tests: account score round-trips incl timingBreakdown; prospect score round-trips; replace-on-write keeps one node. → FAIL → implement (Cypher mirrors `saveProspectQualification`) → PASS → package export already covers repo → commit `feat(outreach): account and prospect score nodes`.

### Phase 2 — Account research orchestrator

**Files:** Create `products/outreach/agent/account-research.ts`; test `tests/account-research.test.ts`.

**Consumes:** `getDimensionDefinitions`, `getObservations`, `upsertObservation`, `researchDimensions`, `evaluateFitMatches`, `saveMatches`, `computeFitScore`, `computeTimingScore`, `applyConfidenceRouting`, `recordResearchRun`, `hasAnyResearchRun`, `saveAccountScore`, `getAccountById`.

**Produces:**
```ts
export interface AccountResearchDeps { /* all above, injectable */ now: () => Date; thresholds: QualificationThresholds; onDimension?: (part: DimensionProgress) => void }
export interface DimensionProgress { dimensionKey: string; name: string; type: 'fit'|'timing'; phase: 'searching'|'found'|'matched'; observedValue?: string; signals?: TimingSignal[]; evidence?: string[]; matchScore?: number; classification?: string }
export interface AccountResearchResult { icpScore: number; timingScore: number; hardExcluded: boolean; icpMatches: DimensionMatch[]; timingBreakdown: TimingDimensionBreakdown[] }
export async function runAccountResearch(accountId: string, deps?: Partial<AccountResearchDeps>): Promise<AccountResearchResult>
export function streamingDimensionProgress(emit: StreamEmit): (p: DimensionProgress) => void  // emits data-dimension-progress
```
Flow: load active account dims (fit+timing, seedIfEmpty) → lapsed-only (freshness) → `researchDimensions(kind:'account')` → upsert + `onDimension('found')` per dim → `evaluateFitMatches` (fit) + `computeTimingScore` (timing) → `onDimension('matched')` → `saveMatches({kind:'account'})` → `saveAccountScore` → `recordResearchRun` → emit `data-final`.

- [ ] Failing DI test: full run researches all account dims, writes AccountScore (icp=weighted fit, timing from signals), emits per-dim progress; refresh run only researches lapsed. → FAIL → implement → PASS → export in package.json → commit `feat(outreach): account research operation`.

### Phase 3 — Prospect research (persona-only) + qualification decision

**Files:** Rewrite `products/outreach/agent/prospect-research.ts` (persona research) and `products/outreach/agent/qualify-prospect.ts` (decision); tests `tests/prospect-research.test.ts`, rewrite `tests/qualify-prospect.test.ts`. Add `getProspectResearch` legacy stub returning `null`.

**Produces:**
```ts
// prospect-research.ts
export async function runProspectResearch(prospectId: string, deps?: Partial<ProspectResearchDeps>): Promise<{ personaScore: number; hardExcluded: boolean; matches: DimensionMatch[] }>
export function buildProspectResearchInput(prospect: Prospect): { id: string; name: string; company?: string; title?: string }
export async function getProspectResearch(_prospectId: string): Promise<null>  // legacy read-compat, always null
// qualify-prospect.ts
export async function runQualifyProspect(prospectId: string, deps?: Partial<QualifyProspectDeps>): Promise<QualifyProspectResult>  // reads scores only
```
`runProspectResearch`: persona dims → observations → matches → `saveProspectScore(personaScore, hardExcluded)` → `runQualifyProspect`. `runQualifyProspect`: load prospect → account via `resolveAccountForProspect` → `getAccountScore` + `getProspectScore` → `applyConfidenceRouting`/`decideStatus` → `saveProspectQualification` → `updateProspectPriorityByScore(icp)` → emit `prospect.qualified`. No LLM, no research.

- [ ] Failing DI tests: persona research writes ProspectScore + chains qualify; qualify-decision reads AccountScore+ProspectScore → QUALIFIED/CONTACT_DISCOVERY_REQUIRED/REVIEW/HARD_EXCLUDED, emits event, no research fn called; no company → REVIEW; timing never gates. → FAIL → implement → PASS → commit `feat(outreach): persona-only prospect research and decision-only qualification`.

### Phase 4 — Action registration (`research_account`) + registry rewiring

**Files:** `packages/platform/agents/{contracts,payloads,action-catalog.json,registry}.ts`, `packages/auth/commercial.ts`, `packages/capabilities/{operation-service,catalog}.ts`, `packages/mcp/operations.ts`.

Add `research_account` everywhere `research_prospect` appears (union, catalog list+runtime, payload `{ account_id }`, pricing `{credits:80,capability:'outreach'}`, operation-service action/pricing/registryBacked, catalog operation `outreach.account.research` path `/outreach/operations/account-research` schema `{accountId}`, MCP). Registry: `research_account: async (p) => runAccountResearch(p.accountId)`, `research_prospect: async (p) => runProspectResearch(p.prospectId)`, `qualify_prospect` unchanged name. Gate: `pnpm test:platform` + `pnpm test:capabilities` + typecheck. Commit `feat(platform): register research_account action`.

### Phase 5 — Streaming routes + generalized dimension research UI

**Files:** Create `apps/outreach/app/api/outreach/accounts/[id]/research/stream/route.ts`; rewrite `apps/outreach/app/api/outreach/prospects/[id]/research/stream/route.ts`; unified re-exports. Create `products/outreach/ui/components/research/DimensionResearchSurface.tsx` + `ResearchTrigger.tsx`.

Routes: `reserveBackgroundAction(request,'research_account'|'research_prospect')` then `actionStreamResponse({ action, entityId:id, entityType, commercial, estimatedCredits, run:(emit)=>runWithGraphOrganization(org, ()=>runAccountResearch(id,{onDimension:streamingDimensionProgress(emit)})) })`. `ResearchTrigger` (client): `useActionStream` posting to the stream route, `start()`, exposes `dataParts` (dimension progress) + `isStreaming` + `final`. `DimensionResearchSurface`: renders one lane per dimension from the progress parts (name, LiveDot while searching, observation/signals + evidence when found, ScoreRing/bar when matched); on `final`, calls `onComplete` to refetch. Gate typecheck + manual browser. Commit `feat(outreach): dimension-lane streaming research surface`.

### Phase 6 — Targeting page + nav

**Files:** Create `apps/outreach/app/targeting/page.tsx` + unified re-export; `products/outreach/ui/components/targeting/{TargetingPageClient,DimensionEditorDialog}.tsx`. Nav: `unified-sidebar.tsx` (root `Targeting` replacing `Personas`), `product-sidebar.tsx`. Remove `/outreach/personas` page + root Personas nav.

Targeting page: `PageHeader` + `Tabs` (ICP / Persona). Each tab = ListRow list of that lens's dimensions (filter `appliesTo`), `+ Add dimension` opening `DimensionEditorDialog` (fields: name, type fit/timing [timing only ICP], research instruction, ideal value [fit], weight, freshness, half-life [timing], hard exclusion [fit]). CRUD via `/api/outreach/dimensions` (exists) — but that API currently returns account+prospect mixed; add `?appliesTo=` filter and org-scope check. Empty state offers seed defaults. Gate typecheck + browser. Commit `feat(targeting): root Targeting page with ICP and Persona dimension editors`.

### Phase 7 — Account & prospect page displays

**Files:** Modify `apps/outreach/app/outreach/accounts/[id]/page.tsx`, `products/outreach/ui/components/prospects/AccountProspectsSection.tsx` (Research account button + surface), `apps/outreach/app/outreach/prospects/[id]/page.tsx`. Extend `getAccountDetail` (Phase 1 repo) to include `icpObservations`/`timingSignals` per dimension.

Account page: Research account button (ResearchTrigger, entityType 'account') + DimensionResearchSurface; per fit dimension a card row (ideal value → observation prose + evidence links → match bar+classification); timing dims as dated signal timeline. Prospect page: per persona dimension (ideal→observation+evidence→match), persona score ring, qualification status, compact "company context" card linking to account; Research prospect via ResearchTrigger; remove old ResearchSection/ResearchMastra/ResearchLiveSurface usage. Gate typecheck + browser proof. Commit `feat(outreach): want/found/match research display on account and prospect pages`.

### Phase 8 — Remove legacy producers + verify + wipe

**Files:** Delete `apps/outreach/app/api/outreach/research/route.ts`, old company-research bits in `prospect-research-agent.ts`, `prospectResearchSchema` producer, `research-mastra.tsx`/`ResearchLiveSurface.tsx`/`ResearchSection.tsx` (replaced). Remove root Personas nav + `persona-repository` usage from Targeting-covered paths (keep repo file if other products import; else delete). Keep `getProspectResearch` stub.

- [ ] `grep` no remaining imports of deleted modules; full `pnpm test`, `pnpm typecheck`, architecture guards green; extend tenant-scope guard to account research stream + targeting routes; dev DB wipe per org graph (`MATCH (n) DETACH DELETE n`) + re-seed dimensions; browser smoke: Targeting edit → Research account (stream) → account shows observations → add prospect → Research prospect → qualify. Push. Commit `chore(outreach): remove legacy prospect company-research producers`.

## Self-review notes

- Spec §2 Targeting/lenses → Phase 6. §3 data model → Phase 1. §6 research ops → Phases 2-3. §7 display → Phase 7. §8 qualification decision → Phase 3. §4 nav → Phase 6. Deletions §3 → Phase 8. Streaming UI generalization → Phase 5. Registration → Phase 4. All covered.
- Legacy consumer ripple deliberately bounded by the `getProspectResearch`→null compat (scoping decision), documented.
