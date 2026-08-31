# Resonance Embedding-Space Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the steered-Qwen Modal GPU scorer with an in-process embedding-space audience simulation grounded in real graph anchors, with no LLM in the serving path.

**Architecture:** A pure deterministic simulation engine (`packages/resonance/engine/`) samples audience vectors from a mixture fitted over embeddings of real workspace artifacts and scores creatives via a frame-conditioned similarity readout. A new `EngineTrigger` computes runs synchronously inside the existing `ResonanceTrigger` seam, so the job/credits/knowledge lifecycle in `server/runs.ts` is untouched. The Modal worker, HMAC plumbing, and per-cell pricing are removed.

**Tech Stack:** TypeScript, zod, OpenAI `text-embedding-3-small` REST API, FalkorDB via `getSession()`, node test runner (`node --import tsx --test`).

**Spec:** `docs/superpowers/specs/2026-08-31-resonance-embedding-simulation-redesign.md` (roadmap: `packages/resonance/ROADMAP.md`)

## Global Constraints

- Pricing: flat `1` credit per run; `estimateRun` is the single pricing authority and settlement must use the same constant.
- `MAX_COMPUTED_CELLS = 200_000`; audience draws `m = clamp(⌊cap / (creatives × frames)⌋, 500, audienceSize)`.
- Determinism: same seed ⇒ byte-identical `RunResult`. One audience draw set per run, reused for every creative/frame (paired design). No `Date.now()`/`Math.random()` in the engine.
- Scales: `score`, `ci95`, `perFrame` all 0–100 (`domain/result-contract.json` invariants, including: single-frame run's `perFrame` equals `score` within rounding; unscoreable creative gets `insufficientData: true` + `score: null`, never omitted, never 0).
- New optional `RunResult` fields are additive only: `audienceGrounding?: 'graph' | 'default'`, `computedAudienceSize?: number`.
- No LLM calls anywhere in the serving path; the only external call is the batched embeddings request.
- Run all resonance tests with: `pnpm --filter @content-automation/resonance test` (package uses node test runner, `tests/*.test.ts`). Typecheck: `pnpm --filter @content-automation/resonance typecheck`.

## File Structure

```
packages/platform/resonance/
  types.ts        (modify: additive RunResult fields)
  payload.ts      (modify: RESONANCE_RUN_CREDITS, estimateRun, schema additions)
packages/resonance/
  engine/random.ts          (create: mulberry32 PRNG + gaussian)
  engine/vector.ts          (create: dot/normalize/cosine)
  engine/simulation.ts      (create: runSimulation — the pure core)
  engine/frames.ts          (create: closed frame×surface query templates)
  engine/embeddings.ts      (create: OpenAI embed client + usd cost)
  engine/anchors.ts         (create: graph anchor fetch + default fallback + cache)
  trigger/index.ts          (create: ResonanceTrigger, StubTrigger, resolveTrigger)
  trigger/engine-trigger.ts (create: EngineTrigger)
  trigger/modal-trigger.ts  (delete)
  webhook-security.ts       (delete)
  server/runs.ts            (modify: trigger import, ctx pass-through, settle credits, drop ResultGone)
  package.json              (modify: "./trigger" export → trigger/index.ts)
  tests/engine-random.test.ts, engine-simulation.test.ts, engine-frames.test.ts,
        engine-anchors.test.ts, engine-trigger.test.ts   (create)
  tests/trigger.test.ts, webhook-security.test.ts        (delete)
  tests/server.test.ts, audience-slider.test.ts, result-contract.test.ts (modify)
services/resonance/         (delete everything except a new README.md)
scripts/validate-production-env.mjs  (modify)
.env.example                (modify)
CLAUDE.md                   (modify: Audience Resonance section)
```

---

### Task 1: Flat 1-credit pricing

**Files:**
- Modify: `packages/platform/resonance/payload.ts:36-39`
- Modify: `packages/resonance/server/runs.ts:784` (settle `actualCredits`)
- Test: `packages/resonance/tests/audience-slider.test.ts`, `packages/resonance/tests/server.test.ts`, `packages/resonance/tests/payload.test.ts`

**Interfaces:**
- Produces: `export const RESONANCE_RUN_CREDITS = 1` from `@content-automation/platform/resonance/payload` (re-exported via `packages/resonance/domain/payload.ts`). `estimateRun(run)` now returns `{ cells, credits: RESONANCE_RUN_CREDITS }`.

- [ ] **Step 1: Update pricing tests to the flat model.** In `tests/payload.test.ts` find assertions on `estimateRun(...).credits` (`grep -n "credits" tests/payload.test.ts tests/audience-slider.test.ts tests/server.test.ts`) and change expected values to `1`. In `server.test.ts`, settlement assertions expect `actualCredits: Math.max(1, Math.ceil(cellsDone / 1000))` — change to `actualCredits: 1`. Add one new test:

```ts
test('estimateRun charges a flat credit regardless of cells', () => {
  const run = parseRunRequest({
    creatives: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }],
    audienceSize: 2_000_000,
    frames: ['scroll_stop', 'click'],
  })
  assert.equal(estimateRun(run).credits, 1)
})
```

- [ ] **Step 2: Run to verify failures.** `pnpm --filter @content-automation/resonance test` — expect the edited assertions to FAIL against current per-cell pricing.

- [ ] **Step 3: Implement.** In `packages/platform/resonance/payload.ts`:

```ts
/**
 * Flat per-run price (spec 2026-08-31 §3.3): the real cost is one batched
 * embeddings call, so per-cell GPU pricing no longer reflects anything.
 * Settlement (`server/runs.ts`) uses this same constant — reserve and settle
 * cannot disagree.
 */
export const RESONANCE_RUN_CREDITS = 1

export function estimateRun(run: RunRequest): RunEstimate {
  const cells = run.creatives.length * run.frames.length * run.audienceSize
  return { cells, credits: RESONANCE_RUN_CREDITS }
}
```

In `server/runs.ts`, import `RESONANCE_RUN_CREDITS` from `'../domain/payload'` and change the settle call's `actualCredits: Math.max(1, Math.ceil(payload.cellsDone / 1000))` to `actualCredits: RESONANCE_RUN_CREDITS`.

- [ ] **Step 4: Run tests + typecheck; expect PASS.** `pnpm --filter @content-automation/resonance test && pnpm --filter @content-automation/resonance typecheck`

- [ ] **Step 5: Commit.** `git commit -m "feat(resonance): flat 1-credit run pricing"`

---

### Task 2: Additive RunResult fields

**Files:**
- Modify: `packages/platform/resonance/types.ts` (RunResult), `packages/platform/resonance/payload.ts` (runResultSchema)
- Test: `packages/resonance/tests/payload.test.ts`

**Interfaces:**
- Produces: `RunResult.audienceGrounding?: 'graph' | 'default'`, `RunResult.computedAudienceSize?: number` — consumed by Tasks 4 and 7.

- [ ] **Step 1: Failing test** in `payload.test.ts`: build a minimal valid modal-result body (copy an existing fixture in that file), add `audienceGrounding: 'graph'` and `computedAudienceSize: 500` inside `result`, and assert `parseModalResult(body).result?.audienceGrounding === 'graph'` and `.computedAudienceSize === 500`. Run; expect FAIL (zod strips unknown keys, so the parsed value is `undefined`).

- [ ] **Step 2: Implement.** In `types.ts`, add to `RunResult`:

```ts
  /** Whether the audience was fitted from real graph anchors or fell back to default descriptors. */
  audienceGrounding?: 'graph' | 'default'
  /** The Monte Carlo audience draws actually computed (≤ audienceSize) — see spec §3.1. */
  computedAudienceSize?: number
```

In `payload.ts` `runResultSchema`, add:

```ts
  audienceGrounding: z.enum(['graph', 'default']).optional(),
  computedAudienceSize: z.number().int().min(0).optional(),
```

- [ ] **Step 3: Run tests + typecheck; expect PASS. Commit** `feat(resonance): additive audienceGrounding/computedAudienceSize result fields`

---

### Task 3: Engine primitives — PRNG and vectors

**Files:**
- Create: `packages/resonance/engine/random.ts`, `packages/resonance/engine/vector.ts`
- Test: `packages/resonance/tests/engine-random.test.ts`

**Interfaces:**
- Produces: `mulberry32(seed: number): () => number`; `gaussian(rand: () => number): number`; `dot(a: number[], b: number[]): number`; `normalize(v: number[]): number[]`.

- [ ] **Step 1: Failing tests:**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32, gaussian } from '../engine/random'
import { dot, normalize } from '../engine/vector'

test('mulberry32 is deterministic per seed and uniform-ish', () => {
  const a = mulberry32(42); const b = mulberry32(42); const c = mulberry32(7)
  const seqA = Array.from({ length: 5 }, () => a())
  assert.deepEqual(seqA, Array.from({ length: 5 }, () => b()))
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, () => c()))
  for (const value of seqA) assert.ok(value >= 0 && value < 1)
})

test('gaussian has ~zero mean and ~unit variance over many draws', () => {
  const rand = mulberry32(1)
  const draws = Array.from({ length: 20_000 }, () => gaussian(rand))
  const mean = draws.reduce((s, x) => s + x, 0) / draws.length
  const variance = draws.reduce((s, x) => s + (x - mean) ** 2, 0) / draws.length
  assert.ok(Math.abs(mean) < 0.03)
  assert.ok(Math.abs(variance - 1) < 0.05)
})

test('normalize returns a unit vector and dot of identical unit vectors is 1', () => {
  const unit = normalize([3, 4])
  assert.ok(Math.abs(dot(unit, unit) - 1) < 1e-9)
})
```

- [ ] **Step 2: Run; expect FAIL (modules missing).**

- [ ] **Step 3: Implement `engine/random.ts`:**

```ts
/**
 * Deterministic PRNG for the simulation engine. mulberry32: tiny, fast, and
 * good enough for Monte Carlo audience draws — the engine's determinism
 * contract (same seed ⇒ identical RunResult) rules out Math.random().
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One standard-normal draw (Box–Muller; discards the pair's second value). */
export function gaussian(rand: () => number): number {
  let u = 0
  while (u === 0) u = rand()
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
```

`engine/vector.ts`:

```ts
export function dot(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

export function normalize(v: number[]): number[] {
  const magnitude = Math.sqrt(dot(v, v))
  if (magnitude === 0) return v.slice()
  return v.map((x) => x / magnitude)
}
```

- [ ] **Step 4: Run tests; expect PASS. Commit** `feat(resonance): deterministic engine primitives`

---

### Task 4: The pure simulation core

**Files:**
- Create: `packages/resonance/engine/simulation.ts`
- Test: `packages/resonance/tests/engine-simulation.test.ts`
- Modify: `packages/resonance/tests/result-contract.test.ts` (add engine producer)

**Interfaces:**
- Consumes: Task 3 primitives; `RunRequest`/`RunResult` from `../domain/types`.
- Produces:

```ts
export interface AudienceAnchor { vector: number[]; weight: number }
export type AudienceGrounding = 'graph' | 'default'
export interface SimulationInput {
  run: RunRequest
  anchors: AudienceAnchor[]
  /** [creativeIndex][frameIndex]; null ⇒ that embedding failed. */
  creativeFrameVectors: (number[] | null)[][]
  grounding: AudienceGrounding
  usdCost: number
}
export const MAX_COMPUTED_CELLS = 200_000
export const KERNEL_SIGMA = 0.15
export const READOUT_MU = 0.35
export const READOUT_TAU = 0.08
export const ENGINE_MODEL_LABEL = 'text-embedding-3-small+similarity-v1'
export function computedAudienceDraws(run: RunRequest): number
export function runSimulation(input: SimulationInput): RunResult
```

**Semantics (implement exactly):**
- `computedAudienceDraws`: `Math.min(run.audienceSize, Math.max(500, Math.floor(MAX_COMPUTED_CELLS / (run.creatives.length * run.frames.length))))`.
- Sample `m` audience vectors ONCE from `mulberry32(run.seed)`: pick an anchor by cumulative normalized weight, add `KERNEL_SIGMA * gaussian(rand)` per dimension, `normalize`. Reuse for every creative/frame.
- Per cell: `pYes = 1 / (1 + Math.exp(-(dot(frameVec, audienceVec) - READOUT_MU) / READOUT_TAU))` where `frameVec` is the normalized creative-frame vector.
- A creative with ANY null frame vector: `insufficientData: true`, `score: null`, `ci95: null`, `perFrame: {}` — excluded from winner ranking and from `cellsDone`.
- Per scored creative: per-member score = mean of `pYes` across frames for that member; `score = round1(mean(memberScores) * 100)`; `ci95 = [round1((mean − 1.96·sd/√m)·100), round1((mean + 1.96·sd/√m)·100)]` clamped to [0, 100] (`sd` = sample standard deviation of memberScores); `perFrame[frame] = round1(mean(pYes over members) * 100)`. `round1` = one decimal (`Math.round(x * 10) / 10`).
- `winner`: rank scored creatives by `score` desc; `margin = round1(top − runnerUp)` (0 with <2 scored); `tooCloseToCall = scoredCount >= 2 && top.ci95[0] <= runnerUp.ci95[1]`, and `true` with `creativeId: null` when nothing scored.
- `voteSnapshot`: `tallies` for every scored creative × frame, `up = Math.round(run.audienceSize * perFrameFraction)` (`perFrameFraction` = the pre-scaling 0–1 mean), `down = audienceSize − up`; `recent` = first cells in (creative, frame, member) iteration order, max 24, `vote = pYes >= 0.5 ? 'up' : 'down'`, `id = `${creativeId}:${frame}:${memberIndex + 1}``, `yesProbability` rounded to 4 decimals; `sequence = tallies.length`.
- `cellsDone = m * run.frames.length * scoredCreativesCount`.
- Result: `{ scores, winner, audienceSize: run.audienceSize, cellsDone, model: ENGINE_MODEL_LABEL, gpuSeconds: 0, usdCost, voteSnapshot, audienceGrounding: grounding, computedAudienceSize: m }` plus, when any creative is `insufficientData`, `partial: true` and `degradedReason: 'Creatives <ids> could not be scored (embedding unavailable).'`.

- [ ] **Step 1: Failing tests** in `tests/engine-simulation.test.ts`. Build helpers: `vecTowards(target: number[], closeness: number)` etc. Real tests to write (all with small dims, e.g. 8):

```ts
function makeRun(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    creatives: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }],
    audienceSize: 1000,
    frames: ['scroll_stop', 'click'],
    surface: 'generic',
    seed: 7,
    ...overrides,
  }
}
const anchor = (v: number[]) => ({ vector: v, weight: 1 })

test('same seed produces an identical result; different seed does not', ...)
  // runSimulation twice with identical input → assert.deepEqual;
  // change run.seed → winner scores differ in at least one decimal.

test('a creative aligned with the anchors beats an orthogonal one', ...)
  // anchors along e1; creative a frames = e1, creative b frames = e2 (orthogonal).
  // assert winner.creativeId === 'a' and scores[a] > scores[b].

test('single-frame run has perFrame equal to score (contract invariant)', ...)

test('null frame vector ⇒ insufficientData, partial, excluded from winner', ...)
  // creativeFrameVectors[1] = [null, e1]; assert scores[1].insufficientData === true,
  // score null, result.partial === true, degradedReason mentions 'b',
  // winner.creativeId === 'a', cellsDone === m * frames * 1.

test('no scorable creative ⇒ winner.creativeId null, tooCloseToCall true', ...)

test('computedAudienceDraws clamps: floor(cap/cells), min 500, ≤ audienceSize', () => {
  assert.equal(computedAudienceDraws(makeRun({ audienceSize: 100 })), 100)
  assert.equal(computedAudienceDraws(makeRun({ audienceSize: 2_000_000 })), 50_000) // 200k / (2×2)
  const big = makeRun({
    audienceSize: 2_000_000,
    creatives: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, text: 'x' })),
    frames: ['scroll_stop', 'click', 'share', 'compelling'],
  })
  assert.equal(computedAudienceDraws(big), 2500) // 200k / 80
})

test('tallies scale to audienceSize and recent is bounded at 24', ...)
  // audienceSize 100_000: assert each tally.up + tally.down === 100_000,
  // recent.length <= 24, sequence === tallies.length.

test('result carries grounding, computedAudienceSize, model label, zero gpuSeconds', ...)
```

- [ ] **Step 2: Run; expect FAIL.**

- [ ] **Step 3: Implement `engine/simulation.ts`** per the semantics block above (~150 lines). Doc-comment the heuristic constants: `KERNEL_SIGMA`/`READOUT_MU`/`READOUT_TAU` are v1 heuristics replaced by the v2 trained model (ROADMAP).

- [ ] **Step 4: Run; expect PASS.**

- [ ] **Step 5: Add the engine to the contract suite.** In `tests/result-contract.test.ts`, mirror the existing StubTrigger assertions with a `runSimulation` producer: single-frame perFrame === score; all values within `scoreScale`; insufficientData creative present with nulls. Also update `domain/result-contract.json`'s `$comment`: the second producer is now `engine/simulation.ts` (test `engine-simulation`/`result-contract`), the Python producer is retired.

- [ ] **Step 6: Run tests + typecheck; expect PASS. Commit** `feat(resonance): pure embedding-space simulation core`

---

### Task 5: Frame templates and embedding client

**Files:**
- Create: `packages/resonance/engine/frames.ts`, `packages/resonance/engine/embeddings.ts`
- Test: `packages/resonance/tests/engine-frames.test.ts`

**Interfaces:**
- Produces: `frameQuery(frame: ResonanceFrame, surface: ResonanceSurface, text: string): string`; `type EmbedFn = (texts: string[]) => Promise<number[][]>`; `defaultEmbed: EmbedFn` (OpenAI, throws without `OPENAI_API_KEY`); `embeddingUsdCost(texts: string[]): number`.

- [ ] **Step 1: Failing tests:**

```ts
test('frameQuery is closed and total: every frame × surface yields a distinct non-empty query embedding the creative text', () => {
  const seen = new Set<string>()
  for (const frame of RESONANCE_FRAMES) for (const surface of RESONANCE_SURFACES) {
    const query = frameQuery(frame, surface, 'CREATIVE-TEXT')
    assert.ok(query.includes('CREATIVE-TEXT'))
    assert.ok(!seen.has(query)); seen.add(query)
  }
})

test('embeddingUsdCost estimates from character count at text-embedding-3-small pricing', () => {
  // 4 chars ≈ 1 token; $0.02 per 1M tokens
  assert.ok(Math.abs(embeddingUsdCost(['x'.repeat(4_000_000)]) - 0.02) < 1e-9)
})
```

- [ ] **Step 2: Run; expect FAIL.**

- [ ] **Step 3: Implement.** `engine/frames.ts`:

```ts
import type { ResonanceFrame, ResonanceSurface } from '../domain/types'

/**
 * Closed frame×surface templates (spec §2.2): the query text a creative is
 * embedded under. Customers never supply scoring instructions — the same
 * closed-profile principle the GPU worker's frame prompts followed. v1
 * heuristic; v2's trained response model learns frames instead.
 */
const FRAME_QUESTIONS: Record<ResonanceFrame, string> = {
  scroll_stop: 'Content that makes this audience stop scrolling and pay attention',
  click: 'Content this audience would click through to see more of',
  share: 'Content this audience would share with their network',
  compelling: 'Content this audience finds compelling and persuasive',
}

const SURFACE_LABELS: Record<ResonanceSurface, string> = {
  generic: 'content',
  youtube_video: 'a YouTube video',
  blog_article: 'a blog article',
  x_post: 'an X post',
  x_thread: 'an X thread',
  linkedin_post: 'a LinkedIn post',
  social_post: 'a social media post',
  ad_campaign: 'an ad',
}

export function frameQuery(frame: ResonanceFrame, surface: ResonanceSurface, text: string): string {
  return `${FRAME_QUESTIONS[frame]}, presented as ${SURFACE_LABELS[surface]}:\n\n${text}`
}
```

`engine/embeddings.ts` (mirror the inline REST pattern of `products/content-generator/agent/actions/topics.ts:213-247`, including its `observeWorkflowStep` wrapper shape):

```ts
import { observeWorkflowStep } from '@content-automation/observability'

export type EmbedFn = (texts: string[]) => Promise<number[][]>

export const EMBEDDING_MODEL = 'text-embedding-3-small'
const USD_PER_TOKEN = 0.02 / 1_000_000

/** Rough cost estimate (4 chars ≈ 1 token) reported as RunResult.usdCost. */
export function embeddingUsdCost(texts: string[]): number {
  const chars = texts.reduce((sum, text) => sum + text.length, 0)
  return (chars / 4) * USD_PER_TOKEN
}

export const defaultEmbed: EmbedFn = async (texts) => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured — resonance live mode needs embeddings')
  return observeWorkflowStep('resonance.embed', {
    kind: 'embedding',
    processInputs: () => ({ model: EMBEDDING_MODEL, count: texts.length }),
  }, async () => {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
    })
    if (!response.ok) {
      throw new Error(`OpenAI embeddings error: ${response.status} - ${await response.text()}`)
    }
    const data = (await response.json()) as { data: Array<{ embedding: number[] }> }
    return data.data.map((row) => row.embedding)
  })
}
```

(Check `observeWorkflowStep`'s exact option names against `topics.ts` before writing; match whatever it actually uses.)

- [ ] **Step 4: Run tests + typecheck; expect PASS. Commit** `feat(resonance): frame templates and embedding client`

---

### Task 6: Graph anchors with default fallback

**Files:**
- Create: `packages/resonance/engine/anchors.ts`
- Test: `packages/resonance/tests/engine-anchors.test.ts`

**Interfaces:**
- Consumes: `getSession` from `@content-automation/platform/data/graph` (injectable).
- Produces:

```ts
export interface WeightedText { text: string; weight: number }
export interface AnchorTexts { texts: WeightedText[]; grounding: 'graph' | 'default' }
export interface AnchorDeps { getSession: (organizationId?: string) => Promise<GraphSessionLike> }
export async function fetchAnchorTexts(
  organizationId: string | undefined,
  surface: ResonanceSurface,
  deps?: AnchorDeps,
): Promise<AnchorTexts>
export function clearAnchorCache(): void
```

**Semantics:** Three read queries in one session (close it in `finally`):

```cypher
MATCH (d:ContentDraft {status: 'published'})
RETURN d.title AS title, d.performanceLevel AS level, d.performanceInsights AS insights
LIMIT 200
```
weight: `high` → 4, `medium` → 2, otherwise 1; text = `title` + (insights ? ` — ${insights}` : '').

```cypher
MATCH (p:Persona {isActive: true})
RETURN p.name AS name, p.description AS description, p.targetTitles AS titles, p.signals AS signals
LIMIT 50
```
weight 3; text = `${name}: ${description}. Titles: ${titles.join(', ')}. Signals: ${signals.join(', ')}` (null-tolerant — skip missing parts).

```cypher
MATCH (t:Topic) RETURN t.name AS name LIMIT 100
```
weight 1.

Rows with empty text are dropped. If the combined list is empty OR any query throws (log via `createLogger('resonance.anchors')`, never rethrow): return the default descriptors, grounding `'default'`:

```ts
const DEFAULT_DESCRIPTORS = [
  'A professional who follows industry trends and shares useful insights with peers',
  'A busy practitioner who engages with concrete, actionable content',
  'A technical decision-maker evaluating tools and approaches',
  'A curious generalist who rewards clear explanations of complex topics',
]
// each suffixed with `, who regularly engages with ${SURFACE_LABELS[surface]}`
```

(export `SURFACE_LABELS` from `engine/frames.ts` for reuse). Cache results in a module-level `Map<string, { at: number; value: AnchorTexts }>` keyed by `organizationId ?? 'anonymous'`, TTL 10 minutes (`Date.now()` allowed here — this is serving code, not the deterministic engine).

- [ ] **Step 1: Failing tests** with a stubbed session (`run: async (query) => ({ records: [...] })`, records shaped `{ get: (key) => value }` — copy the record-stub shape used in existing repository tests, see `products/content-generator/tests/migration-repositories.test.ts` for the house pattern). Tests: (a) published drafts weighted by performanceLevel (high → 4); (b) three sources merged, personas weight 3; (c) empty graph → default descriptors with grounding `'default'` and the surface label present; (d) session.run throwing → default fallback, no throw; (e) second call within TTL does not hit the session again (count `run` invocations; use `clearAnchorCache()` in a `beforeEach`).

- [ ] **Step 2: Run; expect FAIL. Step 3: Implement. Step 4: Run + typecheck; expect PASS. Commit** `feat(resonance): graph audience anchors with default fallback`

---

### Task 7: EngineTrigger + trigger consolidation + Modal removal

**Files:**
- Create: `packages/resonance/trigger/index.ts`, `packages/resonance/trigger/engine-trigger.ts`
- Delete: `packages/resonance/trigger/modal-trigger.ts`, `packages/resonance/webhook-security.ts`, `packages/resonance/tests/trigger.test.ts`, `packages/resonance/tests/webhook-security.test.ts`
- Modify: `packages/resonance/server/runs.ts`, `packages/resonance/package.json` (`"./trigger"` export), `packages/resonance/tests/server.test.ts`, `packages/resonance/tests/result-contract.test.ts` (import path)
- Test: `packages/resonance/tests/engine-trigger.test.ts`

**Interfaces:**
- Produces (in `trigger/index.ts`):

```ts
export interface TriggerContext { organizationId?: string }
export interface ResonanceTrigger {
  spawnRun(jobId: string, run: RunRequest, ctx?: TriggerContext): Promise<{ callId: string }>
  fetchResult(callId: string): Promise<ResonancePollPayload | null>
}
export class StubTrigger implements ResonanceTrigger { ... } // moved verbatim from modal-trigger.ts, ctx param added and ignored
export function resolveTrigger(deps: { complete: ... }): ResonanceTrigger
  // 'stub' → StubTrigger; anything else → EngineTrigger
```

- Produces (in `trigger/engine-trigger.ts`):

```ts
export class EngineTrigger implements ResonanceTrigger {
  constructor(private readonly deps: {
    complete: (jobId: string, payload: WebhookPayload) => Promise<void>
    embed?: EmbedFn                    // default: defaultEmbed
    fetchAnchors?: typeof fetchAnchorTexts // default: fetchAnchorTexts
  }) {}
}
```

**EngineTrigger.spawnRun semantics:**
1. `const anchorsSource = await fetchAnchors(ctx?.organizationId, run.surface)`.
2. Build the embedding input list: all anchor texts, then `frameQuery(frame, run.surface, creative.text)` for every creative × frame (creative-major order). ONE `embed(texts)` call.
3. Split the vectors back: anchors → `AudienceAnchor[]` (with their weights); creative-frame rows → `creativeFrameVectors[creativeIndex][frameIndex]`, `null` for any missing/empty row (defensive: `vectors[i]` undefined or zero-length).
4. `const result = runSimulation({ run, anchors, creativeFrameVectors, grounding: anchorsSource.grounding, usdCost: embeddingUsdCost(texts) })`.
5. Compose `WebhookPayload`: `status: result.partial ? 'partial' : 'complete'`, `cellsDone: result.cellsDone`, `result`, `error` set to `result.degradedReason` when partial, and a final `progress` snapshot (`stage: 'ranking'`, `cellsDone`/`cellsTotal` = `result.cellsDone`, `shardsDone`/`shardsTotal` = `run.creatives.length * run.frames.length`, `voteSnapshot: result.voteSnapshot`).
6. `await this.deps.complete(jobId, payload)`; return `{ callId: `engine-${jobId}` }`.
7. ANY thrown error (embed failure, anchor bug): catch, `await complete(jobId, { jobId, status: 'failed', cellsDone: 0, error: message })`, still return `{ callId: `engine-${jobId}` }` — mirrors the old orchestrate never-raise rule so the job settles/releases correctly.
- `fetchResult`: always `return null` (engine runs never poll; the completed job satisfies `persistModalCallId`'s completed-state check, same as the synchronous stub path).

**runs.ts changes:**
- Import `resolveTrigger` from `'../trigger'` (was `'../trigger/modal-trigger'`); delete the `isResonanceResultGone` import and its whole branch in `reconcileRun` (transient-failure logging stays).
- `defaultSpawnRun(jobId, run, ctx)` gains the ctx parameter and passes it through; `RunDeps.spawnRun` type becomes `(jobId: string, run: RunRequest, ctx?: TriggerContext) => Promise<unknown>`; the `startReservedRun` call site passes `{ organizationId: commercial.organizationId }`.

**package.json:** `"./trigger": "./trigger/index.ts"`.

- [ ] **Step 1: Failing lifecycle test** in `tests/engine-trigger.test.ts` (reuse `server.test.ts`'s stub-deps `record()` pattern):

```ts
test('EngineTrigger scores a run end to end with stubbed embeddings and completes it', async () => {
  const completed: Array<{ jobId: string; payload: WebhookPayload }> = []
  const trigger = new EngineTrigger({
    complete: async (jobId, payload) => { completed.push({ jobId, payload }) },
    embed: async (texts) => texts.map((text, i) => {
      // deterministic fake: unit basis vector by index parity so creative a ≠ b
      const v = new Array(8).fill(0); v[i % 8] = 1; return v
    }),
    fetchAnchors: async () => ({ texts: [{ text: 'anchor', weight: 1 }], grounding: 'graph' as const }),
  })
  const { callId } = await trigger.spawnRun('job-1', makeRun(), { organizationId: 'org-1' })
  assert.equal(callId, 'engine-job-1')
  assert.equal(completed.length, 1)
  assert.equal(completed[0].payload.status, 'complete')
  assert.equal(completed[0].payload.result?.audienceGrounding, 'graph')
  assert.equal(await trigger.fetchResult(callId), null)
})

test('a failing embed call completes the job as failed instead of throwing', async () => {
  // embed: async () => { throw new Error('boom') }
  // assert payload.status === 'failed', cellsDone === 0, error includes 'boom',
  // and spawnRun still resolved with a callId.
})

test('resolveTrigger returns StubTrigger in stub mode and EngineTrigger otherwise', ...)
```

- [ ] **Step 2: Run; expect FAIL. Step 3: Implement** (create both trigger files, move StubTrigger + `stubScenario`/`stubProgressPolls`/`pendingStubRuns` into `trigger/index.ts` or a `trigger/stub-trigger.ts` it re-exports, delete Modal/HMAC files and their tests, rewire runs.ts and package.json, fix `result-contract.test.ts` imports).

- [ ] **Step 4: Full package tests + typecheck; expect PASS** (server.test.ts lifecycle suite must pass unchanged apart from the spawnRun arity). Also `grep -rn "modal-trigger\|webhook-security\|ModalTrigger\|isResonanceResultGone\|ResonanceResultGoneError" packages apps products --include="*.ts"` → only comments/docs may remain; fix any live import (note: `packages/resonance/tests/payload.test.ts` and platform `payload.ts` keep `parseModalResult`/`parseResonancePoll` — still used by the poll contract).

- [ ] **Step 5: Commit** `feat(resonance): in-process EngineTrigger; retire ModalTrigger and HMAC plumbing`

---

### Task 8: Environment contract

**Files:**
- Modify: `scripts/validate-production-env.mjs:549-556`, `.env.example:285-293`

- [ ] **Step 1:** In `validate-production-env.mjs`, delete the three `launchOnly("RESONANCE_TRIGGER_URL"|"RESONANCE_RESULT_URL"|"RESONANCE_TRIGGER_SECRET", ...)` lines. Keep the `RESONANCE_RUNTIME_MODE` stub/live check. Where the mode is validated as `live`, require `OPENAI_API_KEY` unless the script already requires it unconditionally (check with `grep -n "OPENAI_API_KEY" scripts/validate-production-env.mjs` — if already required, add nothing).
- [ ] **Step 2:** In `.env.example`, replace the Modal comment block and the three `RESONANCE_TRIGGER_URL/RESONANCE_RESULT_URL/RESONANCE_TRIGGER_SECRET` lines with:

```
# Audience Resonance runs in-process (embedding-space simulation, spec
# 2026-08-31). stub = fabricated results, no network; live = real OpenAI
# embeddings (needs OPENAI_API_KEY).
RESONANCE_RUNTIME_MODE=stub
```

- [ ] **Step 3:** Run `node scripts/validate-production-env.mjs` if it has a self-test/dry mode (check `head -40` of the script for usage); otherwise `node --check scripts/validate-production-env.mjs`. Commit `chore(resonance): drop Modal env contract, live mode rides OPENAI_API_KEY`

---

### Task 9: Retire the Python worker

**Files:**
- Delete: `services/resonance/modal_app.py`, `services/resonance/resonance_core/`, `services/resonance/tests/`, `services/resonance/poc/`, `services/resonance/pyproject.toml`, `services/resonance/uv.lock`, `services/resonance/.gitignore`
- Create: `services/resonance/README.md` (replace)

- [ ] **Step 1:** `git rm -r services/resonance/modal_app.py services/resonance/resonance_core services/resonance/tests services/resonance/poc services/resonance/pyproject.toml services/resonance/uv.lock services/resonance/.gitignore`
- [ ] **Step 2:** Write the new `services/resonance/README.md`:

```markdown
# Resonance training home (`services/resonance`)

The GPU scoring worker that used to live here (steered-Qwen Modal app) was
retired on 2026-08-31 — serving is now an in-process embedding-space
simulation in `packages/resonance/engine/` (spec:
`docs/superpowers/specs/2026-08-31-resonance-embedding-simulation-redesign.md`).

This directory is reserved for the **training side** of the resonance
roadmap (`packages/resonance/ROADMAP.md`): v2 response-model distillation
and fine-tuning, and v3 generator/reward-loop training. Python/torch
territory, deliberately outside the pnpm workspace, empty until there is
data to train on.
```

- [ ] **Step 3:** `grep -rn "services/resonance" CLAUDE.md docs .github scripts --include="*" -l` — update any CI workflow or script that builds/tests the Python worker (remove those steps). Leave spec history docs untouched.
- [ ] **Step 4: Commit** `chore(resonance): retire the Modal GPU worker; reserve services/resonance for training`

---

### Task 10: Docs + full verification

**Files:**
- Modify: `CLAUDE.md` (Audience Resonance Service section)

- [ ] **Step 1:** Rewrite CLAUDE.md's "Audience Resonance Service" section to describe: embedding-space simulation grounded in graph anchors (fitted mixture sampler + similarity readout, no LLM in serving), in-process synchronous completion behind the unchanged `POST/GET /api/resonance/runs` contract, `RESONANCE_RUNTIME_MODE` stub|live (live needs `OPENAI_API_KEY`), flat 1-credit pricing, `services/resonance` as the reserved training home, and pointers to the new spec + `packages/resonance/ROADMAP.md`. Delete the Modal/poll-on-push completion-path paragraphs and the 100–2M/20M-cell GPU ceiling discussion (audienceSize bounds stay; mention `computedAudienceSize` Monte Carlo cap).
- [ ] **Step 2: Full verification:** `pnpm --filter @content-automation/resonance test && pnpm --filter @content-automation/resonance typecheck && pnpm --filter @content-automation/platform typecheck` and a workspace `pnpm typecheck` (or `pnpm turbo typecheck`) to catch stale imports anywhere. Run `pnpm --filter @content-automation/platform test` if that package has tests touching resonance payload.
- [ ] **Step 3: Commit** `docs: resonance embedding-simulation architecture`

## Self-Review Notes

- Spec §2.1 sampler → Task 4+6; §2.2 readout/templates/client → Tasks 4+5; §2.3 calibrator → v1 identity is folded into the readout constants (no separate file until v2 — YAGNI; the contract lives in ROADMAP).
- Spec §3 lifecycle/trigger → Task 7; §3.1 bounds → Task 4; §3.2 contract → Tasks 2+4; §3.3 pricing → Task 1.
- Spec §4 removals → Tasks 7+8+9; §5 errors → Tasks 4 (degraded), 6 (fallback), 7 (never-raise); §6 testing → each task's tests; §7 roadmap → already committed.
- Type consistency: `TriggerContext`, `EmbedFn`, `AnchorTexts`, `SimulationInput` defined once each (Tasks 5–7 consume Task 4/5 names exactly).
