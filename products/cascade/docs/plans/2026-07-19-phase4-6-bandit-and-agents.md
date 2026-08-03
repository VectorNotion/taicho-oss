# Cascade Phases 4–6: Bandit, Agent Generation, Closed Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Authoring note:** same-session inline execution by the plan author; repo-pattern boilerplate is specified as deltas, novel logic in full.

**Goal:** Thompson-sampling variant allocation on the hot path (Phase 4), offline agent generation of variants behind a validation gate with human approval (Phase 5), and an optimizer that retires losers and breeds the next generation under human-set limits (Phase 6).

**Architecture:** Variants attach to email steps: when a step has `active` variants, the tick picks one by Thompson sampling over per-variant counters and stamps `sends.variant_id`; the send loop composes from the variant's email. Counters (`variant_stats`) update incrementally in the same transactions that record sends/opens/clicks/interests. The agent layer lives in `products/cascade/agent/` and is only ever invoked offline (scripts/cron), never by the engine: a content agent generates slot-fill variants from a briefing plus the synced asset library, a template agent generates MJML layouts, and every artifact passes the validation gate (offers source of truth, asset refs resolve, MJML compiles) before it can be approved. Autonomy is a stored setting: `approve_all` (default) requires `approveVariant`; `auto_activate` lets the optimizer activate validated variants itself, capped at 4 arms.

**Tech Stack:** existing stack. LLM calls via fetch to the Anthropic Messages API behind an `LlmClient` interface with a `StubLlm` for tests. No new packages.

## Global Constraints

- All prior global constraints and invariants apply. **Agents never on the hot path**: nothing in tick/send-loop/ingest may call `LlmClient`; generation and optimization run only via `scripts/` entry points.
- Bandit arm cap: **max 4 active variants per (step, segment)** — enforced at activation, not trusted from callers.
- Segments: single default segment `"all"` in this phase (the column exists; multi-segment learning is future work).
- Reward signal: **interest** per send (the funnel-progression event). Opens/clicks are recorded but not the optimization target.
- Every generated artifact starts `draft`; only `validateVariant` moves it to `validated`; only `approveVariant`/auto-activation moves it to `active`. No other path may set `active`.
- Randomness is injectable: engine/optimizer functions take `rng?: () => number` (default `Math.random`) so tests are deterministic.
- LLM model from `CASCADE_MODEL` ?? `MODEL_NAME` ?? `claude-sonnet-5`; key from `ANTHROPIC_API_KEY`. StubLlm in all tests.

---

### Task 1: Schema v3 and variant repository

**Files:**
- Modify: `products/cascade/data/schema.ts`
- Modify: `products/cascade/domain/types.ts`
- Create: `products/cascade/data/variant-repository.ts`
- Test: extend `products/cascade/tests/schema.test.ts` table list; new `products/cascade/tests/variants.test.ts`

DDL appended (idempotent):

```sql
CREATE TABLE IF NOT EXISTS variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id UUID NOT NULL REFERENCES funnel_steps(id),
  segment TEXT NOT NULL DEFAULT 'all',
  email_id UUID NOT NULL REFERENCES emails(id),
  generation INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','active','retired')),
  created_by TEXT NOT NULL DEFAULT 'human',
  validation_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS variant_stats (
  variant_id UUID PRIMARY KEY REFERENCES variants(id),
  sends INT NOT NULL DEFAULT 0,
  opens INT NOT NULL DEFAULT 0,
  clicks INT NOT NULL DEFAULT 0,
  interests INT NOT NULL DEFAULT 0,
  conversions INT NOT NULL DEFAULT 0,
  revenue NUMERIC NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  claim TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS cascade_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
ALTER TABLE sends ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES variants(id);
```

**`variant-repository.ts` produces:**
- `createVariant(pool, { stepId, emailId, segment?, generation?, createdBy? }): Promise<{ id: string }>` — also inserts the zeroed `variant_stats` row.
- `activateVariant(pool, variantId): Promise<void>` — only from `validated`; throws `"arm cap exceeded"` if 4 already active for (step, segment); throws if variant not validated.
- `retireVariant(pool, variantId): Promise<void>`
- `listActiveVariants(db: Pool | PoolClient, stepId: string, segment?: string): Promise<Array<{ id: string; emailId: string; sends: number; interests: number }>>` (JOIN variant_stats)
- `markValidated(pool, variantId)` / `markRejected(pool, variantId, error)`
- `getSetting<T>(pool, key, fallback: T): Promise<T>` / `setSetting(pool, key, value): Promise<void>`

Tests: activation cap (5th activation throws), activation requires validated, listActiveVariants returns stats. Commit `"Add cascade variant, offer, and settings schema"`.

---

### Task 2: Thompson sampling

**Files:**
- Create: `products/cascade/engine/bandit.ts`
- Test: `products/cascade/tests/bandit.test.ts`

Full implementation:

```ts
export interface Arm {
  id: string;
  sends: number;
  interests: number;
}

/** Marsaglia–Tsang gamma sampler (shape >= 1 via boost for shape < 1). */
function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    const u = rng();
    return sampleGamma(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      // Box–Muller normal from two uniforms
      const u1 = rng() || 1e-12;
      const u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng() || 1e-12;
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

/**
 * Thompson sampling over interest-per-send: sample Beta(1+interests,
 * 1+sends-interests) per arm, pick the max. Explores evenly when data is
 * thin, concentrates on winners as evidence accumulates.
 */
export function thompsonPick(arms: Arm[], rng: () => number = Math.random): Arm {
  if (arms.length === 0) throw new Error("thompsonPick needs at least one arm");
  let best = arms[0];
  let bestSample = -1;
  for (const arm of arms) {
    const sample = sampleBeta(1 + arm.interests, 1 + Math.max(0, arm.sends - arm.interests), rng);
    if (sample > bestSample) {
      bestSample = sample;
      best = arm;
    }
  }
  return best;
}
```

Tests: (a) statistical: arms A(1000 sends, 10 interests) vs B(1000 sends, 100 interests) — over 500 picks with `Math.random`, B chosen > 80%; (b) cold start: two arms with zero data both get picked over 200 trials (> 20% each); (c) single arm returned as-is. Commit `"Add Thompson sampling bandit"`.

---

### Task 3: Hot-path integration — allocation and stats

**Files:**
- Modify: `products/cascade/engine/tick.ts` (email step: pick active variant, stamp `sends.variant_id`; `runTick` accepts `rng`)
- Modify: `products/cascade/engine/send-loop.ts` (claim exposes `variant_id` + variant email; compose from it; on success `variant_stats.sends + 1`)
- Modify: `products/cascade/engine/ingest.ts` (open/click/interest also bump `variant_stats` via the send's variant)
- Test: `products/cascade/tests/allocation.test.ts`

Semantics:
- Tick email step, after the suppression gate: `listActiveVariants(client, stepId)` — if non-empty, `thompsonPick(arms, rng)` and include `variant_id` in the `sends` INSERT (both the queued and skipped inserts keep working when no variants exist: `variant_id` NULL).
- Send loop claim adds `snd.variant_id` and `LEFT JOIN variants v ON v.id = snd.variant_id`, selecting `v.email_id AS variant_email_id`; compose uses `variant_email_id ?? config.emailId ?? inline`. On sent: `UPDATE variant_stats SET sends = sends + 1 WHERE variant_id = $1` (when variant_id present).
- Ingest: after inserting open/click/interest events, `UPDATE variant_stats SET <col> = <col> + 1 FROM sends WHERE sends.id = $sendId AND variant_stats.variant_id = sends.variant_id`.

Test (Phase 4 exit criterion, deterministic): step with two validated+activated variants (emails "control"/"challenger"); seed `variant_stats` (control 200/2, challenger 200/40); enroll 40 contacts; `runTick(pool, { rng })` with a real `Math.random`; count `sends.variant_id` — challenger receives > 60% of the 40 sends. Second test: interest click on a variant send bumps `variant_stats.interests`. Commit `"Allocate email variants with Thompson sampling on the hot path"`.

---

### Task 4: LLM client and generation agents

**Files:**
- Create: `products/cascade/agent/llm.ts`
- Create: `products/cascade/agent/content-agent.ts`
- Create: `products/cascade/agent/template-agent.ts`
- Test: `products/cascade/tests/agents.test.ts`

**`llm.ts`:** `interface LlmClient { complete(system: string, prompt: string): Promise<string> }`; `class AnthropicLlm implements LlmClient` (fetch `https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, body `{ model, max_tokens: 2048, system, messages: [{ role: "user", content: prompt }] }`, returns first text block); `class StubLlm implements LlmClient` (constructor takes canned responses array, records prompts, returns in order).

**`content-agent.ts` produces** `generateContentVariants(pool, llm, args: { stepId: string; count: number; briefing: string; templateId: string; fromEmail: string; interestUrl?: string; generation?: number; createdBy?: string }): Promise<Array<{ variantId: string; emailId: string }>>`:
1. Loads asset list (`SELECT source_id, type, title, url FROM assets ORDER BY synced_at DESC LIMIT 20`) and active offers.
2. Prompt (verbatim skeleton): system `"You write email variants for a B2B funnel. Respond with ONLY a JSON array."`, user prompt includes briefing, the asset list (`source_id: title`), allowed offer claims, and: `Return a JSON array of ${count} objects: {"subject": string, "preheader": string, "slots": {"hero": string, "body": string, "cta": string}}. Reference assets only via {{assets.[source-id].title}} / {{assets.[source-id].url}}. Never invent discounts, prices, or offers beyond the allowed claims.`
3. Parses JSON (strip codefences; on parse failure throw `"agent returned unparseable JSON"`).
4. For each item: `createContent` (name `agent-<stepId>-g<generation>-<i>-<Date.now()>`), `createEmail` (given template/from/interestUrl), `createVariant` (`createdBy: "agent"`, given generation). Returns ids. **All rows stay `draft`.**

**`template-agent.ts` produces** `generateTemplate(pool, llm, args: { name: string; briefing: string }): Promise<{ templateId: string }>`: prompts for MJML only (system `"You produce MJML email layouts. Respond with ONLY MJML."`; requirements in prompt: must contain `{{{slots.hero}}}`, `{{{slots.body}}}`, `{{{slots.cta}}}`, and a link `href="{{{unsubscribeUrl}}}"`); compiles with `mjml2html` (`validationLevel: "strict"` inside try/catch) and requires all four markers present, else throws `"generated template failed validation"`; then `createTemplate`.

Tests with StubLlm: generation creates N draft variants wired to content/emails; unparseable JSON throws; template agent rejects MJML missing the unsubscribe marker; template agent accepts a valid layout. Commit `"Add cascade content and template generation agents"`.

---

### Task 5: Validation gate and approval

**Files:**
- Create: `products/cascade/agent/validate.ts`
- Test: `products/cascade/tests/validation.test.ts`

**`validate.ts` produces** `validateVariant(pool, variantId): Promise<{ ok: boolean; errors: string[] }>`:
1. Load the variant's email bundle (template mjml, content slots+subject).
2. **Asset refs resolve:** every `{{assets.[X]...}}` / `{{assets.X...}}` reference in subject+slots is extracted (`/\{\{\{?assets\.\[?([^\].}]+)\]?\./g`) and must exist in `assets.source_id`.
3. **Offer claims:** scan subject+slots for claim patterns `/\b\d+\s?%\s?(?:off|discount)|free\b|\$\d+/gi`; every match must be a substring of some **active** offer's `claim` (case-insensitive). No offers table rows → any claim pattern fails.
4. **Template compiles:** `mjml2html` on the template (soft) must not throw and output must include an unsubscribe href (`{{{unsubscribeUrl}}}` in the mjml or `/u/` in compiled+slot content).
5. All pass → `markValidated`; else `markRejected(pool, variantId, errors.join("; "))`.

Also `approveVariant(pool, variantId): Promise<void>` — wraps `activateVariant` (validated → active, cap enforced); and `maybeAutoActivate(pool, variantId): Promise<boolean>` — reads setting `autonomy` (`"approve_all"` default): only activates when `"auto_activate"`.

Tests (Phase 5 exit checks): variant referencing a dangling asset → rejected with error naming the asset; variant claiming `"40% off"` with no matching active offer → rejected; same claim with a matching offer row → validated; approval activates and a 5th approval throws; `maybeAutoActivate` is a no-op under `approve_all` and activates under `auto_activate`. Commit `"Add cascade validation gate and approval flow"`.

---

### Task 6: Optimizer, closed-loop e2e, scripts, docs

**Files:**
- Create: `products/cascade/agent/optimizer.ts`
- Create: `products/cascade/scripts/generate.ts` (CLI: `--step <id> --count 3 --briefing "..." --template <id> --from <email>` via `process.argv` parsing with `node:util parseArgs`)
- Create: `products/cascade/scripts/optimize.ts`
- Modify: `products/cascade/package.json` scripts: `"agent:generate": "tsx scripts/generate.ts"`, `"agent:optimize": "tsx scripts/optimize.ts"`
- Modify: root `package.json`: `"cascade:optimize": "set -a; . ./.env; set +a; POSTGRES_HOST=localhost pnpm --filter @content-automation/cascade agent:optimize"`
- Modify: `products/cascade/index.ts` (export agent layer + bandit)
- Modify: `products/cascade/README.md` (status → all six phases; agent quickstart)
- Test: `products/cascade/tests/closed-loop.test.ts`

**`optimizer.ts` produces** `runOptimizer(pool, llm, opts?: { minSends?: number; retireFraction?: number; breedCount?: number; rng?: () => number }): Promise<{ retired: string[]; bred: string[] }>`:

For each step having >= 2 active variants (SQL GROUP BY): load arms with stats.
- **Retire:** among arms with `sends >= minSends` (default 50): compute interest rates; `best = max`; retire every arm with `rate < best * retireFraction` (default 0.5) — but never retire the last remaining arm.
- **Breed:** if any retirement happened (or fewer than 2 arms remain active), call the content agent once with a briefing built from the winner: winner subject + slots + its rate vs the losers' (prompt: `"Previous winner (interest rate X%): <subject/slots JSON>. Losers and rates: ... Write ${breedCount} NEW variants that keep the winning angle but vary subject and CTA."`), `generation = winnerGeneration + 1`, template/from copied from the winner's email. Validate each; auto-activate via `maybeAutoActivate` (so `approve_all` leaves them for human review — the dial).
- Returns retired variant ids and new (bred) variant ids.

**Closed-loop e2e test** (Phase 6 exit, all StubLlm + injected rng):
1. Seed template, two human variants A/B on a step, validate+approve both; set autonomy `auto_activate`; seed an active offer.
2. Simulate a generation: directly seed `variant_stats` (A: 100 sends, 2 interests; B: 100 sends, 30 interests).
3. `runOptimizer(pool, stub, { minSends: 50, retireFraction: 0.5, breedCount: 2 })` — StubLlm returns 2 valid variant JSONs referencing a real asset and no forbidden claims.
4. Assert: A retired; B still active; two new `agent`-created variants exist with `generation: 2`, status `active` (auto), stats rows zeroed; prompt captured by StubLlm contains B's subject (breeding from the winner).
5. Flip autonomy to `approve_all`, rerun with fresh stats forcing another retirement — assert bred variants stay `validated` (awaiting human), proving the dial.
6. Allocation sanity: `runTick` with the surviving arms sends to active variants only.

Also verify agents-off-hot-path invariant statically: `grep -r "LlmClient\|AnthropicLlm" products/cascade/engine/` returns nothing (assert in a small architecture test appended to `tests/closed-loop.test.ts` via `node:fs` readdir of `engine/` files checking none import `../agent/`).

Commit `"Add cascade optimizer and close the loop"`.

---

## Exit criteria → proof map

| Criterion | Proof |
|---|---|
| Bandit shifts traffic toward the higher-interest variant | Task 3 allocation test (challenger gets >60% with skewed stats) |
| Interest attribution per variant | Task 3 ingest increment test |
| Agent-generated variant passes validation, is approved, sends, stats flow back | Tasks 4+5 tests + Task 6 closed-loop e2e |
| Gate rejects invalid offer and dangling asset reference | Task 5 tests |
| Full generate → allocate → measure → regenerate cycle without human copywriting, under limits | Task 6 closed-loop e2e (auto_activate mode, arm cap, thresholds) |
| Approval dial from "approve everything" to "approve limits" | Task 6 autonomy flip assertion |
| Agents never on the hot path | Task 6 static check + code review |
