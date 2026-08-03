# Taicho Embed Pilot (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed the released `@taicho-ai/*` 0.1.0 packages as a library inside a platform-owned Bun "squad worker", and resurrect the first dead LangGraph action — topic extraction — as a Taicho agent run, end to end (route → Postgres queue → squad worker → `executeRun` → Neo4j write-back → existing Topics UI).

**Architecture:** A new workspace package `packages/squad` hosts the Taicho framework the way `App.tsx` does in the Taicho CLI, minus the terminal: it opens the workspace SQLite via `bun:sqlite`, builds `RunDeps` with `makeDeps` (reject-by-default approvals, logged `onStep`), and runs a Cascade-style poll loop over a `squad.tasks` Postgres queue. The pilot agent does **no I/O of its own**: the host fetches research items from Neo4j, injects them into the prompt, parses the agent's JSON block, and writes topics back through the existing repositories — agents reason, the host acts. The Next.js route that used to fire Bree→LangGraph now inserts a queue row.

**Tech Stack:** Bun 1.3.x (worker runtime — `bun:sqlite` requirement) · `@taicho-ai/framework` 0.1.0 (pinned exact) · Postgres (queue, house SKIP LOCKED pattern) · Neo4j via existing `@content-automation/content-generator` repositories · systemd on graph-server.

## Global Constraints

- Pin `@taicho-ai/*` at exactly `0.1.0` — pre-alpha, every bump is a review.
- The squad worker is the **only** consumer of `@taicho-ai/*`: no imports from `apps/*`, `products/cascade`, or the publishing engine (enforced by a test in Task 6).
- One Taicho workspace, one writer: only the squad worker process opens `squad/workspace`. Agent definitions (`agents/*/agent.md`) are committed; runtime dirs (`runs/`, `conversations/`, `tasks/`, `taicho.db*`) are gitignored.
- Agents never on the hot path (ADR): the queue is written by routes, drained by the worker; nothing in a request awaits a model.
- UI/design language untouched — the Topics page already polls; no UI work in this plan.
- **Deploy gate:** Tasks 1–6 are local. Task 7 (production) runs only after the user reviews and approves.
- Production model access: `ANTHROPIC_API_KEY` is deliberately unset in prod (see memory); the pilot runs locally with the key from `.env`. Enabling it in prod is a user decision inside Task 7.

---

### Task 1: Scaffold `packages/squad`

**Files:**
- Create: `packages/squad/package.json`
- Create: `packages/squad/tsconfig.json`
- Create: `packages/squad/.gitignore`
- Create: `packages/squad/workspace/agents/topic-extractor/agent.md`

**Interfaces:**
- Produces: workspace package `@content-automation/squad`; Taicho agent id `topic-extractor`.

- [ ] **Step 1: Write `packages/squad/package.json`**

```json
{
  "name": "@content-automation/squad",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "worker": "bun src/worker.ts",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  },
  "dependencies": {
    "@content-automation/content-generator": "workspace:*",
    "@content-automation/platform": "workspace:*",
    "@taicho-ai/agent": "0.1.0",
    "@taicho-ai/contracts": "0.1.0",
    "@taicho-ai/framework": "0.1.0",
    "pg": "^8.16.3"
  },
  "devDependencies": {
    "@types/bun": "^1.3.0",
    "@types/pg": "^8.15.6",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Write `packages/squad/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "baseUrl": "../..",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write `packages/squad/.gitignore`**

```gitignore
workspace/taicho.db*
workspace/runs/
workspace/conversations/
workspace/tasks/
workspace/artifacts/
workspace/plans/
workspace/schedules/
workspace/workflows/
workspace/kb/
```

- [ ] **Step 4: Write the pilot agent definition** `packages/squad/workspace/agents/topic-extractor/agent.md`

```markdown
---
id: topic-extractor
name: Topic extractor
model: claude-opus-4-8
tools: []
budgets:
  maxIterationsPerRun: 4
  maxCostPerRunUsd: 1
---

You extract durable content topics from research items.

You receive a JSON array of research items (title, excerpt, tags). Return ONLY a
fenced json block containing an array of topics:

```json
[{ "displayName": "…", "canonicalName": "kebab-case", "description": "one sentence" }]
```

Rules: 3–12 topics; canonicalName is unique kebab-case; merge near-duplicates;
never invent topics absent from the research.
```

- [ ] **Step 5: Install and verify resolution**

Run: `cd /Users/rajeshsharma/Documents/Works/Personal/content-automation && pnpm install`
Expected: lockfile gains `@taicho-ai/*@0.1.0`; no peer warnings that block.

- [ ] **Step 6: Commit**

```bash
git add packages/squad pnpm-lock.yaml
git commit -m "Scaffold squad worker package embedding @taicho-ai 0.1.0"
```

---

### Task 2: Postgres queue (schema + repository), TDD

**Files:**
- Create: `packages/squad/src/schema.ts`
- Create: `packages/squad/src/queue.ts`
- Test: `packages/squad/src/queue.test.ts`

**Interfaces:**
- Produces: `ensureSquadSchema(pool)`, `enqueueSquadTask(pool, {action, payload})`, `claimSquadTask(client)` (SKIP LOCKED, `pending→running`), `completeSquadTask(pool, id, result)`, `failSquadTask(pool, id, attempts, error)` (backoff 60s/300s/1800s, max 3 → `failed`).
- Consumes: `pg` Pool; env `POSTGRES_*`/`DATABASE_URL` (same resolution as `products/cascade/data/pool.ts` — copy that function, schema name `squad`, override `SQUAD_SCHEMA`).

- [ ] **Step 1: Write the failing test** `queue.test.ts` — mirror `products/content-generator/tests/publishing-engine.test.ts` structure: `SQUAD_SCHEMA=squad_test`, fresh-schema helper, cover: enqueue→claim claims oldest pending and marks running; SKIP LOCKED disjoint claims from two clients; complete stores result; fail backs off then lands `failed` at attempt 3.

Run: `cd packages/squad && set -a; . ../../.env; set +a; POSTGRES_HOST=localhost SQUAD_SCHEMA=squad_test bun test src/queue.test.ts`
Expected: FAIL (modules don't exist).

- [ ] **Step 2: Implement `schema.ts`** — one table:

```sql
CREATE TABLE IF NOT EXISTS ${schema}.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_squad_tasks_due ON ${schema}.tasks (status, created_at);
```

- [ ] **Step 3: Implement `queue.ts`** per the interface above (claim = `SELECT … WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`, then `UPDATE … SET status='running', claimed_at=now()`).

- [ ] **Step 4: Run tests to green**, then **Step 5: Commit** `git commit -m "Squad queue: schema + SKIP LOCKED repository"`

---

### Task 3: Taicho host module

**Files:**
- Create: `packages/squad/src/host.ts`
- Test: `packages/squad/src/host.test.ts`

**Interfaces:**
- Produces: `createSquadHost(wsDir?)` → `{ deps: RunDeps, runAgent(agentId, userText): Promise<{ finalText: string, runId: string }> }`.
- Consumes: `@taicho-ai/framework` (`makeDeps`, `executeRun`, roster/agent loading, `openDb`-equivalent from `@taicho-ai/framework/store/db`), `bun:sqlite`.

- [ ] **Step 1: Failing test** — `createSquadHost` with a **stub model** injected (a `Model` whose `stream` yields a fixed text; copy the shape Taicho's own `run.test.ts` uses with `MockLanguageModelV3`) runs agent `topic-extractor` and returns the stub text; approvals: assert a privileged request resolves `reject`.
- [ ] **Step 2: Implement `host.ts`**: resolve `wsDir` (default `packages/squad/workspace`, override `SQUAD_WS`); open the DB exactly as Taicho's CLI does (import its `store/db` open + migrate helpers via `@taicho-ai/framework/store/db`); load the agent roster from `agents/`; build model from `ANTHROPIC_API_KEY` via framework's `buildModel`/resolver with model pinned by the agent.md; `makeDeps({ ws, db, model, requestApproval: async (r) => { log(r); return { type: "reject" }; }, onStep: line => log(line) })`; `runAgent` assembles `[{ role: "user", content: userText }]`, calls `executeRun(deps, { agent, messages, triggeredBy: "squad" })`, returns final text + runId.
- [ ] **Step 3: Green**, **Step 4: Commit** `git commit -m "Squad host: taicho executeRun wiring with injected model + reject-all approvals"`

*Note for the implementer: exact import paths for db-open/roster come from reading `packages/cli/src/index.tsx` in the taicho repo (pinned 0.1.0 = commit `6165b66`); the framework exposes internals via the `./*` subpath exports. If an internal path is not importable from the published package, vendor the ~20-line db-open into `host.ts` and file it as feedback to the Taicho team.*

---

### Task 4: Topic-extraction action (host does I/O)

**Files:**
- Create: `packages/squad/src/actions/extract-topics.ts`
- Test: `packages/squad/src/actions/extract-topics.test.ts`

**Interfaces:**
- Produces: `runExtractTopics(host, pool): Promise<{ created: number }>` — fetch research items (existing `research-repository` list function from `@content-automation/content-generator`), inject as JSON into the prompt, parse the agent's fenced json block (regex + JSON.parse + shape-validate), upsert via existing `topic-repository` create/upsert function, skipping topics whose `canonicalName` already exists.
- Consumes: Task 3's `runAgent`; content-generator repositories (read their signatures before writing — do not guess).

- [ ] **Step 1: Failing test** — stub `runAgent` returning a fixed fenced json with 2 topics (one duplicate of an existing canonicalName); assert exactly 1 created, duplicate skipped, malformed JSON → throws with the raw text in the error.
- [ ] **Step 2: Implement** (JSON extraction identical in spirit to the platform's existing regex-parse pattern).
- [ ] **Step 3: Green**, **Step 4: Commit** `git commit -m "Squad action: topic extraction — agent reasons, host does the I/O"`

---

### Task 5: Worker loop + route rewire

**Files:**
- Create: `packages/squad/src/worker.ts`
- Modify: `apps/content-generator/app/api/content/topics/generate/route.ts` (read it first — mirror its current response shape)
- Modify: root `package.json` (script `squad:worker`)

**Interfaces:**
- Produces: `bun src/worker.ts` poll loop (5s interval, graceful SIGINT/SIGTERM — copy the Cascade worker shape); action registry `{ "extract_topics": runExtractTopics }`; route now calls `ensureSquadSchema` + `enqueueSquadTask(pool, { action: "extract_topics", payload: {} })` and returns its existing job-accepted response shape (UI keeps polling topics exactly as today).

- [ ] **Step 1: Implement `worker.ts`** (claim → dispatch to registry → complete/fail; unknown action → fail immediately; log every transition).
- [ ] **Step 2: Rewire the route** — replace the Bree `scheduleJob('extract-topics.js')` call with the enqueue; delete nothing else (Bree stays for the other 7 actions until their own migrations).
- [ ] **Step 3: Root script** `"squad:worker": "set -a; . ./.env; set +a; POSTGRES_HOST=localhost NEO4J_URI=bolt://localhost:7687 bun --cwd packages/squad src/worker.ts"` — matching the house env pattern.
- [ ] **Step 4: Live smoke (local)**: `pnpm squad:worker` in background → click "Generate topics" on the local Topics page (or curl the route as owner) → watch worker log claim + run + topic count → Topics page shows new rows. Screenshot for the review.
- [ ] **Step 5: Commit** `git commit -m "Squad worker loop; topics/generate route enqueues instead of Bree->LangGraph"`

---

### Task 6: Full verification + architecture guard

**Files:**
- Create: `tests/architecture/squad.test.mjs`
- Test: everything

- [ ] **Step 1: Architecture guard** — assert no file under `apps/`, `products/cascade/`, or `products/content-generator/publishing/` imports `@taicho-ai/` (grep-based, same style as existing architecture tests); assert `packages/squad/package.json` pins exact `0.1.0` (no `^`).
- [ ] **Step 2: Run every suite**: `pnpm test` (architecture + auth + cascade), `POSTGRES_HOST=localhost … bun test` in packages/squad, `pnpm build` (turbo — squad has no build task; unaffected apps must stay green).
Expected: all green.
- [ ] **Step 3: Commit** `git commit -m "Architecture guard: taicho stays inside the squad worker"`

---

### Task 7: Production deploy — **GATED: user review required before starting**

**Files:**
- Server only (no repo changes beyond what's committed).

- [ ] **Step 1: Show the user** the local smoke screenshot + diff summary; get explicit go.
- [ ] **Step 2: Install Bun on graph-server**: `curl -fsSL https://bun.sh/install | bash` (root; verify `bun --version`).
- [ ] **Step 3: Pull + install** (`git pull && pnpm install --frozen-lockfile`).
- [ ] **Step 4: Decide model access with the user**: pilot in prod requires `ANTHROPIC_API_KEY` in `/root/content-automation/.env` (deliberately unset until now). Without it, deploy the worker disabled and stop here.
- [ ] **Step 5: systemd unit** `content-automation-squad` (WorkingDirectory `/root/content-automation/packages/squad`, `ExecStart=/root/.bun/bin/bun src/worker.ts`, `EnvironmentFile=/root/content-automation/.env`, `Restart=always`) — enable + start; rebuild/restart unified for the route change.
- [ ] **Step 6: Verify live**: trigger Generate topics as owner on app.vectornotion.com; journalctl shows the run; Topics page gains rows; screenshot to the user.

---

## Out of scope (Phase 2+, tracked in the gap dossier)

Chat/streaming in Next routes (blocked on Node compat or the storage port — Taicho team), the `onStep`→AI-SDK adapter, named sessions, output schemas (B7 replaces this plan's fenced-json parsing), memory adapter → Neo4j, remaining 7 actions, Bree/Mastra retirement.
