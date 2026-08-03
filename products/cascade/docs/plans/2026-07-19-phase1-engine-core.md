# Cascade Phase 1: Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic funnel engine in `products/cascade`: Postgres schema, enrollment state machine, `SKIP LOCKED` tick loop, `delay` and `email` steps — one funnel delivering a scheduled send end to end, with no AI and no external transport.

**Architecture:** A new workspace package `@content-automation/cascade` owning tables in a dedicated Postgres schema (`cascade`) inside the existing `langgraph` database. A worker process polls `enrollments` for due rows, claims them with `FOR UPDATE SKIP LOCKED`, executes the current step in one transaction, and advances the cursor. Email transport in Phase 1 is a `LogMailer` behind the `Mailer` interface (real providers arrive in Phase 2). Design references: `products/cascade/docs/architecture.md`, `products/cascade/docs/data-model.md`.

**Tech Stack:** TypeScript, `pg` (node-postgres), `tsx` for scripts/tests, `node:test` runner, Postgres 16 from the repo's `docker-compose.yml`.

## Global Constraints

- Package name: `@content-automation/cascade`, located at `products/cascade/` (workspace already matches `products/*`).
- Dependencies: `pg@^8.16.3` only. Dev: `@types/node@^20`, `@types/pg@^8.15.6`, `tsx@^4.20.6`, `typescript@^5`. No ORM, no queue library, no other new dependencies.
- All Cascade tables live in Postgres schema `cascade` (tests use `cascade_test` via the `CASCADE_SCHEMA` env var). Never create tables in `public`.
- DB connection config copies the pattern of `packages/auth/database.ts`: `DATABASE_URL` if set, else `POSTGRES_HOST/PORT/USER/PASSWORD/DB` with database default `langgraph`, port default `5432`.
- Invariants from `products/cascade/CLAUDE.md`: nothing in the tick/send path calls a model API or any foreign store; every email send path checks `subscription_status`; `sends` is UNIQUE on `(enrollment_id, step_id)`; retries must be idempotent.
- Tests are integration tests against the compose Postgres. `docker compose up -d` must be running. Test files: `node --import tsx --test tests/*.test.ts`.
- Commit messages follow repo style: plain imperative ("Add cascade engine schema"), no `feat:` prefixes. Every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- All commands below run from the repo root `/Users/rajeshsharma/Documents/Works/Personal/content-automation` unless stated otherwise.

---

### Task 1: Package scaffold

**Files:**
- Create: `products/cascade/package.json`
- Create: `products/cascade/tsconfig.json`
- Create: `products/cascade/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: an installable workspace package `@content-automation/cascade` that later tasks add files to. `index.ts` starts empty and is filled in Task 6.

- [ ] **Step 1: Create `products/cascade/package.json`**

```json
{
  "name": "@content-automation/cascade",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "db:migrate": "tsx scripts/migrate.ts",
    "seed:demo": "tsx scripts/seed-demo.ts",
    "worker": "tsx engine/worker.ts",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test tests/*.test.ts"
  },
  "dependencies": {
    "pg": "^8.16.3"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/pg": "^8.15.6",
    "tsx": "^4.20.6",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Create `products/cascade/tsconfig.json`** (mirrors `packages/auth/tsconfig.json`, minus DOM libs)

```json
{
  "extends": "../../packages/config/typescript/next.json",
  "compilerOptions": {
    "lib": ["esnext"],
    "noEmit": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `products/cascade/index.ts`**

```ts
// Public API of @content-automation/cascade. Populated as the engine lands.
export {};
```

- [ ] **Step 4: Install and verify the workspace picks the package up**

Run: `pnpm install`
Expected: completes without error; `pnpm-lock.yaml` gains an importer entry for `products/cascade`.

Run: `pnpm --filter @content-automation/cascade typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add products/cascade/package.json products/cascade/tsconfig.json products/cascade/index.ts pnpm-lock.yaml
git commit -m "Add cascade workspace package scaffold"
```

---

### Task 2: Pool, schema DDL, and migrate script

**Files:**
- Create: `products/cascade/data/pool.ts`
- Create: `products/cascade/data/schema.ts`
- Create: `products/cascade/scripts/migrate.ts`
- Create: `products/cascade/tests/helpers.ts`
- Test: `products/cascade/tests/schema.test.ts`

**Interfaces:**
- Consumes: Task 1 package scaffold.
- Produces:
  - `getCascadePool(): Pool` — lazy singleton, search_path pinned to the cascade schema.
  - `schemaName(): string` — `process.env.CASCADE_SCHEMA ?? "cascade"`.
  - `ensureCascadeSchema(pool: Pool): Promise<void>` — idempotent DDL for all six tables.
  - `dropCascadeSchema(pool: Pool): Promise<void>` — `DROP SCHEMA ... CASCADE` (test cleanup).
  - `freshSchema(): Promise<Pool>` (tests/helpers.ts) — sets `CASCADE_SCHEMA=cascade_test`, drops and recreates it, returns the pool.

- [ ] **Step 1: Write the failing test** — `products/cascade/tests/schema.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { ensureCascadeSchema } from "../data/schema";
import { schemaName } from "../data/pool";

test("ensureCascadeSchema creates all engine tables", async () => {
  const pool = await freshSchema();
  const res = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
    [schemaName()],
  );
  assert.deepEqual(
    res.rows.map((r) => r.table_name),
    ["contacts", "enrollments", "events", "funnel_steps", "funnels", "sends"],
  );
});

test("ensureCascadeSchema is idempotent", async () => {
  const pool = await freshSchema();
  await ensureCascadeSchema(pool); // second run must not throw
});
```

And the helper — `products/cascade/tests/helpers.ts`:

```ts
process.env.CASCADE_SCHEMA = "cascade_test";

import type { Pool } from "pg";
import { getCascadePool } from "../data/pool";
import { dropCascadeSchema, ensureCascadeSchema } from "../data/schema";

/** Drop and recreate the cascade_test schema. Call at the top of every test. */
export async function freshSchema(): Promise<Pool> {
  const pool = getCascadePool();
  await dropCascadeSchema(pool);
  await ensureCascadeSchema(pool);
  return pool;
}
```

(Note: the env assignment runs after module imports are evaluated, which is safe because `getCascadePool` reads the env lazily on first call — do not convert the pool to a module-level constant.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @content-automation/cascade test`
Expected: FAIL — cannot find module `../data/pool` / `../data/schema`.

- [ ] **Step 3: Implement `products/cascade/data/pool.ts`**

```ts
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __cascadePool: Pool | undefined;
}

export function schemaName(): string {
  return process.env.CASCADE_SCHEMA ?? "cascade";
}

function databaseConfig() {
  const options = `-csearch_path=${schemaName()}`;
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, options };
  }
  return {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
    database: process.env.POSTGRES_DB ?? "langgraph",
    options,
  };
}

export function getCascadePool(): Pool {
  if (!globalThis.__cascadePool) {
    globalThis.__cascadePool = new Pool(databaseConfig());
  }
  return globalThis.__cascadePool;
}
```

- [ ] **Step 4: Implement `products/cascade/data/schema.ts`**

```ts
import type { Pool } from "pg";
import { schemaName } from "./pool";

/** Idempotent DDL for the cascade engine. Mirrors docs/data-model.md (Phase 1 subset). */
export async function ensureCascadeSchema(pool: Pool): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName()}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS funnels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      version INT NOT NULL DEFAULT 1,
      open_ended BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS funnel_steps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      funnel_id UUID NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
      position INT NOT NULL CHECK (position >= 1),
      type TEXT NOT NULL CHECK (type IN ('email', 'delay')),
      config JSONB NOT NULL DEFAULT '{}',
      UNIQUE (funnel_id, position)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      attributes JSONB NOT NULL DEFAULT '{}',
      timezone TEXT,
      subscription_status TEXT NOT NULL DEFAULT 'subscribed'
        CHECK (subscription_status IN ('subscribed', 'unsubscribed', 'suppressed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      funnel_id UUID NOT NULL REFERENCES funnels(id),
      contact_id UUID NOT NULL REFERENCES contacts(id),
      current_step_id UUID REFERENCES funnel_steps(id),
      state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'completed', 'stopped')),
      next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS enrollments_due_idx
      ON enrollments (next_run_at) WHERE state = 'active'
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sends (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      enrollment_id UUID NOT NULL REFERENCES enrollments(id),
      step_id UUID NOT NULL REFERENCES funnel_steps(id),
      provider_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (enrollment_id, step_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      contact_id UUID NOT NULL REFERENCES contacts(id),
      enrollment_id UUID REFERENCES enrollments(id),
      send_id UUID REFERENCES sends(id),
      type TEXT NOT NULL CHECK (type IN (
        'queued', 'sent', 'delivered', 'open', 'click',
        'bounce', 'complaint', 'unsub', 'interest', 'convert'
      )),
      value NUMERIC,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function dropCascadeSchema(pool: Pool): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS ${schemaName()} CASCADE`);
}
```

- [ ] **Step 5: Implement `products/cascade/scripts/migrate.ts`** (mirrors `packages/auth/scripts/migrate.ts`)

```ts
import { getCascadePool, schemaName } from "../data/pool";
import { ensureCascadeSchema } from "../data/schema";

const pool = getCascadePool();
await ensureCascadeSchema(pool);
console.log(`Cascade schema '${schemaName()}' is current.`);
await pool.end();
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `docker compose up -d` (if not already running), then `pnpm --filter @content-automation/cascade test`
Expected: 2 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add products/cascade/data products/cascade/scripts/migrate.ts products/cascade/tests
git commit -m "Add cascade engine schema and data layer"
```

---

### Task 3: Domain types and repositories

**Files:**
- Create: `products/cascade/domain/types.ts`
- Create: `products/cascade/data/funnel-repository.ts`
- Create: `products/cascade/data/contact-repository.ts`
- Create: `products/cascade/data/enrollment-repository.ts`
- Test: `products/cascade/tests/enrollment.test.ts`

**Interfaces:**
- Consumes: `getCascadePool`, `freshSchema` from Task 2.
- Produces:
  - Types: `Funnel`, `FunnelStep`, `Contact`, `Enrollment`, `StepType`, `StepInput`, `EmailStepConfig`, `DelayStepConfig`, `EnrollmentState`.
  - `createFunnel(pool, input: { name: string; steps: StepInput[] }): Promise<{ funnel: Funnel; steps: FunnelStep[] }>` — steps get positions 1..n in array order.
  - `createContact(pool, input: { email: string; timezone?: string; subscriptionStatus?: Contact["subscriptionStatus"] }): Promise<Contact>`
  - `enrollContact(pool, funnelId: string, contactId: string): Promise<Enrollment>` — cursor at position-1 step, `next_run_at = now()`, state `active`. Throws if the funnel has no steps.

- [ ] **Step 1: Write `products/cascade/domain/types.ts`**

```ts
export type StepType = "email" | "delay";

export interface EmailStepConfig {
  subject: string;
  body: string;
}

export interface DelayStepConfig {
  /** Non-negative. Phase 1 ignores timezone/quiet hours (Phase 2 concern). */
  seconds: number;
}

export type StepInput =
  | { type: "email"; config: EmailStepConfig }
  | { type: "delay"; config: DelayStepConfig };

export interface Funnel {
  id: string;
  name: string;
  version: number;
  openEnded: boolean;
}

export interface FunnelStep {
  id: string;
  funnelId: string;
  position: number;
  type: StepType;
  config: EmailStepConfig | DelayStepConfig;
}

export interface Contact {
  id: string;
  email: string;
  timezone: string | null;
  subscriptionStatus: "subscribed" | "unsubscribed" | "suppressed";
}

export type EnrollmentState = "active" | "completed" | "stopped";

export interface Enrollment {
  id: string;
  funnelId: string;
  contactId: string;
  currentStepId: string | null;
  state: EnrollmentState;
  nextRunAt: Date;
}
```

- [ ] **Step 2: Write the failing test** — `products/cascade/tests/enrollment.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";

test("createFunnel assigns ordered positions", async () => {
  const pool = await freshSchema();
  const { funnel, steps } = await createFunnel(pool, {
    name: "onboarding",
    steps: [
      { type: "email", config: { subject: "hi", body: "welcome" } },
      { type: "delay", config: { seconds: 60 } },
      { type: "email", config: { subject: "again", body: "follow-up" } },
    ],
  });
  assert.equal(funnel.name, "onboarding");
  assert.deepEqual(steps.map((s) => s.position), [1, 2, 3]);
  assert.deepEqual(steps.map((s) => s.type), ["email", "delay", "email"]);
});

test("enrollContact starts active at the first step, due immediately", async () => {
  const pool = await freshSchema();
  const { funnel, steps } = await createFunnel(pool, {
    name: "onboarding",
    steps: [{ type: "email", config: { subject: "hi", body: "welcome" } }],
  });
  const contact = await createContact(pool, { email: "lead@example.com" });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);
  assert.equal(enrollment.state, "active");
  assert.equal(enrollment.currentStepId, steps[0].id);
  assert.ok(enrollment.nextRunAt.getTime() <= Date.now());
});

test("enrollContact rejects a funnel with no steps", async () => {
  const pool = await freshSchema();
  const { funnel } = await createFunnel(pool, { name: "empty", steps: [] });
  const contact = await createContact(pool, { email: "lead2@example.com" });
  await assert.rejects(() => enrollContact(pool, funnel.id, contact.id), /has no steps/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @content-automation/cascade test`
Expected: FAIL — cannot find module `../data/funnel-repository`.

- [ ] **Step 4: Implement the repositories**

`products/cascade/data/funnel-repository.ts`:

```ts
import type { Pool } from "pg";
import type { Funnel, FunnelStep, StepInput } from "../domain/types";

export async function createFunnel(
  pool: Pool,
  input: { name: string; steps: StepInput[] },
): Promise<{ funnel: Funnel; steps: FunnelStep[] }> {
  const funnelRes = await pool.query(
    `INSERT INTO funnels (name) VALUES ($1) RETURNING id, name, version, open_ended`,
    [input.name],
  );
  const row = funnelRes.rows[0];
  const funnel: Funnel = { id: row.id, name: row.name, version: row.version, openEnded: row.open_ended };

  const steps: FunnelStep[] = [];
  for (const [index, step] of input.steps.entries()) {
    const stepRes = await pool.query(
      `INSERT INTO funnel_steps (funnel_id, position, type, config)
       VALUES ($1, $2, $3, $4) RETURNING id, position, type, config`,
      [funnel.id, index + 1, step.type, JSON.stringify(step.config)],
    );
    const s = stepRes.rows[0];
    steps.push({ id: s.id, funnelId: funnel.id, position: s.position, type: s.type, config: s.config });
  }
  return { funnel, steps };
}
```

`products/cascade/data/contact-repository.ts`:

```ts
import type { Pool } from "pg";
import type { Contact } from "../domain/types";

export async function createContact(
  pool: Pool,
  input: { email: string; timezone?: string; subscriptionStatus?: Contact["subscriptionStatus"] },
): Promise<Contact> {
  const res = await pool.query(
    `INSERT INTO contacts (email, timezone, subscription_status)
     VALUES ($1, $2, $3) RETURNING id, email, timezone, subscription_status`,
    [input.email, input.timezone ?? null, input.subscriptionStatus ?? "subscribed"],
  );
  const row = res.rows[0];
  return { id: row.id, email: row.email, timezone: row.timezone, subscriptionStatus: row.subscription_status };
}
```

`products/cascade/data/enrollment-repository.ts`:

```ts
import type { Pool } from "pg";
import type { Enrollment } from "../domain/types";

export async function enrollContact(pool: Pool, funnelId: string, contactId: string): Promise<Enrollment> {
  const firstStep = await pool.query(
    `SELECT id FROM funnel_steps WHERE funnel_id = $1 AND position = 1`,
    [funnelId],
  );
  if (firstStep.rowCount === 0) {
    throw new Error(`funnel ${funnelId} has no steps`);
  }
  const res = await pool.query(
    `INSERT INTO enrollments (funnel_id, contact_id, current_step_id)
     VALUES ($1, $2, $3)
     RETURNING id, funnel_id, contact_id, current_step_id, state, next_run_at`,
    [funnelId, contactId, firstStep.rows[0].id],
  );
  const row = res.rows[0];
  return {
    id: row.id,
    funnelId: row.funnel_id,
    contactId: row.contact_id,
    currentStepId: row.current_step_id,
    state: row.state,
    nextRunAt: row.next_run_at,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @content-automation/cascade test`
Expected: all tests PASS (2 from Task 2 + 3 new).

- [ ] **Step 6: Commit**

```bash
git add products/cascade/domain products/cascade/data products/cascade/tests/enrollment.test.ts
git commit -m "Add cascade domain types and repositories"
```

---

### Task 4: Mailer interface and LogMailer

**Files:**
- Create: `products/cascade/engine/mailer.ts`
- Test: `products/cascade/tests/mailer.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `interface OutgoingEmail { to: string; subject: string; body: string }`
  - `interface Mailer { send(email: OutgoingEmail): Promise<{ providerMessageId: string }> }`
  - `class LogMailer implements Mailer` with a public readonly `sent: OutgoingEmail[]` capture array. Phase 2 replaces this with Resend/SES implementations behind the same interface (see docs/decisions/0003).

- [ ] **Step 1: Write the failing test** — `products/cascade/tests/mailer.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { LogMailer } from "../engine/mailer";

test("LogMailer captures sends and returns unique provider ids", async () => {
  const mailer = new LogMailer();
  const a = await mailer.send({ to: "a@example.com", subject: "s1", body: "b1" });
  const b = await mailer.send({ to: "b@example.com", subject: "s2", body: "b2" });
  assert.equal(mailer.sent.length, 2);
  assert.equal(mailer.sent[0].to, "a@example.com");
  assert.notEqual(a.providerMessageId, b.providerMessageId);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @content-automation/cascade test`
Expected: FAIL — cannot find module `../engine/mailer`.

- [ ] **Step 3: Implement `products/cascade/engine/mailer.ts`**

```ts
export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

/** Phase 1 transport: logs instead of sending. Real providers land in Phase 2. */
export class LogMailer implements Mailer {
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    this.sent.push(email);
    console.log(`[cascade] send to=${email.to} subject="${email.subject}"`);
    return { providerMessageId: `log-${this.sent.length}` };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @content-automation/cascade test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add products/cascade/engine/mailer.ts products/cascade/tests/mailer.test.ts
git commit -m "Add cascade mailer interface with log transport"
```

---

### Task 5: Claiming due enrollments with SKIP LOCKED

**Files:**
- Create: `products/cascade/engine/tick.ts` (claim function only; execution added in Task 6)
- Test: `products/cascade/tests/claim.test.ts`

**Interfaces:**
- Consumes: repositories and `freshSchema` from Tasks 2–3.
- Produces:
  - `interface ClaimedRow { enrollmentId: string; contactId: string; funnelId: string; stepId: string; stepType: StepType; stepConfig: Record<string, unknown>; stepPosition: number; contactEmail: string; subscriptionStatus: string }`
  - `claimDueEnrollment(client: PoolClient): Promise<ClaimedRow | null>` — MUST be called inside an open transaction; locks the enrollment row until commit/rollback.

- [ ] **Step 1: Write the failing test** — `products/cascade/tests/claim.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";
import { claimDueEnrollment } from "../engine/tick";

test("claims only due, active enrollments", async () => {
  const pool = await freshSchema();
  const { funnel } = await createFunnel(pool, {
    name: "f",
    steps: [{ type: "email", config: { subject: "s", body: "b" } }],
  });
  const due = await createContact(pool, { email: "due@example.com" });
  const later = await createContact(pool, { email: "later@example.com" });
  const dueEnrollment = await enrollContact(pool, funnel.id, due.id);
  const laterEnrollment = await enrollContact(pool, funnel.id, later.id);
  await pool.query(`UPDATE enrollments SET next_run_at = now() + interval '1 hour' WHERE id = $1`, [
    laterEnrollment.id,
  ]);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const first = await claimDueEnrollment(client);
    assert.equal(first?.enrollmentId, dueEnrollment.id);
    assert.equal(first?.contactEmail, "due@example.com");
    // Park the claimed row (what real execution does by advancing the cursor);
    // otherwise this same transaction would just claim it again — SKIP LOCKED
    // only skips rows locked by OTHER transactions.
    await client.query(`UPDATE enrollments SET next_run_at = now() + interval '1 hour' WHERE id = $1`, [
      first!.enrollmentId,
    ]);
    const second = await claimDueEnrollment(client);
    assert.equal(second, null); // the other enrollment is an hour out
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});

test("two concurrent transactions never claim the same enrollment", async () => {
  const pool = await freshSchema();
  const { funnel } = await createFunnel(pool, {
    name: "f",
    steps: [{ type: "email", config: { subject: "s", body: "b" } }],
  });
  for (let i = 0; i < 10; i++) {
    const c = await createContact(pool, { email: `c${i}@example.com` });
    await enrollContact(pool, funnel.id, c.id);
  }

  const a = await pool.connect();
  const b = await pool.connect();
  try {
    await a.query("BEGIN");
    await b.query("BEGIN");
    const park = `UPDATE enrollments SET next_run_at = now() + interval '1 hour' WHERE id = $1`;
    const taken: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ra = await claimDueEnrollment(a);
      if (ra) {
        taken.push(ra.enrollmentId);
        await a.query(park, [ra.enrollmentId]); // park own claim so we don't re-claim it
      }
      const rb = await claimDueEnrollment(b);
      if (rb) {
        taken.push(rb.enrollmentId);
        await b.query(park, [rb.enrollmentId]);
      }
    }
    // Without SKIP LOCKED, b's first claim would block on a's lock instead of
    // taking the next row. Disjointness + no blocking is the proof.
    assert.equal(taken.length, 10);
    assert.equal(new Set(taken).size, 10);
    await a.query("ROLLBACK");
    await b.query("ROLLBACK");
  } finally {
    a.release();
    b.release();
  }
});
```

Note: `FOR UPDATE SKIP LOCKED` skips rows locked by *other* transactions only — a transaction re-selecting a row it already locked succeeds. That's why both tests park each claimed row (set `next_run_at` into the future) inside the claiming transaction, mirroring what real execution does when it advances the cursor.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @content-automation/cascade test`
Expected: FAIL — cannot find module `../engine/tick`.

- [ ] **Step 3: Implement the claim in `products/cascade/engine/tick.ts`**

```ts
import type { PoolClient } from "pg";
import type { StepType } from "../domain/types";

export interface ClaimedRow {
  enrollmentId: string;
  contactId: string;
  funnelId: string;
  stepId: string;
  stepType: StepType;
  stepConfig: Record<string, unknown>;
  stepPosition: number;
  contactEmail: string;
  subscriptionStatus: string;
}

/**
 * Claim one due enrollment. Must run inside an open transaction; the row
 * stays locked (and invisible to other workers via SKIP LOCKED) until
 * commit/rollback.
 */
export async function claimDueEnrollment(client: PoolClient): Promise<ClaimedRow | null> {
  const res = await client.query(`
    SELECT e.id AS enrollment_id, e.contact_id, e.funnel_id,
           s.id AS step_id, s.type AS step_type, s.config AS step_config, s.position AS step_position,
           c.email AS contact_email, c.subscription_status
    FROM enrollments e
    JOIN funnel_steps s ON s.id = e.current_step_id
    JOIN contacts c ON c.id = e.contact_id
    WHERE e.state = 'active' AND e.next_run_at <= now()
    ORDER BY e.next_run_at
    FOR UPDATE OF e SKIP LOCKED
    LIMIT 1
  `);
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  return {
    enrollmentId: row.enrollment_id,
    contactId: row.contact_id,
    funnelId: row.funnel_id,
    stepId: row.step_id,
    stepType: row.step_type,
    stepConfig: row.step_config,
    stepPosition: row.step_position,
    contactEmail: row.contact_email,
    subscriptionStatus: row.subscription_status,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @content-automation/cascade test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add products/cascade/engine/tick.ts products/cascade/tests/claim.test.ts
git commit -m "Add SKIP LOCKED claiming of due enrollments"
```

---

### Task 6: Step execution and the tick loop

**Files:**
- Modify: `products/cascade/engine/tick.ts` (add execution + `runTick`)
- Modify: `products/cascade/index.ts` (export the public API)
- Test: `products/cascade/tests/tick.test.ts`

**Interfaces:**
- Consumes: `claimDueEnrollment`, `Mailer`/`LogMailer`, repositories.
- Produces:
  - `interface TickResult { processed: number; sent: number; completed: number }`
  - `runTick(pool: Pool, mailer: Mailer, opts?: { batchSize?: number }): Promise<TickResult>` — claims and executes up to `batchSize` due enrollments, one transaction each.
  - Semantics later tasks rely on: an `email` step sends (suppression-gated, idempotent via the `sends` unique constraint) then advances with `next_run_at = now()`; a `delay` step advances with `next_run_at = now() + seconds`; advancing past the last step sets `state = 'completed'`, `current_step_id = NULL`.

- [ ] **Step 1: Write the failing tests** — `products/cascade/tests/tick.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";
import { LogMailer } from "../engine/mailer";
import { runTick } from "../engine/tick";

async function enrollmentRow(pool: any, id: string) {
  const res = await pool.query(`SELECT state, current_step_id, next_run_at FROM enrollments WHERE id = $1`, [id]);
  return res.rows[0];
}

test("walks a funnel end to end: email, zero delay, email, completed", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel } = await createFunnel(pool, {
    name: "walk",
    steps: [
      { type: "email", config: { subject: "one", body: "first" } },
      { type: "delay", config: { seconds: 0 } },
      { type: "email", config: { subject: "two", body: "second" } },
    ],
  });
  const contact = await createContact(pool, { email: "walk@example.com" });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);

  // A zero-delay funnel is fully due at every advance, so one tick walks all
  // three steps: batchSize bounds step executions, not enrollments.
  const t1 = await runTick(pool, mailer);
  assert.deepEqual([t1.processed, t1.sent, t1.completed], [3, 2, 1]);
  const idle = await runTick(pool, mailer);
  assert.equal(idle.processed, 0);

  assert.deepEqual(mailer.sent.map((m) => m.subject), ["one", "two"]);
  const row = await enrollmentRow(pool, enrollment.id);
  assert.equal(row.state, "completed");
  assert.equal(row.current_step_id, null);

  const events = await pool.query(`SELECT type FROM events WHERE enrollment_id = $1`, [enrollment.id]);
  assert.deepEqual(events.rows.map((r) => r.type), ["sent", "sent"]);
});

test("a future delay parks the enrollment", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel } = await createFunnel(pool, {
    name: "parked",
    steps: [
      { type: "delay", config: { seconds: 3600 } },
      { type: "email", config: { subject: "later", body: "b" } },
    ],
  });
  const contact = await createContact(pool, { email: "parked@example.com" });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);

  await runTick(pool, mailer); // executes the delay, parks 1h out
  const idle = await runTick(pool, mailer);
  assert.equal(idle.processed, 0); // nothing due
  assert.equal(mailer.sent.length, 0);
  const row = await enrollmentRow(pool, enrollment.id);
  assert.equal(row.state, "active");
  assert.ok(new Date(row.next_run_at).getTime() > Date.now() + 3500 * 1000);
});

test("a retried step can never double-send", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel, steps } = await createFunnel(pool, {
    name: "retry",
    steps: [{ type: "email", config: { subject: "once", body: "b" } }],
  });
  const contact = await createContact(pool, { email: "retry@example.com" });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);

  await runTick(pool, mailer);
  assert.equal(mailer.sent.length, 1);

  // Simulate a crash-after-send-before-advance: rewind the cursor.
  await pool.query(
    `UPDATE enrollments SET state = 'active', current_step_id = $2, next_run_at = now() WHERE id = $1`,
    [enrollment.id, steps[0].id],
  );
  const retry = await runTick(pool, mailer);
  assert.equal(retry.processed, 1);
  assert.equal(retry.sent, 0); // unique(enrollment_id, step_id) blocked the duplicate
  assert.equal(mailer.sent.length, 1);
  const sends = await pool.query(`SELECT count(*)::int AS n FROM sends WHERE enrollment_id = $1`, [enrollment.id]);
  assert.equal(sends.rows[0].n, 1);
});

test("suppression gate: unsubscribed contacts are skipped, not sent", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel } = await createFunnel(pool, {
    name: "suppressed",
    steps: [{ type: "email", config: { subject: "no", body: "b" } }],
  });
  const contact = await createContact(pool, {
    email: "unsub@example.com",
    subscriptionStatus: "unsubscribed",
  });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);

  const t = await runTick(pool, mailer);
  assert.deepEqual([t.processed, t.sent, t.completed], [1, 0, 1]);
  assert.equal(mailer.sent.length, 0);
  const sends = await pool.query(`SELECT status FROM sends WHERE enrollment_id = $1`, [enrollment.id]);
  assert.deepEqual(sends.rows.map((r) => r.status), ["skipped"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @content-automation/cascade test`
Expected: FAIL — `runTick` is not exported from `../engine/tick`.

- [ ] **Step 3: Add execution to `products/cascade/engine/tick.ts`**

First change the pg import at the top of the file from `import type { PoolClient } from "pg";` to `import type { Pool, PoolClient } from "pg";` and add `import type { Mailer } from "./mailer";`. Then append below `claimDueEnrollment`:

```ts
export interface TickResult {
  processed: number;
  sent: number;
  completed: number;
}

interface StepOutcome {
  sent: boolean;
  completed: boolean;
}

/** Advance the cursor to the next step, or complete the enrollment if none. */
async function advance(client: PoolClient, row: ClaimedRow, delaySeconds: number): Promise<boolean> {
  const next = await client.query(
    `SELECT id FROM funnel_steps WHERE funnel_id = $1 AND position = $2`,
    [row.funnelId, row.stepPosition + 1],
  );
  if (next.rowCount === 0) {
    await client.query(
      `UPDATE enrollments SET state = 'completed', current_step_id = NULL, updated_at = now() WHERE id = $1`,
      [row.enrollmentId],
    );
    return true;
  }
  await client.query(
    `UPDATE enrollments
     SET current_step_id = $2, next_run_at = now() + make_interval(secs => $3), updated_at = now()
     WHERE id = $1`,
    [row.enrollmentId, next.rows[0].id, delaySeconds],
  );
  return false;
}

async function executeStep(client: PoolClient, row: ClaimedRow, mailer: Mailer): Promise<StepOutcome> {
  if (row.stepType === "delay") {
    const seconds = Number(row.stepConfig.seconds);
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`enrollment ${row.enrollmentId}: invalid delay config ${JSON.stringify(row.stepConfig)}`);
    }
    const completed = await advance(client, row, seconds);
    return { sent: false, completed };
  }

  // email step
  const subject = String(row.stepConfig.subject ?? "");
  const body = String(row.stepConfig.body ?? "");

  // Suppression gate — mandatory before every send, no exceptions.
  if (row.subscriptionStatus !== "subscribed") {
    await client.query(
      `INSERT INTO sends (enrollment_id, step_id, status) VALUES ($1, $2, 'skipped')
       ON CONFLICT (enrollment_id, step_id) DO NOTHING`,
      [row.enrollmentId, row.stepId],
    );
    const completed = await advance(client, row, 0);
    return { sent: false, completed };
  }

  const reserved = await client.query(
    `INSERT INTO sends (enrollment_id, step_id, status) VALUES ($1, $2, 'queued')
     ON CONFLICT (enrollment_id, step_id) DO NOTHING
     RETURNING id`,
    [row.enrollmentId, row.stepId],
  );
  if (reserved.rowCount === 0) {
    // A send row already exists for this (enrollment, step): retry path. Never send twice.
    const completed = await advance(client, row, 0);
    return { sent: false, completed };
  }

  const sendId = reserved.rows[0].id;
  // Phase 1: LogMailer cannot meaningfully fail, so transport-in-transaction is
  // acceptable. Phase 2 (real provider) must restructure to
  // reserve-commit-send-finalize so a transport call is never inside the tick
  // transaction.
  const { providerMessageId } = await mailer.send({ to: row.contactEmail, subject, body });
  await client.query(`UPDATE sends SET status = 'sent', provider_message_id = $2 WHERE id = $1`, [
    sendId,
    providerMessageId,
  ]);
  await client.query(
    `INSERT INTO events (contact_id, enrollment_id, send_id, type) VALUES ($1, $2, $3, 'sent')`,
    [row.contactId, row.enrollmentId, sendId],
  );
  const completed = await advance(client, row, 0);
  return { sent: true, completed };
}

/** One engine tick: claim and execute up to batchSize due enrollments, one transaction each. */
export async function runTick(
  pool: Pool,
  mailer: Mailer,
  opts: { batchSize?: number } = {},
): Promise<TickResult> {
  const batchSize = opts.batchSize ?? 10;
  const result: TickResult = { processed: 0, sent: 0, completed: 0 };
  for (let i = 0; i < batchSize; i++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const row = await claimDueEnrollment(client);
      if (!row) {
        await client.query("COMMIT");
        break;
      }
      const outcome = await executeStep(client, row, mailer);
      await client.query("COMMIT");
      result.processed += 1;
      if (outcome.sent) result.sent += 1;
      if (outcome.completed) result.completed += 1;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return result;
}
```

- [ ] **Step 4: Fill in `products/cascade/index.ts`**

```ts
export { getCascadePool, schemaName } from "./data/pool";
export { ensureCascadeSchema } from "./data/schema";
export { createFunnel } from "./data/funnel-repository";
export { createContact } from "./data/contact-repository";
export { enrollContact } from "./data/enrollment-repository";
export { claimDueEnrollment, runTick } from "./engine/tick";
export type { ClaimedRow, TickResult } from "./engine/tick";
export { LogMailer } from "./engine/mailer";
export type { Mailer, OutgoingEmail } from "./engine/mailer";
export type * from "./domain/types";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @content-automation/cascade test`
Expected: all tests PASS (schema 2, enrollment 3, mailer 1, claim 2, tick 4).

Run: `pnpm --filter @content-automation/cascade typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add products/cascade/engine/tick.ts products/cascade/index.ts products/cascade/tests/tick.test.ts
git commit -m "Add cascade step execution and tick loop"
```

---

### Task 7: Worker process and root wiring

**Files:**
- Create: `products/cascade/engine/worker.ts`
- Modify: `package.json` (repo root — add `cascade:*` scripts, extend `test`)

**Interfaces:**
- Consumes: `getCascadePool`, `schemaName`, `runTick`, `LogMailer`.
- Produces: a runnable worker (`pnpm cascade:worker`) polling every `CASCADE_TICK_INTERVAL_MS` (default 1000) with batch `CASCADE_BATCH_SIZE` (default 10), stopping cleanly on SIGINT/SIGTERM.

- [ ] **Step 1: Implement `products/cascade/engine/worker.ts`**

```ts
import { getCascadePool, schemaName } from "../data/pool";
import { LogMailer } from "./mailer";
import { runTick } from "./tick";

const intervalMs = Number(process.env.CASCADE_TICK_INTERVAL_MS ?? 1000);
const batchSize = Number(process.env.CASCADE_BATCH_SIZE ?? 10);
const pool = getCascadePool();
const mailer = new LogMailer();

let running = true;

function shutdown(signal: string) {
  console.log(`[cascade-worker] ${signal} received, stopping after current tick`);
  running = false;
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log(
  `[cascade-worker] starting: interval=${intervalMs}ms batch=${batchSize} schema=${schemaName()}`,
);

while (running) {
  try {
    const res = await runTick(pool, mailer, { batchSize });
    if (res.processed > 0) {
      console.log(
        `[cascade-worker] processed=${res.processed} sent=${res.sent} completed=${res.completed}`,
      );
    }
  } catch (err) {
    console.error("[cascade-worker] tick failed", err);
  }
  if (running) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

await pool.end();
console.log("[cascade-worker] stopped");
```

- [ ] **Step 2: Add root scripts** — modify the repo root `package.json` `scripts` block. Add these three entries (same `.env`-sourcing shape as the existing `auth:migrate`):

```json
"cascade:migrate": "set -a; . ./.env; set +a; POSTGRES_HOST=localhost pnpm --filter @content-automation/cascade db:migrate",
"cascade:seed": "set -a; . ./.env; set +a; POSTGRES_HOST=localhost pnpm --filter @content-automation/cascade seed:demo",
"cascade:worker": "set -a; . ./.env; set +a; POSTGRES_HOST=localhost pnpm --filter @content-automation/cascade worker",
"test:cascade": "set -a; . ./.env; set +a; POSTGRES_HOST=localhost pnpm --filter @content-automation/cascade test",
```

And change the existing `test` entry from:

```json
"test": "pnpm run test:architecture && pnpm --filter @content-automation/auth test"
```

to:

```json
"test": "pnpm run test:architecture && pnpm --filter @content-automation/auth test && pnpm run test:cascade"
```

- [ ] **Step 3: Verify the worker starts and stops cleanly**

Run: `pnpm cascade:migrate`
Expected: `Cascade schema 'cascade' is current.`

Smoke-test start/stop (macOS has no `timeout` binary — use a log file):

```bash
pnpm cascade:worker > /tmp/cascade-worker-smoke.log 2>&1 &
WORKER_PID=$!
until grep -q "starting" /tmp/cascade-worker-smoke.log; do sleep 0.5; done
kill -TERM $WORKER_PID
until grep -q "stopped" /tmp/cascade-worker-smoke.log; do sleep 0.5; done
cat /tmp/cascade-worker-smoke.log
```

Expected log: the `starting: interval=1000ms batch=10 schema=cascade` line, then `SIGTERM received, stopping after current tick`, then `stopped` — and no error output. (If "stopped" never appears after ~10s, the signal didn't propagate through pnpm; fall back to `pkill -f "tsx engine/worker.ts"` and treat that as a bug to fix before proceeding.)

Run: `pnpm test` (root)
Expected: architecture, auth, and cascade suites all PASS.

- [ ] **Step 4: Commit**

```bash
git add products/cascade/engine/worker.ts package.json
git commit -m "Add cascade worker process and root scripts"
```

---

### Task 8: Demo seed and end-to-end proof

**Files:**
- Create: `products/cascade/scripts/seed-demo.ts`
- Modify: `products/cascade/README.md` (status section)

**Interfaces:**
- Consumes: everything above.
- Produces: the Phase 1 exit-criterion demonstration — a contact enters a funnel and receives a scheduled send through the running worker.

- [ ] **Step 1: Implement `products/cascade/scripts/seed-demo.ts`**

```ts
import { getCascadePool } from "../data/pool";
import { ensureCascadeSchema } from "../data/schema";
import { createFunnel } from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";

const pool = getCascadePool();
await ensureCascadeSchema(pool);

const { funnel } = await createFunnel(pool, {
  name: "phase1-demo",
  steps: [
    { type: "email", config: { subject: "Welcome to Cascade", body: "First engine send." } },
    { type: "delay", config: { seconds: 60 } },
    { type: "email", config: { subject: "One minute later", body: "The scheduled follow-up." } },
  ],
});
const contact = await createContact(pool, { email: `demo-${Date.now()}@example.com` });
const enrollment = await enrollContact(pool, funnel.id, contact.id);

console.log(`Seeded funnel=${funnel.id}`);
console.log(`  contact=${contact.email}`);
console.log(`  enrollment=${enrollment.id} (due now; delay step waits 60s)`);
console.log(`Run 'pnpm cascade:worker' and watch both sends arrive.`);
await pool.end();
```

- [ ] **Step 2: Run the end-to-end demonstration**

```bash
pnpm cascade:seed
pnpm cascade:worker > /tmp/cascade-demo.log 2>&1 &
WORKER_PID=$!
until grep -q "One minute later" /tmp/cascade-demo.log; do sleep 5; done
kill -TERM $WORKER_PID
cat /tmp/cascade-demo.log
```

Expected log over ~70 seconds:
1. Immediately: `[cascade] send to=demo-...@example.com subject="Welcome to Cascade"` and `processed=1 sent=1`, then a second processed line for the delay step.
2. Quiet for ~60 seconds.
3. Then: `[cascade] send ... subject="One minute later"` with `completed=1`.

- [ ] **Step 3: Verify state in the database**

```bash
set -a; . ./.env; set +a
docker exec content-automation-postgres psql -U "$POSTGRES_USER" -d langgraph -c \
  "SELECT s.status, s.provider_message_id, e.state
   FROM cascade.sends s JOIN cascade.enrollments e ON e.id = s.enrollment_id
   ORDER BY s.created_at"
```

Expected: two rows with `status = sent` and non-null provider ids; enrollment `state = completed`.

- [ ] **Step 4: Update `products/cascade/README.md`**

Replace the Status section body (currently "**Pre-implementation, documentation only.** ...") first sentence with:

```markdown
**Phase 1 (engine core) implemented** — schema, enrollment state machine, `SKIP LOCKED` tick loop, `delay`/`email` steps, log transport. Later phases per [docs/roadmap.md](docs/roadmap.md). The founding proposal (written before Cascade moved into this monorepo) is preserved at [docs/proposal.md](docs/proposal.md). The docs supersede it where they differ — the proposal assumed content authored inside Cascade and purchase-revenue conversion; both changed.
```

- [ ] **Step 5: Commit**

```bash
git add products/cascade/scripts/seed-demo.ts products/cascade/README.md
git commit -m "Add cascade demo seed proving Phase 1 end to end"
```

---

## Phase 1 exit criteria → where proven

| Criterion | Proof |
|---|---|
| A contact enters a funnel and receives a scheduled send | Task 8 demo (live worker) + Task 6 walk test |
| A retried tick cannot double-send | Task 6 "retried step can never double-send" test |
| Two workers run concurrently without conflict | Task 5 SKIP LOCKED disjoint-claim test |
| Suppression gate before every send (CLAUDE.md invariant, pulled forward from Phase 2) | Task 6 suppression test |
