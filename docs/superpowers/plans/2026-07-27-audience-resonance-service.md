# Audience Resonance Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Audience Resonance Service end-to-end: `packages/resonance` platform service + `apps/unified` API routes + `services/resonance` Modal worker, so a client can POST two creatives with a chosen audience size (100 → 2,000,000) and get back calibrated scores and a winner.

**Architecture:** Next.js owns the API (jobs-table pattern: POST returns `{ jobId }` immediately); a signed trigger spawns the Modal worker (activation-steering logprob readout, validated in `services/resonance/poc/`); the worker fans out shards over GPU containers and returns the result, which the platform collects by polling Modal's durable call handle on read. Spec: `docs/superpowers/specs/2026-07-27-audience-resonance-service-design.md`.

> **Revised 2026-07-27 — Task 13 supersedes the push-completion design.** Tasks 5–7 and 9 were built against an inbound `/api/resonance/webhook` route; Task 13 replaces it with poll-on-read and deletes the inbound surface. Where those tasks and Task 13 disagree, **Task 13 governs**.

**Tech Stack:** TypeScript (zod, node:test via tsx), Next.js App Router routes in `apps/unified`, platform jobs table (Postgres), commerce credits (`reserveVariableCost`), Python 3.12 + Modal + HF transformers (worker), pytest.

## Global Constraints

- No FastAPI app and no web framework of ours on the Modal side; the only HTTP entry there is one `@modal.fastapi_endpoint`-decorated trigger function that verifies HMAC and spawns the worker.
- v1 rides the platform `jobs` table — do NOT create new Postgres tables (avoids tenant-isolation/observability architecture contracts).
- All outbound HTTP from the TS side goes through `packages/platform/network/safe-fetch.ts` helpers (test-enforced).
- ~~The webhook route must satisfy `tests/architecture/network-webhook-boundaries.test.mjs`~~ — **retired by Task 13.** There is no inbound surface; every call is outbound from the platform. HMAC (300 s window, timing-safe) still protects the outbound trigger and result fetch, and completion remains replay-safe via the one-shot `transitionJobStatus`.
- Package tests: `node --import tsx --test tests/*.test.ts` (house convention). Python tests: `pytest`.
- UI follows `docs/design-language.md` (PageHeader, semantic tokens only, sonner, skeletons).
- `audienceSize`: integer, 100 ≤ n ≤ 2,000,000. Total cells (`creatives × frames × audienceSize`) capped at 20,000,000. Credits = `max(1, ceil(cells / 1000))` (placeholder pricing, billing to be revisited).
- Model: `Qwen/Qwen3.5-4B`, `enable_thinking=False`, steering at the middle decoder layer, ratio 0.5 × residual norm, positive frames only (consistency battery: inverted frames are weak).
- Commit after every green test cycle. Run `pnpm test:architecture` after Tasks 3, 6, and 7.

---

### Task 1: `packages/resonance` scaffold + run-payload contract

**Files:**
- Create: `packages/resonance/package.json`
- Create: `packages/resonance/domain/types.ts`
- Create: `packages/resonance/domain/payload.ts`
- Test: `packages/resonance/tests/payload.test.ts`

**Interfaces:**
- Produces: `parseRunRequest(body: unknown): RunRequest` (throws `ZodError`), `estimateRun(run: RunRequest): RunEstimate`, types `Creative { id, text }`, `RunRequest { creatives, audienceSize, frames, seed }`, `RunEstimate { cells, credits }`, `RunResult` (see code), constants `AUDIENCE_MIN=100`, `AUDIENCE_MAX=2_000_000`, `CELL_CAP=20_000_000`, `RESONANCE_FRAMES`.

- [ ] **Step 1: Create the package manifest**

```json
{
  "name": "@content-automation/resonance",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./domain": "./domain/types.ts",
    "./payload": "./domain/payload.ts",
    "./webhook-security": "./webhook-security.ts",
    "./trigger": "./trigger/modal-trigger.ts",
    "./server": "./server/runs.ts"
  },
  "scripts": {
    "test": "node --import tsx --test --test-concurrency=1 tests/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@content-automation/platform": "workspace:*",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

Match the `zod`/`tsx`/`typescript` versions used by sibling workspace packages. Run `pnpm install` at repo root afterward.

- [ ] **Step 2: Write the failing test**

`packages/resonance/tests/payload.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRunRequest, estimateRun, AUDIENCE_MIN, AUDIENCE_MAX } from '../domain/payload'

const valid = {
  creatives: [
    { id: 'a', text: 'Campaign A copy' },
    { id: 'b', text: 'Campaign B copy' },
  ],
  audienceSize: 1000,
  frames: ['scroll_stop', 'click'],
  seed: 7,
}

test('accepts a valid run request', () => {
  const run = parseRunRequest(valid)
  assert.equal(run.audienceSize, 1000)
  assert.deepEqual(run.frames, ['scroll_stop', 'click'])
})

test('defaults frames and seed when omitted', () => {
  const run = parseRunRequest({ creatives: valid.creatives, audienceSize: 500 })
  assert.deepEqual(run.frames, ['scroll_stop', 'click', 'compelling'])
  assert.equal(run.seed, 0)
})

test('rejects fewer than two creatives', () => {
  assert.throws(() => parseRunRequest({ ...valid, creatives: [valid.creatives[0]] }))
})

test('rejects audienceSize outside bounds', () => {
  assert.throws(() => parseRunRequest({ ...valid, audienceSize: AUDIENCE_MIN - 1 }))
  assert.throws(() => parseRunRequest({ ...valid, audienceSize: AUDIENCE_MAX + 1 }))
})

test('rejects runs over the cell cap', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, text: `t${i}` }))
  assert.throws(() => parseRunRequest({
    creatives: twenty, audienceSize: 2_000_000,
    frames: ['scroll_stop', 'click', 'compelling'],
  }))
})

test('estimates cells and credits', () => {
  const est = estimateRun(parseRunRequest(valid))
  assert.equal(est.cells, 2 * 2 * 1000)
  assert.equal(est.credits, 4)
})

test('credits floor at 1', () => {
  const est = estimateRun(parseRunRequest({ ...valid, audienceSize: 100, frames: ['click'] }))
  assert.equal(est.credits, 1)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @content-automation/resonance test`
Expected: FAIL (cannot resolve `../domain/payload`)

- [ ] **Step 4: Implement domain/types.ts and domain/payload.ts**

`packages/resonance/domain/types.ts`:

```ts
export const RESONANCE_FRAMES = ['scroll_stop', 'click', 'share', 'compelling'] as const
export type ResonanceFrame = (typeof RESONANCE_FRAMES)[number]

export interface Creative { id: string; text: string }

export interface RunRequest {
  creatives: Creative[]
  audienceSize: number
  frames: ResonanceFrame[]
  seed: number
}

export interface RunEstimate { cells: number; credits: number }

export interface CreativeScore {
  creativeId: string
  score: number            // 0-100
  ci95: [number, number]
  perFrame: Record<string, number>
}

export interface RunResult {
  scores: CreativeScore[]
  winner: { creativeId: string; margin: number; tooCloseToCall: boolean }
  audienceSize: number
  cellsDone: number
  model: string
  gpuSeconds: number
  usdCost: number
}

export interface WebhookPayload {
  jobId: string
  status: 'complete' | 'partial' | 'failed'
  cellsDone: number
  result?: RunResult
  error?: string
}
```

`packages/resonance/domain/payload.ts`:

```ts
import { z } from 'zod'
import { RESONANCE_FRAMES, type RunRequest, type RunEstimate } from './types'

export const AUDIENCE_MIN = 100
export const AUDIENCE_MAX = 2_000_000
export const CELL_CAP = 20_000_000
const DEFAULT_FRAMES = ['scroll_stop', 'click', 'compelling'] as const

const runRequestSchema = z.object({
  creatives: z.array(z.object({
    id: z.string().min(1).max(100),
    text: z.string().min(1).max(5000),
  })).min(2).max(20),
  audienceSize: z.number().int().min(AUDIENCE_MIN).max(AUDIENCE_MAX),
  frames: z.array(z.enum(RESONANCE_FRAMES)).min(1).max(4).default([...DEFAULT_FRAMES]),
  seed: z.number().int().min(0).default(0),
})

export function parseRunRequest(body: unknown): RunRequest {
  const run = runRequestSchema.parse(body)
  const cells = run.creatives.length * run.frames.length * run.audienceSize
  if (cells > CELL_CAP) {
    throw new z.ZodError([{ code: 'custom', path: ['audienceSize'], message: `run exceeds ${CELL_CAP} cells` }])
  }
  return run
}

export function estimateRun(run: RunRequest): RunEstimate {
  const cells = run.creatives.length * run.frames.length * run.audienceSize
  return { cells, credits: Math.max(1, Math.ceil(cells / 1000)) }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @content-automation/resonance test`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/resonance pnpm-lock.yaml
git commit -m "feat(resonance): package scaffold with run-payload contract"
```

---

### Task 2: Webhook/trigger HMAC security module

**Files:**
- Create: `packages/resonance/webhook-security.ts`
- Test: `packages/resonance/tests/webhook-security.test.ts`

**Interfaces:**
- Produces: `signResonanceRequest(secret, body, requestId?, timestamp?): { requestId, timestamp, signature }` and `verifyResonanceRequest({ secret, body, requestId, timestamp, signature, now?, maxAgeSeconds? }): boolean`. Message format `${requestId}.${timestamp}.${body}`, signature `sha256=<hex>`, secret min 32 chars, default freshness 300 s. Header names used by later tasks: `x-resonance-request-id`, `x-resonance-timestamp`, `x-resonance-signature` (exported as `RESONANCE_SIGNATURE_HEADERS`).

- [ ] **Step 1: Read the reference implementation** — `packages/chat/security.ts:28-74` (`signInternalRequest` / `verifyInternalRequest`). The resonance module is the same algorithm with resonance naming and exported header constants; keeping our own copy avoids a chat dependency.

- [ ] **Step 2: Write the failing test**

`packages/resonance/tests/webhook-security.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signResonanceRequest, verifyResonanceRequest } from '../webhook-security'

const secret = 's'.repeat(32)
const body = JSON.stringify({ jobId: 'j1', status: 'complete' })

test('signed request verifies', () => {
  const h = signResonanceRequest(secret, body)
  assert.ok(verifyResonanceRequest({ secret, body, ...h }))
})

test('rejection: tampered body fails verification', () => {
  const h = signResonanceRequest(secret, body)
  assert.equal(verifyResonanceRequest({ secret, body: body + 'x', ...h }), false)
})

test('rejection: stale timestamp outside 300s window fails', () => {
  const ts = String(Math.floor(Date.now() / 1000) - 301)
  const h = signResonanceRequest(secret, body, undefined, ts)
  assert.equal(verifyResonanceRequest({ secret, body, ...h }), false)
})

test('rejection: short secret refuses to sign', () => {
  assert.throws(() => signResonanceRequest('short', body))
})

test('rejection: missing signature fails', () => {
  const h = signResonanceRequest(secret, body)
  assert.equal(verifyResonanceRequest({ secret, body, requestId: h.requestId, timestamp: h.timestamp, signature: null }), false)
})
```

- [ ] **Step 3: Run test to verify it fails** — `pnpm --filter @content-automation/resonance test` → FAIL (module missing).

- [ ] **Step 4: Implement** `packages/resonance/webhook-security.ts` by porting `packages/chat/security.ts:28-74` verbatim with renames (`signInternalRequest` → `signResonanceRequest`, `verifyInternalRequest` → `verifyResonanceRequest`), plus:

```ts
export const RESONANCE_SIGNATURE_HEADERS = {
  requestId: 'x-resonance-request-id',
  timestamp: 'x-resonance-timestamp',
  signature: 'x-resonance-signature',
} as const
```

- [ ] **Step 5: Run tests** → PASS. **Step 6: Commit** `feat(resonance): HMAC sign/verify for trigger and webhook`.

---

### Task 3: Platform registration — `resonance` product, `resonance_run` action, one-shot job transition

**Files:**
- Modify: `packages/platform/agents/contracts.ts` (Product + BackgroundAction unions)
- Modify: `packages/platform/agents/action-catalog.json`
- Modify: `packages/platform/jobs/repository.ts` (product backfill CASE ~`:96-101`; new `transitionJobStatus`)
- Test: `packages/platform/tests/` (extend existing jobs test file or add `resonance-jobs.test.ts`)

**Interfaces:**
- Produces: `'resonance_run'` valid as `BackgroundAction` for `createJob`; `getActionProduct('resonance_run') === 'resonance'`; `transitionJobStatus(organizationId: string, jobId: string, from: JobStatus[], to: JobStatus, options?: { result?: Record<string, unknown>; error?: string }): Promise<boolean>` — returns false when the row was not in a `from` status (replay-safe single transition).

- [ ] **Step 1: Read** `packages/platform/agents/contracts.ts` and `action-catalog.json` to see the exact union/catalog shapes, and `tests/architecture/action-ownership.test.mjs:11-16` for the ownership rule.

- [ ] **Step 2: Write the failing test** (in platform tests, alongside the existing jobs tests — copy their Postgres setup/teardown):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJob, getJobStatus, transitionJobStatus } from '../jobs/repository'
import { getActionProduct } from '../agents/contracts'

test('resonance_run maps to the resonance product', () => {
  assert.equal(getActionProduct('resonance_run'), 'resonance')
})

test('transitionJobStatus completes a queued job exactly once', async () => {
  const jobId = await createJob('resonance_run', 'run', undefined, {
    organizationId: TEST_ORG, initiatingUserId: TEST_USER,
    walletUserId: TEST_USER, creditReservationId: 'res-1',
  })
  const first = await transitionJobStatus(TEST_ORG, jobId, ['queued', 'processing'], 'completed', { result: { ok: true } })
  const replay = await transitionJobStatus(TEST_ORG, jobId, ['queued', 'processing'], 'completed', { result: { ok: false } })
  assert.equal(first, true)
  assert.equal(replay, false)
  const job = await getJobStatus(TEST_ORG, jobId)
  assert.equal(job?.status, 'completed')
  assert.deepEqual(job?.result, { ok: true })
})
```

Use the same `TEST_ORG`/`TEST_USER` fixtures the existing platform jobs tests use (read `packages/platform/tests/job-attribution.test.ts` first and mirror its setup).

- [ ] **Step 3: Run to verify failure** — `pnpm test:platform` (needs local Postgres via `docker compose up -d`) → FAIL.

- [ ] **Step 4: Implement.** (a) Add `'resonance'` to the `Product` union and `'resonance_run'` to the `BackgroundAction` union in `contracts.ts`; (b) add a `resonance` product entry owning `["resonance_run"]` in `action-catalog.json` (mirror existing structure exactly); (c) extend the backfill CASE in `repository.ts` with `WHEN type = 'resonance_run' THEN 'resonance'`; (d) add to `repository.ts`:

```ts
export async function transitionJobStatus(
  organizationId: string,
  jobId: string,
  from: JobStatus[],
  to: JobStatus,
  options?: { result?: Record<string, unknown>; error?: string },
): Promise<boolean> {
  const client = await getJobPool(organizationId).connect()
  try {
    const scoped = validateJobOrganizationId(organizationId)
    const setClauses = ['status = $3']
    const params: (string | object | null)[] = [scoped, jobId, to]
    let i = 4
    if (to === 'processing') setClauses.push('started_at = NOW()')
    if (to === 'completed' || to === 'failed') setClauses.push('completed_at = NOW()')
    if (options?.result) { setClauses.push(`result = $${i}`); params.push(JSON.stringify(options.result)); i++ }
    if (options?.error) { setClauses.push(`error = $${i}`); params.push(options.error); i++ }
    const fromList = from.map((_, k) => `$${i + k}`).join(', ')
    params.push(...from)
    const res = await client.query(
      `UPDATE jobs SET ${setClauses.join(', ')} WHERE organization_id = $1 AND id = $2 AND status IN (${fromList})`,
      params,
    )
    return (res.rowCount ?? 0) > 0
  } finally {
    client.release()
  }
}
```

- [ ] **Step 5: Run tests** — `pnpm test:platform` → PASS; `pnpm test:architecture` → PASS (action-ownership + product-boundaries).

- [ ] **Step 6: Commit** `feat(platform): resonance product tag and one-shot job transition`.

---

### Task 4: Modal trigger client (+ stub runtime mode)

**Files:**
- Create: `packages/resonance/trigger/modal-trigger.ts`
- Test: `packages/resonance/tests/trigger.test.ts`

**Interfaces:**
- Consumes: `signResonanceRequest`, `RESONANCE_SIGNATURE_HEADERS` (Task 2); `RunRequest`, `RunResult`, `WebhookPayload` (Task 1).
- Produces: `interface ResonanceTrigger { spawnRun(jobId: string, run: RunRequest): Promise<void> }`; `class ModalTrigger implements ResonanceTrigger` (env `RESONANCE_TRIGGER_URL`, `RESONANCE_TRIGGER_SECRET`; POSTs signed JSON `{ jobId, ...run }` via `safeFetchPublicUrl`); `class StubTrigger` (calls `complete(jobId, payload)` with a deterministic fake `WebhookPayload` — used when `RESONANCE_RUNTIME_MODE=stub`); `resolveTrigger(deps: { complete: (jobId: string, p: WebhookPayload) => Promise<void>; fetchImpl?: typeof fetch }): ResonanceTrigger`.

- [ ] **Step 1: Read** `packages/platform/network/safe-fetch.ts` (exports around `:144` and `:293`) for the exact `safeFetchPublicUrl` signature and allowed-hosts option; mirror an existing caller (grep for `safeFetchPublicUrl(` usages).

- [ ] **Step 2: Write the failing test** — `StubTrigger` produces a deterministic winner and calls `complete`; `ModalTrigger` signs and posts:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StubTrigger, ModalTrigger } from '../trigger/modal-trigger'
import { verifyResonanceRequest, RESONANCE_SIGNATURE_HEADERS } from '../webhook-security'
import { parseRunRequest } from '../domain/payload'

const run = parseRunRequest({
  creatives: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }],
  audienceSize: 100, frames: ['click'],
})

test('StubTrigger completes the run with deterministic scores', async () => {
  const seen: unknown[] = []
  const trigger = new StubTrigger(async (jobId, payload) => { seen.push({ jobId, payload }) })
  await trigger.spawnRun('job-1', run)
  const { jobId, payload } = seen[0] as { jobId: string; payload: { status: string; result: { scores: unknown[] } } }
  assert.equal(jobId, 'job-1')
  assert.equal(payload.status, 'complete')
  assert.equal(payload.result.scores.length, 2)
})

test('ModalTrigger posts an HMAC-signed body to the trigger URL', async () => {
  const secret = 't'.repeat(32)
  let captured: { url: string; body: string; headers: Record<string, string> } | null = null
  const fetchImpl = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    captured = { url, body: init.body, headers: init.headers }
    return new Response(JSON.stringify({ ok: true }), { status: 202 })
  }) as unknown as typeof fetch
  const trigger = new ModalTrigger({ url: 'https://example.modal.run/trigger', secret, fetchImpl })
  await trigger.spawnRun('job-2', run)
  assert.ok(captured)
  const h = captured!.headers
  assert.ok(verifyResonanceRequest({
    secret, body: captured!.body,
    requestId: h[RESONANCE_SIGNATURE_HEADERS.requestId],
    timestamp: h[RESONANCE_SIGNATURE_HEADERS.timestamp],
    signature: h[RESONANCE_SIGNATURE_HEADERS.signature],
  }))
  assert.equal(JSON.parse(captured!.body).jobId, 'job-2')
})

test('ModalTrigger throws on non-2xx', async () => {
  const fetchImpl = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
  const trigger = new ModalTrigger({ url: 'https://example.modal.run/trigger', secret: 't'.repeat(32), fetchImpl })
  await assert.rejects(() => trigger.spawnRun('job-3', run))
})
```

- [ ] **Step 3: Run to verify failure.** — module missing.

- [ ] **Step 4: Implement** `trigger/modal-trigger.ts`. `ModalTrigger` constructor takes `{ url?, secret?, fetchImpl? }` defaulting from `process.env.RESONANCE_TRIGGER_URL` / `RESONANCE_TRIGGER_SECRET` (throw if unset, matching the `OpenRouterLlm` convention at `products/cascade/agent/llm.ts:21-24`); `spawnRun` builds `body = JSON.stringify({ jobId, ...run })`, signs with `signResonanceRequest`, sends via injected `fetchImpl` when provided, otherwise `safeFetchPublicUrl` with the trigger URL's host allowlisted; throw with truncated body on `!response.ok`. `StubTrigger.spawnRun` computes a fake result: score `70 - 10 * index` per creative, `ci95: [score-3, score+3]`, winner = first creative, `cellsDone = estimateRun(run).cells`, and awaits `complete(jobId, payload)`. `resolveTrigger(deps)` returns `StubTrigger` when `process.env.RESONANCE_RUNTIME_MODE === 'stub'`, else `ModalTrigger` (passing `deps.fetchImpl` through for tests).

- [ ] **Step 5: Run tests** → PASS. **Step 6: Commit** `feat(resonance): Modal trigger client with stub runtime mode`.

---

### Task 5: Server handlers — create run, read run, webhook completion

**Files:**
- Create: `packages/resonance/server/runs.ts`
- Test: `packages/resonance/tests/server.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4 exports; `reserveVariableCost`, `commercialErrorResponse` from `@content-automation/auth/commercial`; `createJob`, `getJobStatus`, `transitionJobStatus`, `getJobOrganizationId` from the platform jobs repository; `settleReservation`, `releaseReservation` from `@content-automation/commerce/server`.
- Produces: `handleCreateRun(request: Request, deps?: Partial<RunDeps>): Promise<Response>`; `handleGetRun(request: Request, jobId: string, deps?): Promise<Response>`; `handleWebhook(request: Request, deps?): Promise<Response>`; `completeRun(jobId: string, payload: WebhookPayload, deps?): Promise<void>` (shared by webhook route and StubTrigger). `RunDeps` bundles every external call so tests stub them (house `Deps` convention, e.g. `DraftDeps` at `products/content-generator/agent/actions/draft.ts:328`).

- [ ] **Step 1: Write the failing tests** — all external calls stubbed via `deps`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleCreateRun, handleGetRun, handleWebhook, completeRun } from '../server/runs'
import { signResonanceRequest, RESONANCE_SIGNATURE_HEADERS } from '../webhook-security'

const secret = 'w'.repeat(32)
const validBody = {
  creatives: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }],
  audienceSize: 1000, frames: ['click'],
}

function deps(overrides = {}) {
  const calls: Record<string, unknown[]> = {}
  const record = (name: string, ret: unknown) => (...args: unknown[]) => {
    (calls[name] ??= []).push(args); return Promise.resolve(ret)
  }
  return {
    calls,
    reserve: record('reserve', { context: { organizationId: 'org1', session: { user: { id: 'u1' } } }, reservationId: 'res1', estimatedCredits: 2 }),
    createJob: record('createJob', 'job-1'),
    spawnRun: record('spawnRun', undefined),
    getJob: record('getJob', { id: 'job-1', status: 'completed', result: { scores: [] }, creditReservationId: 'res1', walletUserId: 'u1', initiatingUserId: 'u1' }),
    getJobOrg: record('getJobOrg', 'org1'),
    transition: record('transition', true),
    settle: record('settle', undefined),
    release: record('release', undefined),
    webhookSecret: secret,
    ...overrides,
  }
}

test('create run reserves credits, creates job, spawns, returns 202 jobId', async () => {
  const d = deps()
  const res = await handleCreateRun(new Request('http://x/api/resonance/runs', {
    method: 'POST', body: JSON.stringify(validBody),
  }), d)
  assert.equal(res.status, 202)
  const json = await res.json()
  assert.equal(json.jobId, 'job-1')
  assert.equal(json.estimatedCells, 2000)
  assert.equal(d.calls.spawnRun.length, 1)
})

test('create run returns 400 on invalid payload without reserving', async () => {
  const d = deps()
  const res = await handleCreateRun(new Request('http://x', { method: 'POST', body: JSON.stringify({ creatives: [] }) }), d)
  assert.equal(res.status, 400)
  assert.equal(d.calls.reserve, undefined)
})

test('create run releases reservation when spawn fails', async () => {
  const d = deps({ spawnRun: () => Promise.reject(new Error('modal down')) })
  const res = await handleCreateRun(new Request('http://x', { method: 'POST', body: JSON.stringify(validBody) }), d)
  assert.equal(res.status, 502)
  assert.equal(d.calls.release.length, 1)
})

test('get run returns job status and result', async () => {
  const d = deps()
  const res = await handleGetRun(new Request('http://x'), 'job-1', d)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).status, 'completed')
})

test('webhook rejection: bad signature is 401 and no transition', async () => {
  const d = deps()
  const res = await handleWebhook(new Request('http://x', { method: 'POST', body: '{}' }), d)
  assert.equal(res.status, 401)
  assert.equal(d.calls.transition, undefined)
})

test('webhook completes job and settles actual credits', async () => {
  const d = deps()
  const body = JSON.stringify({ jobId: 'job-1', status: 'complete', cellsDone: 2000, result: { scores: [], winner: { creativeId: 'a', margin: 1, tooCloseToCall: false }, audienceSize: 1000, cellsDone: 2000, model: 'm', gpuSeconds: 1, usdCost: 0.01 } })
  const h = signResonanceRequest(secret, body)
  const res = await handleWebhook(new Request('http://x', {
    method: 'POST', body,
    headers: {
      [RESONANCE_SIGNATURE_HEADERS.requestId]: h.requestId,
      [RESONANCE_SIGNATURE_HEADERS.timestamp]: h.timestamp,
      [RESONANCE_SIGNATURE_HEADERS.signature]: h.signature,
    },
  }), d)
  assert.equal(res.status, 200)
  assert.equal(d.calls.transition.length, 1)
  assert.equal(d.calls.settle.length, 1)
  const settleArgs = d.calls.settle[0][0] as { actualCredits: number }
  assert.equal(settleArgs.actualCredits, 2) // ceil(2000/1000)
})

test('webhook replay: second delivery is a no-op 200', async () => {
  const d = deps({ transition: () => Promise.resolve(false) })
  const body = JSON.stringify({ jobId: 'job-1', status: 'complete', cellsDone: 2000 })
  const h = signResonanceRequest(secret, body)
  const res = await handleWebhook(new Request('http://x', {
    method: 'POST', body,
    headers: {
      [RESONANCE_SIGNATURE_HEADERS.requestId]: h.requestId,
      [RESONANCE_SIGNATURE_HEADERS.timestamp]: h.timestamp,
      [RESONANCE_SIGNATURE_HEADERS.signature]: h.signature,
    },
  }), d)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).replay, true)
  assert.equal(d.calls.settle, undefined)
})

test('webhook rejection: oversized body is 413', async () => {
  const d = deps()
  const big = 'x'.repeat(1_048_577)
  const res = await handleWebhook(new Request('http://x', { method: 'POST', body: big }), d)
  assert.equal(res.status, 413)
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `server/runs.ts`.** Key behaviors (all deps default to the real modules, overridable):
  - `handleCreateRun`: parse (400 + zod issues on failure) → `deps.reserve(request, { action: 'resonance_run', credits: estimate.credits, capability: 'research' })` (capability choice: reuse `research`; a dedicated `resonance` capability is a follow-up) → `deps.createJob('resonance_run', crypto.randomUUID(), undefined, commercial)` where `commercial` is built from the reserve result exactly like `reserveBackgroundAction` builds it (`packages/auth/commercial.ts:41-49`) → `deps.spawnRun(jobId, run)`; on spawn failure `deps.release(reservationId, message)` + mark job failed + 502 → success: `202 { jobId, estimatedCells, estimatedCredits }`. Wrap commercial errors with `commercialErrorResponse` (401/402/403).
  - `handleGetRun`: resolve org from the authenticated context (same `getAuthorizationContext` used in reserve; in deps for tests), `deps.getJob(orgId, jobId)`, 404 if null, else `200 { status, result, error, createdAt, completedAt }`.
  - `handleWebhook`: read body with a 1 MiB bound using the platform request-body helper; verify via `verifyResonanceRequest` with `deps.webhookSecret`, parse `WebhookPayload`, then call `completeRun`.
  - `completeRun`: resolve the organization, transition the job exactly once, then settle credits on success or release the reservation on failure.

- [ ] **Step 4: Run tests** → PASS (9 tests). **Step 5: Commit** `feat(resonance): run lifecycle handlers with replay-safe webhook`.

---

### Task 6: Unified app routes + proxy allowlist + architecture registration

**Files:**
- Create: `apps/unified/app/api/resonance/runs/route.ts`
- Create: `apps/unified/app/api/resonance/runs/[jobId]/route.ts`
- Create: `apps/unified/app/api/resonance/webhook/route.ts`
- Modify: `apps/unified/proxy.ts` (public allowlist, pattern at `:39`)
- Modify: `tests/architecture/network-webhook-boundaries.test.mjs` (register the webhook route + its regression suite path)

**Interfaces:**
- Consumes: `handleCreateRun` / `handleGetRun` / `handleWebhook` / `completeRun` (Task 5), `resolveTrigger` (Task 4).

- [ ] **Step 1: Write the route files** as thin shells over the server package:

`runs/route.ts`:

```ts
import { handleCreateRun } from '@content-automation/resonance/server'

export async function POST(request: Request) {
  return handleCreateRun(request)
}
```

`runs/[jobId]/route.ts`:

```ts
import { handleGetRun } from '@content-automation/resonance/server'

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  return handleGetRun(request, jobId)
}
```

`webhook/route.ts`:

```ts
import { handleWebhook } from '@content-automation/resonance/server'

export async function POST(request: Request) {
  return handleWebhook(request)
}
```

(Check the Next version's `params` convention against a neighboring dynamic route and match it exactly.)

- [ ] **Step 2: Wire the default trigger.** In `server/runs.ts`, the default `spawnRun` dep must be `resolveTrigger({ complete: completeRun }).spawnRun` so stub mode closes the loop in-process. Add `@content-automation/resonance` to `apps/unified/package.json` dependencies; `pnpm install`.

- [ ] **Step 3: Allowlist the webhook** in `apps/unified/proxy.ts`: `pathname.startsWith("/api/resonance/webhook")`.

- [ ] **Step 4: Register in the architecture test.** Read `tests/architecture/network-webhook-boundaries.test.mjs:37-136`; add the webhook boundary entry (route file path, required source patterns — bounded read, verify call, freshness — mirror the internal-assistants entry) and point the regression-suite requirement at `packages/resonance/tests/server.test.ts` (its test names already contain "rejection" and "replay").

- [ ] **Step 5: Run** `pnpm test:architecture` → PASS, and `pnpm --filter @content-automation/unified-app typecheck` (or root `pnpm typecheck`) → PASS.

- [ ] **Step 6: Manual stub-mode smoke.** With Postgres up and `RESONANCE_RUNTIME_MODE=stub pnpm dev`: `POST /api/resonance/runs` (authenticated session; use the browser or an existing e2e helper) → expect `202 { jobId }`, then `GET /api/resonance/runs/<jobId>` → `completed` with stub scores. Record the curl transcript in the commit message body.

- [ ] **Step 7: Commit** `feat(unified): resonance API routes with stub-mode loop`.

---

### Task 7: Environment and secret registration

**Files:**
- Modify: `.env.example` (near the Cascade/Resend block ~`:225`)
- Modify: `ops/security/secret-inventory.json` (new record; model on the Resend record at `:171`)
- Modify: `scripts/validate-production-env.mjs` (alongside `:461-462`)
- Modify: `tests/architecture/production-env-contract.test.mjs` (`validEnvironment()` + `TESTING_PROFILE_DEFERRED_VARIABLES`)

**Interfaces:**
- Produces env contract: `RESONANCE_TRIGGER_URL` (httpsUrl), `RESONANCE_TRIGGER_SECRET` (secret ≥32), `RESONANCE_WEBHOOK_SECRET` (secret ≥32), `RESONANCE_RUNTIME_MODE` (`stub|live`, default `stub` in dev).

- [ ] **Step 1: Add to `.env.example`:**

```bash
# Audience Resonance service (Modal worker)
RESONANCE_RUNTIME_MODE=stub
RESONANCE_TRIGGER_URL=
RESONANCE_TRIGGER_SECRET=
RESONANCE_WEBHOOK_SECRET=
```

- [ ] **Step 2: Secret inventory.** Add one record owning `RESONANCE_TRIGGER_SECRET` + `RESONANCE_WEBHOOK_SECRET` (owner: Rajesh, storage: Modal secret + deployment env, rotationProcedure: regenerate 32+ char values, update Modal secret `resonance-platform` and app env together). Run `pnpm secrets:inventory:check` → PASS.

- [ ] **Step 3: Prod validator.** Register with `launchOnly` wrappers: `httpsUrl("RESONANCE_TRIGGER_URL")`, `secret("RESONANCE_TRIGGER_SECRET", 32)`, `secret("RESONANCE_WEBHOOK_SECRET", 32)`. Add the three to `validEnvironment()` and the `launchOnly` ones to `TESTING_PROFILE_DEFERRED_VARIABLES` in the contract test.

- [ ] **Step 4: Run** `pnpm test:architecture` and `node scripts/validate-production-env.mjs --environment-file .env.example --service all` (expect the same pass/warn profile as before the change, plus the new deferred entries). **Step 5: Commit** `chore(resonance): register env contract and secret inventory`.

---

### Task 8: Worker core — cell compiler and aggregation (pure Python)

**Files:**
- Create: `services/resonance/resonance_core/__init__.py`
- Create: `services/resonance/resonance_core/cells.py`
- Create: `services/resonance/resonance_core/aggregate.py`
- Create: `services/resonance/pyproject.toml` (name `resonance-worker`, deps: `numpy`; dev: `pytest`; managed with `uv`)
- Test: `services/resonance/tests/test_cells.py`, `services/resonance/tests/test_aggregate.py`

**Interfaces:**
- Produces: `compile_shards(payload: dict, shard_draws: int = 5000) -> list[dict]` — each shard `{ "creative_id", "creative_text", "frame", "draw_start", "draw_count", "seed" }`; every (creative × frame) pair covers the full draw range, and the same `(seed, draw_start)` recurs across creatives/frames so steering vectors pair. `aggregate(payload: dict, shard_results: list[dict]) -> dict` — shard result `{ "creative_id", "frame", "draw_start", "p": list[float] }`; returns the `RunResult` JSON shape from Task 1 (`scores` with 0-100 score, `ci95` cluster bootstrap over draws, `perFrame` means, `winner` with `tooCloseToCall` when CI overlap).

- [ ] **Step 1: Write failing tests**

`test_cells.py`:

```python
from resonance_core.cells import compile_shards

PAYLOAD = {
    "jobId": "j1",
    "creatives": [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}],
    "audienceSize": 12_000,
    "frames": ["scroll_stop", "click"],
    "seed": 7,
}

def test_full_coverage_and_pairing():
    shards = compile_shards(PAYLOAD, shard_draws=5000)
    # 2 creatives x 2 frames x ceil(12000/5000)=3 chunks
    assert len(shards) == 12
    for cid in ("a", "b"):
        covered = sorted(
            (s["draw_start"], s["draw_count"]) for s in shards
            if s["creative_id"] == cid and s["frame"] == "click"
        )
        assert covered == [(0, 5000), (5000, 5000), (10000, 2000)]
    # pairing: same seed+draw_start for both creatives
    seeds = {(s["creative_id"], s["draw_start"]): s["seed"] for s in shards if s["frame"] == "click"}
    assert seeds[("a", 5000)] == seeds[("b", 5000)]

def test_seed_varies_by_chunk_not_creative():
    shards = compile_shards(PAYLOAD, shard_draws=5000)
    chunk_seeds = {s["draw_start"]: s["seed"] for s in shards if s["creative_id"] == "a" and s["frame"] == "click"}
    assert len(set(chunk_seeds.values())) == 3
```

`test_aggregate.py`:

```python
import numpy as np
from resonance_core.aggregate import aggregate

PAYLOAD = {
    "jobId": "j1",
    "creatives": [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}],
    "audienceSize": 200,
    "frames": ["click"],
    "seed": 0,
}

def _shard(cid, p):
    return {"creative_id": cid, "frame": "click", "draw_start": 0, "p": list(p)}

def test_clear_winner():
    rng = np.random.default_rng(0)
    result = aggregate(PAYLOAD, [
        _shard("a", np.clip(rng.normal(0.8, 0.05, 200), 0, 1)),
        _shard("b", np.clip(rng.normal(0.6, 0.05, 200), 0, 1)),
    ])
    assert result["winner"]["creativeId"] == "a"
    assert result["winner"]["tooCloseToCall"] is False
    a = next(s for s in result["scores"] if s["creativeId"] == "a")
    assert 0 <= a["ci95"][0] <= a["score"] / 100 * 100 + 100  # sane bounds
    assert a["score"] > 60

def test_tie_is_declared_too_close():
    rng = np.random.default_rng(0)
    p = np.clip(rng.normal(0.7, 0.05, 200), 0, 1)
    result = aggregate(PAYLOAD, [_shard("a", p), _shard("b", p + rng.normal(0, 0.002, 200))])
    assert result["winner"]["tooCloseToCall"] is True

def test_partial_results_still_aggregate():
    result = aggregate(PAYLOAD, [_shard("a", [0.8] * 200), _shard("b", [0.6] * 100)])
    assert result["cellsDone"] == 300
```

- [ ] **Step 2: Run** `cd services/resonance && uv run pytest` → FAIL. (First: `uv init` shape — write `pyproject.toml` by hand with `[project] name="resonance-worker" requires-python=">=3.12" dependencies=["numpy"]` and `[dependency-groups] dev=["pytest"]`.)

- [ ] **Step 3: Implement.** `cells.py`: chunk `range(0, audienceSize, shard_draws)`; `seed = (payload_seed * 1_000_003 + draw_start) % 2**31` — depends only on run seed + chunk, never creative/frame. `aggregate.py`: group shard `p` arrays by creative (concatenate across chunks, mean across frames per draw where both present — align by `draw_start`+index); score = `100 * mean`; `ci95` = percentile bootstrap (2000 resamples, seeded `default_rng(0)`) over per-draw values; winner = highest score, `tooCloseToCall` when the winner's lower CI bound ≤ runner-up's upper bound; `cellsDone` = total p-values received; include `audienceSize`, `model` (from payload or `""`), and zeroed `gpuSeconds`/`usdCost` for the caller to fill.

- [ ] **Step 4: Run** `uv run pytest` → PASS. **Step 5: Commit** `feat(resonance-worker): cell compiler and aggregation core`.

---

### Task 9: Modal app — trigger endpoint, sharded scorer, signed webhook back

**Files:**
- Create: `services/resonance/modal_app.py`
- Modify: `services/resonance/pyproject.toml` (add `modal` to dev deps for local deploys)
- Reference: `services/resonance/poc/steering_spike.py` (scorer mechanics), `services/resonance/poc/consistency_test.py` (frames)

**Interfaces:**
- Consumes: `compile_shards`, `aggregate` (Task 8); trigger payload `{ jobId, creatives, audienceSize, frames, seed }` signed per Task 2's scheme; env via Modal secret `resonance-platform`: `RESONANCE_TRIGGER_SECRET`, `RESONANCE_WEBHOOK_SECRET`, `PLATFORM_WEBHOOK_URL`.
- Produces: deployed Modal app `resonance-worker` with (a) `trigger` — `@modal.fastapi_endpoint(method="POST")` verifying the HMAC (same `${requestId}.${timestamp}.${body}` sha256 scheme, 300 s window) then `orchestrate.spawn(payload)` → 202; (b) `orchestrate` — CPU function: `compile_shards` → `Scorer.score_shard.map(shards, order_outputs=False)` → `aggregate` → sign + POST `WebhookPayload` to `PLATFORM_WEBHOOK_URL` with 3 retries (1 s/5 s/25 s backoff); on shard failures >10% posts `status: "failed"`, on ≤10% posts `"partial"`; (c) `Scorer` — `@app.cls(gpu="L40S", max_containers=8, retries=2)` porting the PoC readout (mid-layer hook, unit vectors from the shard's `seed`, ratio 0.5 × residual norm measured once per container, positive-frame prompts, full-vocab P(Yes)/P(No) at `max_tokens` position) returning `{ creative_id, frame, draw_start, p }`.

- [ ] **Step 1: Write `modal_app.py`.** Port the scorer body from `steering_spike.py` (layer discovery by module path, hook with per-row vectors, `enable_thinking=False`, label-id summation) into `Scorer.load()` (`@modal.enter()` — model load once per container) + `score_shard(shard)`. HMAC helpers in plain Python (`hmac.new(secret, f"{rid}.{ts}.{body}".encode(), sha256)`). Frames dict copied from `consistency_test.py` FRAMES minus `ignore`. Economics: track `gpu_seconds` per shard (`time.monotonic` around the batch loop) and sum in `orchestrate`; `usdCost = gpu_seconds * 1.95 / 3600`.

- [ ] **Step 2: Deploy and unit-smoke the trigger auth.** `uv run modal deploy modal_app.py`. Then from a scratch script, POST an unsigned body to the trigger URL → expect 401; POST a signed body with `audienceSize: 200` and a dummy `PLATFORM_WEBHOOK_URL` (e.g. a `modal.Dict`-backed echo or webhook.site) → expect 202 and, within ~2 min, a signed webhook whose signature verifies with `RESONANCE_WEBHOOK_SECRET`.

- [ ] **Step 3: Scale smoke.** `modal run modal_app.py::smoke --audience-size 20000` (add a `local_entrypoint` that calls `orchestrate.remote` directly with a stub webhook sink) — verify shard fan-out across containers in the Modal dashboard and wall-clock consistent with ~70 passes/s/GPU × containers.

- [ ] **Step 4: Record measured numbers** (wall clock, cost) in `services/resonance/README.md` (create it: deploy command, secret setup `modal secret create resonance-platform ...`, env contract, payload shape).

- [ ] **Step 5: Commit** `feat(resonance-worker): Modal app with signed trigger and webhook`.

---

### Task 10: Live end-to-end run through the platform

**Files:**
- Modify: `.env` (local only, not committed): `RESONANCE_RUNTIME_MODE=live`, `RESONANCE_TRIGGER_URL=<deployed>`, secrets matching the Modal secret.

- [ ] **Step 1:** With `pnpm dev` + Postgres up and the worker deployed: POST a real run (2 creatives, `audienceSize: 1000`) through `/api/resonance/runs`. Because localhost isn't reachable from Modal, either (a) run this step against a tunneled webhook URL (e.g. `cloudflared`/`ngrok` to localhost, set in the Modal secret), or (b) temporarily poll: confirm the job stays `processing`, then verify the webhook payload arrived by pointing `PLATFORM_WEBHOOK_URL` at the tunnel. Verify: `GET /api/resonance/runs/{jobId}` → `completed`, scores present, credits settled (check the wallet/usage rows or the commerce admin surface).
- [ ] **Step 2:** Document the tunnel caveat + production topology (public app URL works directly) in `services/resonance/README.md`. Commit docs.

---

### Task 11: Audience-size slider + minimal `/resonance` surface

**Files:**
- Create: `packages/ui/components/slider.tsx` (shadcn slider primitive — check the shadcn MCP registry per CLAUDE.md before writing; mirror an existing primitive's file style, e.g. `packages/ui/components/` neighbors)
- Create: `packages/resonance/components/AudienceSizeSlider.tsx`
- Create: `packages/resonance/components/RunComposer.tsx`
- Create: `apps/unified/app/resonance/page.tsx` (thin shell, atlas pattern: `apps/unified/app/brain/page.tsx`)
- Modify: `apps/unified/components/unified-sidebar.tsx` (add the platform-service nav entry)
- Test: `packages/resonance/tests/audience-slider.test.ts` (pure logic: scale mapping + persistence key)

**Interfaces:**
- Consumes: `AUDIENCE_MIN/MAX`, `estimateRun` (Task 1); `POST /api/resonance/runs`, `GET /api/resonance/runs/{jobId}` (Task 6).
- Produces: `audienceSliderScale(position: number): number` — log-scale mapping from slider position 0-100 to audience size 100 → 2,000,000, snapped to 2 significant digits; localStorage key `resonance.defaultAudienceSize`.

- [ ] **Step 1: Write the failing test** for the scale function:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audienceSliderScale } from '../components/audience-scale'

test('slider endpoints hit the bounds', () => {
  assert.equal(audienceSliderScale(0), 100)
  assert.equal(audienceSliderScale(100), 2_000_000)
})

test('midpoint is geometric, snapped to 2 significant digits', () => {
  const mid = audienceSliderScale(50)
  assert.ok(mid >= 13_000 && mid <= 15_000) // sqrt(100 * 2e6) ~ 14_142 -> 14_000
  assert.equal(mid, Number(mid.toPrecision(2)))
})

test('monotonic', () => {
  let prev = 0
  for (let p = 0; p <= 100; p += 5) {
    const v = audienceSliderScale(p)
    assert.ok(v >= prev); prev = v
  }
})
```

Put the pure function in `packages/resonance/components/audience-scale.ts` so it tests without React.

- [ ] **Step 2: Run to verify failure, implement** (`Math.exp(Math.log(100) + (p/100) * (Math.log(2e6) - Math.log(100)))` → `Number(x.toPrecision(2))`, clamp ends exactly), **run to green.**

- [ ] **Step 3: Build the components.** `AudienceSizeSlider`: shadcn slider + live label ("Audience: 14,000 · ~28,000 impressions · ~28 credits" via `estimateRun`), reads/writes the localStorage default, notes "Org-level default syncs when server settings land." `RunComposer`: two creative textareas (add-more up to 20), frame checkboxes (default 3), the slider, submit → POST → poll GET every 2 s → render scores (score, CI, winner banner, `tooCloseToCall` state) with skeletons while running and sonner toasts on errors. Follow `docs/design-language.md` §8 (PageHeader "Resonance", semantic tokens only).

- [ ] **Step 4: Mount** the page shell + sidebar entry. Manual check in stub mode: slider persists across reload, run completes, report renders. **Step 5: Commit** `feat(resonance): audience-size slider and run composer surface`.

---

### Task 12: Docs and project registration

**Files:**
- Modify: `CLAUDE.md` (add a Resonance section under the products/platform description)
- Modify: root `package.json` (`"test:resonance": "pnpm --filter @content-automation/resonance test"`, chained into `"test"`)
- Modify: `docs/architecture.md` (one paragraph: resonance is a platform service, Taicho shape, Modal worker external)

- [ ] **Step 1:** Write the CLAUDE.md section: what resonance is (logprob readout + activation steering on Modal), the three routes, stub vs live runtime modes, `services/resonance` deploy command, and the jobs-table lifecycle. **Step 2:** Add the test script and run root `pnpm test:resonance` + `pnpm test:architecture` one final time. **Step 3:** Commit `docs(resonance): register service in project docs and test chain`.

---

## Self-Review Notes

- **Spec coverage:** §3-§6 scoring/calibration → Tasks 8-9 (positive frames only, paired seeds; pairwise duels + content-free calibration are deliberately deferred — v1 M1-only per the consistency battery, noted in spec §9 confirmation). §7 architecture → Tasks 4-6, 9. §8 API → Tasks 5-6. §9 placement/stack → Tasks 1, 8. §10 economics → measured in Task 9 Step 3/4. §12 validation → sanity covered by worker tests; golden-set is an ongoing post-launch loop per business decision (not in this plan). §13 Phase 4 integrations (job-runner action, personas from outreach, graph write-back) — out of scope here, next plan.
- **Types:** `RunRequest`/`RunResult`/`WebhookPayload` defined once in Task 1 and consumed by name in Tasks 4, 5, 8, 9. `transitionJobStatus` signature identical in Tasks 3 and 5.
- **Known judgment calls:** capability reuses `research` (dedicated `resonance` capability = follow-up with plan edits); slider default persists client-side (no org-settings store exists); webhook replay safety via one-shot job transition instead of a receipts table (no new tables allowed).

---

### Task 13: Replace push-completion with poll-on-read (supersedes the webhook design)

**Context:** Modal's `spawn()` is already a durable task queue — the GPU container exits when its work is done and the result waits in Modal's control plane at zero GPU cost. The inbound webhook bought a public endpoint, inbound HMAC, replay receipts, an allowlist entry, a boundary registration, delivery retries, a stuck-job failure mode, and a localhost tunnel requirement. All of it is deleted here. Spec §8 (revised) is authoritative.

**Files:**
- Modify: `services/resonance/modal_app.py` (orchestrate returns instead of POSTs; add `result` endpoint; delete `_post_webhook`)
- Modify: `packages/resonance/server/runs.ts` (create stores `modalCallId`; get reconciles; delete `handleWebhook`)
- Modify: `packages/resonance/trigger/modal-trigger.ts` (`spawnRun` returns a call id; add `fetchResult`)
- Modify: `packages/resonance/tests/server.test.ts`, `tests/trigger.test.ts`
- Delete: `apps/unified/app/api/resonance/webhook/route.ts`, `packages/resonance/tests/route-boundary.test.ts`
- Modify: `apps/unified/proxy.ts`, `tests/architecture/network-webhook-boundaries.test.mjs`, `.env.example`, `ops/security/secret-inventory.json`, `scripts/validate-production-env.mjs`, `tests/architecture/production-env-contract.test.mjs`, `services/resonance/README.md`

**Interfaces:**
- Produces: `ResonanceTrigger.spawnRun(jobId, run): Promise<{ callId: string }>`; `ResonanceTrigger.fetchResult(callId): Promise<WebhookPayload | null>` (null ⇒ still running); `reconcileRun(jobId, deps?)` in `server/runs.ts`; Modal `GET /result?callId=…` → 202 `{status:'running'}` or 200 `WebhookPayload`.
- Unchanged: `signResonanceRequest`/`verifyResonanceRequest` (outbound only now), `transitionJobStatus`, `completeRun`'s settle/release logic, scorer, `resonance_core`.

- [ ] **Step 1: Modal side.** `orchestrate` returns the payload dict (delete `_post_webhook`, its retries, and the webhook env vars). Add `result_endpoint` as a second `@modal.fastapi_endpoint(method="GET")` that reads `callId`, verifies the same outbound HMAC scheme (query-string body = `callId`), then `modal.FunctionCall.from_id(call_id).get(timeout=0)`; `TimeoutError` ⇒ 202 `{"status":"running"}`, success ⇒ 200 with the payload, and a lookup failure ⇒ 404. Keep the malformed-input hardening already in `safe_verify_trigger_request`. `trigger` returns `{"jobId":…, "callId": call.object_id}` from `orchestrate.spawn(...)`.

- [ ] **Step 2: Trigger client.** `spawnRun` parses `callId` from the 202 body and returns it; add `fetchResult(callId)` doing a signed GET through `safeFetchPublicUrl` (202 ⇒ null, 200 ⇒ parsed payload, non-2xx ⇒ throw). `StubTrigger.spawnRun` returns a synthetic call id and keeps completing in-process. Tests: spawn returns the id; fetchResult maps 202→null and 200→payload; non-2xx throws.

- [ ] **Step 3: Server handlers.** `handleCreateRun` stores `{ modalCallId }` via `transitionJobStatus(org, jobId, ['queued'], 'processing', { result: { modalCallId } })`. New `reconcileRun(jobId, deps)`: read job; if not `processing` or no `modalCallId`, return as-is; else `fetchResult` — null ⇒ unchanged; payload ⇒ the existing `completeRun` path (one-shot transition + settle/release, unchanged). `handleGetRun` calls `reconcileRun` before returning, keeping its auth + RLS-scoped read. Delete `handleWebhook` and the bounded-read helper if now unused. Tests: reconcile leaves a running job untouched; reconcile completes and settles once; a second reconcile is a no-op (replay); fetchResult failure leaves the job `processing` and still returns 200 with `status: processing`.

- [ ] **Step 4: Delete the inbound surface.** Remove the webhook route file, its `proxy.ts` allowlist entry, the `network-webhook-boundaries.test.mjs` registration and the route-boundary test, and `RESONANCE_WEBHOOK_SECRET` from `.env.example`, the secret inventory, the prod validator, and the env-contract test. Run `pnpm secrets:inventory:check` and `pnpm test:architecture`.

- [ ] **Step 5: Verify.** `pnpm --filter @content-automation/resonance test`, `pnpm test:architecture`, `uv run pytest`; redeploy Modal; live check: signed trigger POST → 202 with a callId, immediate signed `GET /result` → 202 running, after completion → 200 with scores (paste transcript). Update `services/resonance/README.md`.

- [ ] **Step 6: Commit** `refactor(resonance): poll Modal for results instead of inbound webhook`.
