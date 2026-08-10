# Prospect Action Items & Touchpoint Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First-class action items (Postgres) with due dates and snooze, auto follow-ups on touchpoints, real `lastContactedAt`, and a due-today dashboard on the outreach overview page.

**Architecture:** Workflow state lives in a new `action_items` Postgres table (RLS by organization, entity-ref columns holding graph ids — the `product_events` pattern). The graph keeps knowledge: touchpoint hooks in `prospect-repository.ts` set `lastContactedAt` and fire-and-forget an auto-follow-up insert. Four UI surfaces read/write through new org-scoped routes.

**Tech Stack:** Drizzle + pg (RLS pools via `getJobPool`), FalkorDB via `getSession()`, Next.js 16 route handlers (`params` is a Promise), node:test, shadcn/`packages/ui` components.

**Spec:** `docs/superpowers/specs/2026-08-10-prospect-action-items-design.md`

## Global Constraints

- All graph Cypher is openCypher 9-compatible: `localdatetime()`, no `COUNT{}`/`EXISTS{}`/`CALL{}` (see `docs/graph-backend.md`).
- Every route under `apps/outreach/app/api/outreach/**` must wrap its handler in `withProspectOrg` (`apps/outreach/lib/prospect-scope.ts`).
- UI: semantic tokens only (no hex, no palette classes), dense surfaces, `ListCard`/`ListRow`/`Badge` from existing components, sonner toasts, skeletons mirroring final layout (`docs/design-language.md`).
- Cross-store writes from graph functions must never throw into the graph operation (catch + log, like `emitProductEvent`).
- Auto-follow-up default: **+3 days**, title `Follow up with {name}`, only when the prospect has no open action item.
- Contact activity types: `outreach_sent`, `call`, `meeting`, `comment_sent`, `connection_request_sent`, `reaction_sent`.
- Commit after each task. Test commands run from repo root unless noted; `products/outreach` tests run with `cd products/outreach && set -a; . ../../.env; set +a; POSTGRES_HOST=localhost pnpm test` (FalkorDB on 6380 and Postgres from `docker compose up -d` must be running).

---

### Task 1: `action_items` table (Drizzle schema + migration)

**Files:**
- Modify: `packages/database/schema/tables.ts` (append after `product_events`, ~line 2010)
- Create: `packages/database/migrations/0020_add_action_items.sql` (via `pnpm db:generate`, then rename/extend)

**Interfaces:**
- Produces: exported Drizzle table `action_items` from `@content-automation/database` (re-exported by `packages/database/index.ts` schema barrel — verify `schema/index.ts` re-exports `tables.ts`, it does for `product_events`).

- [ ] **Step 1: Add the table to the schema**

Append to `packages/database/schema/tables.ts` (imports `pgTable, uuid, text, timestamp, jsonb, index, pgPolicy, check, sql` already exist in the file):

```ts
export const action_items = pgTable("action_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().notNull(),
	title: text().notNull(),
	status: text().default('open').notNull(),
	due_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	source: text().default('manual').notNull(),
	prospect_id: text(),
	account_id: text(),
	payload: jsonb(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_action_items_org_status_due").using("btree", table.organization_id.asc().nullsLast(), table.status.asc().nullsLast(), table.due_at.asc().nullsLast()),
	index("idx_action_items_prospect").using("btree", table.prospect_id.asc().nullsLast()),
	pgPolicy("action_items_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("action_items_status_check", sql`status = ANY (ARRAY['open'::text, 'done'::text, 'dismissed'::text])`),
	check("action_items_source_check", sql`source = ANY (ARRAY['manual'::text, 'auto_followup'::text])`),
]).enableRLS();
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `packages/database/migrations/0020_*.sql` containing `CREATE TABLE "action_items"`, both indexes, RLS enable + policy, and both checks.

- [ ] **Step 3: Add runtime-role grants to the migration**

Open `packages/database/migrations/0008_restore_runtime_database_grants.sql` and find the GRANT statements used for `product_events` (role name and grant shape). Append the equivalent statements for `action_items` to the END of the newly generated 0020 migration file, e.g. (match the actual role names found in 0008):

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "action_items" TO "<runtime_role_from_0008>";
```

If 0008 grants sequences or default privileges for new tables globally, no extra statement is needed — verify before adding.

- [ ] **Step 4: Apply and verify**

Run: `docker compose up -d && pnpm db:migrate`
Expected: migration applies cleanly.
Run: `docker compose exec -T postgres psql -U postgres -d langgraph -c "\\d action_items"` (adjust service/db names to `docker-compose.yml`)
Expected: table with the 12 columns and both indexes; `rowsecurity` enabled.

- [ ] **Step 5: Commit**

```bash
git add packages/database/schema/tables.ts packages/database/migrations/
git commit -m "feat(db): add action_items table with org RLS"
```

---

### Task 2: Domain types + action-item repository (TDD)

**Files:**
- Create: `products/outreach/domain/action-items.ts`
- Create: `products/outreach/data/action-item-repository.ts`
- Test: `products/outreach/tests/action-item-repository.test.ts`
- Modify: `products/outreach/domain/types.ts` (add `next_action_completed` activity type + config + `CONTACT_ACTIVITY_TYPES`)

**Interfaces:**
- Consumes: `action_items` table (Task 1), `databaseFor`/`getJobPool`/`validateJobOrganizationId` (existing), `currentGraphOrganizationId` from `@content-automation/platform/data/organization-context`.
- Produces (used by Tasks 3, 4):
  - `type ActionItemStatus = 'open' | 'done' | 'dismissed'`
  - `type ActionItemSource = 'manual' | 'auto_followup'`
  - `interface ActionItem { id: string; title: string; status: ActionItemStatus; dueAt: string; source: ActionItemSource; prospectId: string | null; accountId: string | null; payload: Record<string, unknown> | null; createdAt: string; updatedAt: string; completedAt: string | null }`
  - `createActionItem(input: { title: string; dueAt: string; source?: ActionItemSource; prospectId?: string; accountId?: string; payload?: Record<string, unknown> }): Promise<ActionItem>`
  - `updateActionItem(id: string, input: { title?: string; dueAt?: string }): Promise<ActionItem | null>` (snooze = `updateActionItem(id, { dueAt })`)
  - `completeActionItem(id: string): Promise<ActionItem | null>` / `dismissActionItem(id: string): Promise<ActionItem | null>`
  - `deleteActionItem(id: string): Promise<boolean>`
  - `listOpenActionItems(options?: { dueBefore?: string }): Promise<ActionItem[]>` (ordered `due_at ASC`)
  - `getOpenActionItemsForProspects(prospectIds: string[]): Promise<Map<string, ActionItem[]>>` (each list ordered `due_at ASC`)
  - `ensureFollowUpForProspect(prospectId: string, prospectName: string): Promise<void>` — creates the +3d auto follow-up unless an open item already references the prospect
  - `CONTACT_ACTIVITY_TYPES: ReadonlySet<ProspectActivityType>` and activity type `next_action_completed` (both from `domain/types.ts`)

- [ ] **Step 1: Domain additions in `products/outreach/domain/types.ts`**

Add `| "next_action_completed"` to `ProspectActivityType` (after `"status_change"`, ~line 283). Add to `ACTIVITY_TYPE_CONFIG` (~line 356):

```ts
  next_action_completed: { label: "Action completed", color: "text-chart-2", bgColor: "bg-chart-2/10" },
```

Below the config, add:

```ts
/** Activity types that count as touching the prospect (drive lastContactedAt + auto follow-up). */
export const CONTACT_ACTIVITY_TYPES: ReadonlySet<ProspectActivityType> = new Set([
  "outreach_sent",
  "call",
  "meeting",
  "comment_sent",
  "connection_request_sent",
  "reaction_sent",
]);
```

- [ ] **Step 2: Create `products/outreach/domain/action-items.ts`**

```ts
export type ActionItemStatus = "open" | "done" | "dismissed";
export type ActionItemSource = "manual" | "auto_followup";

export const FOLLOW_UP_DEFAULT_DAYS = 3;

export interface ActionItem {
  id: string;
  title: string;
  status: ActionItemStatus;
  dueAt: string; // ISO timestamp
  source: ActionItemSource;
  prospectId: string | null;
  accountId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateActionItemInput {
  title: string;
  dueAt: string;
  source?: ActionItemSource;
  prospectId?: string;
  accountId?: string;
  payload?: Record<string, unknown>;
}

export interface UpdateActionItemInput {
  title?: string;
  dueAt?: string;
}
```

- [ ] **Step 3: Write the failing repository test**

`products/outreach/tests/action-item-repository.test.ts` — follows the org-context pattern of `prospect-activity-events.test.ts` but hits Postgres, so no FalkorDB env needed. Cleanup uses the admin pool like `packages/platform/tests/intelligence-notifications-postgres.test.ts`:

```ts
import assert from 'node:assert/strict';
import nodeTest, { after } from 'node:test';
import { runWithGraphOrganization } from '@content-automation/platform/data/graph';
import { closeJobPools, getJobAdminPool } from '@content-automation/platform/jobs/pool';
import {
  completeActionItem,
  createActionItem,
  deleteActionItem,
  dismissActionItem,
  ensureFollowUpForProspect,
  getOpenActionItemsForProspects,
  listOpenActionItems,
  updateActionItem,
} from '../data/action-item-repository';
import { FOLLOW_UP_DEFAULT_DAYS } from '../domain/action-items';

const ORGANIZATION_ID = `action-items-test-${process.pid}`;

function test(name: string, body: () => void | Promise<void>) {
  return nodeTest(name, () => runWithGraphOrganization(ORGANIZATION_ID, body));
}

after(async () => {
  await getJobAdminPool()
    .query('DELETE FROM action_items WHERE organization_id = $1', [ORGANIZATION_ID])
    .catch(() => undefined);
  await closeJobPools();
});

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

test('lifecycle: create → snooze → complete', async () => {
  const item = await createActionItem({ title: 'Send intro note', dueAt: inDays(1), prospectId: 'p-1' });
  assert.equal(item.status, 'open');
  assert.equal(item.source, 'manual');
  assert.equal(item.prospectId, 'p-1');

  const snoozed = await updateActionItem(item.id, { dueAt: inDays(4) });
  assert.ok(snoozed && new Date(snoozed.dueAt) > new Date(item.dueAt));

  const done = await completeActionItem(item.id);
  assert.equal(done?.status, 'done');
  assert.ok(done?.completedAt);
});

test('dismiss and delete', async () => {
  const item = await createActionItem({ title: 'Old task', dueAt: inDays(0) });
  const dismissed = await dismissActionItem(item.id);
  assert.equal(dismissed?.status, 'dismissed');
  assert.equal(await deleteActionItem(item.id), true);
  assert.equal(await deleteActionItem(item.id), false);
});

test('listOpenActionItems orders by due date and honors dueBefore', async () => {
  const later = await createActionItem({ title: 'Later', dueAt: inDays(6) });
  const sooner = await createActionItem({ title: 'Sooner', dueAt: inDays(-2) });
  const all = await listOpenActionItems();
  const ids = all.map((entry) => entry.id);
  assert.ok(ids.indexOf(sooner.id) < ids.indexOf(later.id));

  const dueSoon = await listOpenActionItems({ dueBefore: inDays(1) });
  assert.ok(dueSoon.some((entry) => entry.id === sooner.id));
  assert.ok(!dueSoon.some((entry) => entry.id === later.id));
});

test('getOpenActionItemsForProspects groups by prospect', async () => {
  const a = await createActionItem({ title: 'A', dueAt: inDays(1), prospectId: 'p-group-a' });
  await createActionItem({ title: 'B', dueAt: inDays(2), prospectId: 'p-group-b' });
  const grouped = await getOpenActionItemsForProspects(['p-group-a', 'p-group-b', 'p-none']);
  assert.equal(grouped.get('p-group-a')?.[0]?.id, a.id);
  assert.equal(grouped.get('p-group-b')?.length, 1);
  assert.equal(grouped.get('p-none'), undefined);
});

test('ensureFollowUpForProspect creates once, +3 days, and never duplicates', async () => {
  await ensureFollowUpForProspect('p-auto', 'Ada Lovelace');
  await ensureFollowUpForProspect('p-auto', 'Ada Lovelace');
  const grouped = await getOpenActionItemsForProspects(['p-auto']);
  const items = grouped.get('p-auto') ?? [];
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Follow up with Ada Lovelace');
  assert.equal(items[0].source, 'auto_followup');
  const expected = Date.now() + FOLLOW_UP_DEFAULT_DAYS * 86_400_000;
  assert.ok(Math.abs(new Date(items[0].dueAt).getTime() - expected) < 60_000);
});

test('ensureFollowUpForProspect skips when a manual item is open', async () => {
  await createActionItem({ title: 'Deliberate plan', dueAt: inDays(10), prospectId: 'p-manual' });
  await ensureFollowUpForProspect('p-manual', 'Grace Hopper');
  const grouped = await getOpenActionItemsForProspects(['p-manual']);
  assert.equal(grouped.get('p-manual')?.length, 1);
  assert.equal(grouped.get('p-manual')?.[0]?.title, 'Deliberate plan');
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd products/outreach && set -a; . ../../.env; set +a; POSTGRES_HOST=localhost node --import tsx --test tests/action-item-repository.test.ts`
Expected: FAIL — cannot resolve `../data/action-item-repository`.

- [ ] **Step 5: Implement `products/outreach/data/action-item-repository.ts`**

```ts
/**
 * Action items are workflow state (spec 2026-08-10): they ride Postgres like
 * `jobs` and `product_events`, referencing graph entities by id. The graph
 * stays knowledge-only.
 */
import { action_items as actionItemsTable, databaseFor } from '@content-automation/database';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { getJobPool, validateJobOrganizationId } from '@content-automation/platform/jobs/pool';
import { currentGraphOrganizationId } from '@content-automation/platform/data/organization-context';
import {
  FOLLOW_UP_DEFAULT_DAYS,
  type ActionItem,
  type ActionItemSource,
  type ActionItemStatus,
  type CreateActionItemInput,
  type UpdateActionItemInput,
} from '../domain/action-items';

function database() {
  const organizationId = currentGraphOrganizationId();
  if (!organizationId) {
    throw new Error('Organization context is required for action items.');
  }
  return databaseFor(getJobPool(validateJobOrganizationId(organizationId)));
}

function organizationId(): string {
  return validateJobOrganizationId(currentGraphOrganizationId() ?? '');
}

type ActionItemRow = typeof actionItemsTable.$inferSelect;

function mapRow(row: ActionItemRow): ActionItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status as ActionItemStatus,
    dueAt: row.due_at,
    source: row.source as ActionItemSource,
    prospectId: row.prospect_id,
    accountId: row.account_id,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function createActionItem(input: CreateActionItemInput): Promise<ActionItem> {
  const [row] = await database()
    .insert(actionItemsTable)
    .values({
      organization_id: organizationId(),
      title: input.title,
      due_at: input.dueAt,
      source: input.source ?? 'manual',
      prospect_id: input.prospectId ?? null,
      account_id: input.accountId ?? null,
      payload: input.payload ?? null,
    })
    .returning();
  return mapRow(row);
}

export async function updateActionItem(
  id: string,
  input: UpdateActionItemInput,
): Promise<ActionItem | null> {
  const [row] = await database()
    .update(actionItemsTable)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
      updated_at: new Date().toISOString(),
    })
    .where(eq(actionItemsTable.id, id))
    .returning();
  return row ? mapRow(row) : null;
}

async function transition(id: string, status: 'done' | 'dismissed'): Promise<ActionItem | null> {
  const now = new Date().toISOString();
  const [row] = await database()
    .update(actionItemsTable)
    .set({ status, completed_at: now, updated_at: now })
    .where(and(eq(actionItemsTable.id, id), eq(actionItemsTable.status, 'open')))
    .returning();
  return row ? mapRow(row) : null;
}

export function completeActionItem(id: string): Promise<ActionItem | null> {
  return transition(id, 'done');
}

export function dismissActionItem(id: string): Promise<ActionItem | null> {
  return transition(id, 'dismissed');
}

export async function deleteActionItem(id: string): Promise<boolean> {
  const rows = await database()
    .delete(actionItemsTable)
    .where(eq(actionItemsTable.id, id))
    .returning({ id: actionItemsTable.id });
  return rows.length > 0;
}

export async function listOpenActionItems(
  options?: { dueBefore?: string },
): Promise<ActionItem[]> {
  const conditions = [eq(actionItemsTable.status, 'open')];
  if (options?.dueBefore) conditions.push(lte(actionItemsTable.due_at, options.dueBefore));
  const rows = await database()
    .select()
    .from(actionItemsTable)
    .where(and(...conditions))
    .orderBy(asc(actionItemsTable.due_at));
  return rows.map(mapRow);
}

export async function getOpenActionItemsForProspects(
  prospectIds: string[],
): Promise<Map<string, ActionItem[]>> {
  const grouped = new Map<string, ActionItem[]>();
  if (prospectIds.length === 0) return grouped;
  const rows = await database()
    .select()
    .from(actionItemsTable)
    .where(and(
      eq(actionItemsTable.status, 'open'),
      inArray(actionItemsTable.prospect_id, prospectIds),
    ))
    .orderBy(asc(actionItemsTable.due_at));
  for (const row of rows) {
    const item = mapRow(row);
    if (!item.prospectId) continue;
    const bucket = grouped.get(item.prospectId) ?? [];
    bucket.push(item);
    grouped.set(item.prospectId, bucket);
  }
  return grouped;
}

/**
 * Touchpoint hook target: create the default follow-up unless the prospect
 * already has an open item. A deliberately-set item is never overwritten.
 */
export async function ensureFollowUpForProspect(
  prospectId: string,
  prospectName: string,
): Promise<void> {
  const open = await getOpenActionItemsForProspects([prospectId]);
  if ((open.get(prospectId)?.length ?? 0) > 0) return;
  await createActionItem({
    title: `Follow up with ${prospectName}`,
    dueAt: new Date(Date.now() + FOLLOW_UP_DEFAULT_DAYS * 86_400_000).toISOString(),
    source: 'auto_followup',
    prospectId,
  });
}
```

Note: RLS makes every query org-scoped through the pool's `app.organization_id`; the explicit `organization_id` value on insert must still be set. If `action_items` is not exported from `@content-automation/database`, add it to the schema barrel export (`packages/database/schema/index.ts` or `tables.ts` export list — match how `product_events` is exported).

- [ ] **Step 6: Run tests to verify they pass**

Run: same command as Step 4.
Expected: all 6 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add products/outreach/domain/action-items.ts products/outreach/data/action-item-repository.ts products/outreach/tests/action-item-repository.test.ts products/outreach/domain/types.ts
git commit -m "feat(outreach): action item domain + Postgres repository"
```

---

### Task 3: Touchpoint hooks — real `lastContactedAt` + auto follow-up (TDD)

**Files:**
- Modify: `products/outreach/data/prospect-repository.ts` (`updateOutreachMessage` ~line 832, `createProspectActivity` ~line 1121)
- Test: `products/outreach/tests/prospect-touchpoints.test.ts`

**Interfaces:**
- Consumes: `ensureFollowUpForProspect` (Task 2), `CONTACT_ACTIVITY_TYPES` (Task 2), existing `updateOutreachMessage`/`createProspectActivity`.
- Produces: behavioral guarantees only — signatures unchanged. Adds exported `drainTouchpointWrites(): Promise<void>` (test helper, mirrors `drainProductEvents`).

- [ ] **Step 1: Write the failing test**

`products/outreach/tests/prospect-touchpoints.test.ts` (needs FalkorDB env header like `prospect-activity-events.test.ts` AND Postgres):

```ts
process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? 'redis://localhost:6380';
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? 'outreach_test';

import assert from 'node:assert/strict';
import nodeTest, { after, before } from 'node:test';
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from '@content-automation/platform/data/graph';
import { closeJobPools, getJobAdminPool } from '@content-automation/platform/jobs/pool';
import {
  createOutreachMessage,
  createProspect,
  createProspectActivity,
  drainTouchpointWrites,
  getProspect,
  updateOutreachMessage,
} from '../data/prospect-repository';
import { getOpenActionItemsForProspects } from '../data/action-item-repository';

const ORGANIZATION_ID = `touchpoints-test-${process.pid}`;

function test(name: string, body: () => void | Promise<void>) {
  return nodeTest(name, () => runWithGraphOrganization(ORGANIZATION_ID, body));
}

async function clearGraph() {
  const session = await getSession();
  try { await session.run('MATCH (n) DETACH DELETE n'); }
  finally { await session.close(); }
}

before(() => runWithGraphOrganization(ORGANIZATION_ID, clearGraph));
after(async () => {
  await runWithGraphOrganization(ORGANIZATION_ID, clearGraph);
  await getJobAdminPool()
    .query('DELETE FROM action_items WHERE organization_id = $1', [ORGANIZATION_ID])
    .catch(() => undefined);
  await closeDriver();
  await closeJobPools();
});

test('marking outreach sent sets lastContactedAt and creates the auto follow-up', async () => {
  const prospect = await createProspect({ name: 'Ada Lovelace', company: 'Analytical', source: 'manual' });
  assert.equal(prospect.lastContactedAt, undefined);
  const message = await createOutreachMessage({
    prospectId: prospect.id, medium: 'email', subject: 'Hello', content: 'Hi there',
  });

  await updateOutreachMessage(message.id, { status: 'sent' });
  await drainTouchpointWrites();

  const updated = await getProspect(prospect.id);
  assert.ok(updated?.lastContactedAt, 'lastContactedAt set on send');

  const items = (await getOpenActionItemsForProspects([prospect.id])).get(prospect.id) ?? [];
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'auto_followup');
  assert.equal(items[0].title, 'Follow up with Ada Lovelace');
});

test('contact-type activity sets lastContactedAt; non-contact types do not', async () => {
  const prospect = await createProspect({ name: 'Grace Hopper', company: 'Navy', source: 'manual' });

  await createProspectActivity(prospect.id, { type: 'note', title: 'Background reading' });
  await drainTouchpointWrites();
  assert.equal((await getProspect(prospect.id))?.lastContactedAt, undefined);

  await createProspectActivity(prospect.id, { type: 'call', title: 'Intro call' });
  await drainTouchpointWrites();
  assert.ok((await getProspect(prospect.id))?.lastContactedAt);

  const items = (await getOpenActionItemsForProspects([prospect.id])).get(prospect.id) ?? [];
  assert.equal(items.length, 1, 'contact activity triggered the auto follow-up');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd products/outreach && set -a; . ../../.env; set +a; POSTGRES_HOST=localhost node --import tsx --test tests/prospect-touchpoints.test.ts`
Expected: FAIL — `drainTouchpointWrites` not exported; `lastContactedAt` undefined after send.

- [ ] **Step 3: Implement the hooks in `prospect-repository.ts`**

(a) Add near the top of the file (after imports; import `ensureFollowUpForProspect` from `./action-item-repository`, `CONTACT_ACTIVITY_TYPES` from `../domain/types`, and reuse the file's existing logger or `console.error`):

```ts
const touchpointWritesInFlight = new Set<Promise<void>>();

/** Await in-flight cross-store touchpoint writes (tests only). */
export async function drainTouchpointWrites(): Promise<void> {
  await Promise.all([...touchpointWritesInFlight]);
}

/**
 * Fire-and-forget the auto follow-up. Postgres must never fail the graph
 * operation (same contract as emitProductEvent).
 */
function scheduleFollowUp(prospectId: string, prospectName: string): void {
  const task = ensureFollowUpForProspect(prospectId, prospectName).catch((error) => {
    console.error('action_items.auto_followup_failed', error);
  });
  touchpointWritesInFlight.add(task);
  void task.finally(() => touchpointWritesInFlight.delete(task));
}
```

(b) In `updateOutreachMessage` (~line 869): extend the Cypher so a send stamps the prospect, and return the prospect for the hook. Change the `SET`/`RETURN` portion:

```cypher
MATCH (l:Prospect)-[:HAS_OUTREACH]->(m:OutreachMessage {id: $messageId})
WITH l, m, m.status AS previousStatus
SET ${setClauses.join(', ')}
FOREACH (_ IN CASE WHEN $recordSentActivity THEN [1] ELSE [] END |
  SET l.lastContactedAt = localdatetime()
)
FOREACH (_ IN CASE WHEN $recordSentActivity AND previousStatus <> 'sent' THEN [1] ELSE [] END |
  CREATE (a:ProspectActivity { ... unchanged ... })
  CREATE (l)-[:HAS_ACTIVITY]->(a)
)
RETURN m, l.id AS prospectId, l.name AS prospectName
```

(FalkorDB supports `SET` inside `FOREACH`; if `pnpm test` reveals it does not, replace with `SET l.lastContactedAt = CASE WHEN $recordSentActivity THEN localdatetime() ELSE l.lastContactedAt END` appended to the main SET clause list.)

After the existing `emitProductEventFromContext` block (~line 908), add:

```ts
if (data.status === 'sent') {
  scheduleFollowUp(
    result.records[0].get('prospectId') as string,
    result.records[0].get('prospectName') as string,
  );
}
```

(c) In `createProspectActivity` (~line 1128): add an `$isContact` param and stamp the prospect in the same query:

```cypher
MATCH (l:Prospect {id: $prospectId})
CREATE (a:ProspectActivity { ... unchanged ... })
CREATE (l)-[:HAS_ACTIVITY]->(a)
SET l.lastContactedAt = CASE
  WHEN $isContact AND (l.lastContactedAt IS NULL OR l.lastContactedAt < a.createdAt)
  THEN a.createdAt ELSE l.lastContactedAt END
RETURN a, l.name AS prospectName
```

with `isContact: CONTACT_ACTIVITY_TYPES.has(data.type)` added to the params object. After the `prospect.replied` emit block (~line 1161), add:

```ts
if (CONTACT_ACTIVITY_TYPES.has(data.type)) {
  scheduleFollowUp(prospectId, record.get('prospectName') as string);
}
```

Note: the `outreach_sent` activity created inside `updateOutreachMessage`'s FOREACH does not go through `createProspectActivity` — that path is covered by hook (b). Double-stamping cannot occur because the two functions are separate entry points.

- [ ] **Step 4: Run the new test to verify it passes**

Run: same command as Step 2. Expected: both tests PASS.

- [ ] **Step 5: Run the full outreach suite for regressions**

Run: `cd products/outreach && set -a; . ../../.env; set +a; POSTGRES_HOST=localhost pnpm test`
Expected: PASS (notably `prospect-activity-events.test.ts` — its sent-twice test must still record exactly one activity).

- [ ] **Step 6: Commit**

```bash
git add products/outreach/data/prospect-repository.ts products/outreach/tests/prospect-touchpoints.test.ts
git commit -m "feat(outreach): touchpoints set lastContactedAt and auto-create follow-ups"
```

---

### Task 4: API routes + architecture guard

**Files:**
- Create: `apps/outreach/app/api/outreach/action-items/route.ts` (GET, POST)
- Create: `apps/outreach/app/api/outreach/action-items/[id]/route.ts` (PATCH, DELETE)
- Modify: `tests/architecture/prospect-route-tenant-scope.test.mjs:12` (add root)
- Modify: `products/outreach/data/prospect-repository.ts` (add `getProspectSummariesByIds`)

**Interfaces:**
- Consumes: repository functions from Task 2; `withProspectOrg`; `completeActionItem` writes the graph activity here at the route level (see Step 2 — keeps the repository single-store).
- Produces:
  - `GET /api/outreach/action-items?horizonDays=7` → `{ items: Array<ActionItem & { prospect: { id: string; name: string; company?: string; status: string } | null }> }` (open items due before now + horizonDays; `horizonDays` optional, default 7, max 90)
  - `POST /api/outreach/action-items` body `{ title: string; dueAt: string; prospectId?: string }` → 201 `ActionItem`
  - `PATCH /api/outreach/action-items/[id]` body `{ action: 'complete' | 'dismiss' } | { title?: string; dueAt?: string }` → `ActionItem` | 404
  - `DELETE /api/outreach/action-items/[id]` → `{ deleted: boolean }`
  - `getProspectSummariesByIds(ids: string[]): Promise<Map<string, { id: string; name: string; company?: string; status: string }>>` in prospect-repository

- [ ] **Step 1: Add `getProspectSummariesByIds` to `prospect-repository.ts`**

```ts
export async function getProspectSummariesByIds(
  ids: string[],
): Promise<Map<string, { id: string; name: string; company?: string; status: string }>> {
  const summaries = new Map<string, { id: string; name: string; company?: string; status: string }>();
  if (ids.length === 0) return summaries;
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (l:Prospect)
      WHERE l.id IN $ids
      RETURN l.id AS id, l.name AS name, l.company AS company, l.status AS status
      `,
      { ids }
    );
    for (const record of result.records) {
      const id = record.get('id') as string;
      summaries.set(id, {
        id,
        name: record.get('name') as string,
        company: (record.get('company') as string | null) ?? undefined,
        status: (record.get('status') as string | null) ?? 'new',
      });
    }
    return summaries;
  } finally {
    await session.close();
  }
}
```

- [ ] **Step 2: Create the collection route**

`apps/outreach/app/api/outreach/action-items/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withProspectOrg } from '@/lib/prospect-scope';
import {
  createActionItem,
  listOpenActionItems,
} from '@/products/outreach/data/action-item-repository';
import { getProspectSummariesByIds } from '@/products/outreach/data/prospect-repository';

const createSchema = z.object({
  title: z.string().trim().min(1).max(500),
  dueAt: z.string().datetime({ offset: true }),
  prospectId: z.string().min(1).optional(),
});

export async function GET(request: NextRequest) {
  return withProspectOrg(request, async () => {
    try {
      const raw = Number(request.nextUrl.searchParams.get('horizonDays') ?? '7');
      const horizonDays = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 90) : 7;
      const dueBefore = new Date(Date.now() + horizonDays * 86_400_000).toISOString();
      const open = await listOpenActionItems({ dueBefore });
      const prospects = await getProspectSummariesByIds(
        [...new Set(open.map((item) => item.prospectId).filter((id): id is string => Boolean(id)))],
      );
      return NextResponse.json({
        items: open.map((item) => ({
          ...item,
          prospect: item.prospectId ? prospects.get(item.prospectId) ?? null : null,
        })),
      });
    } catch (error) {
      console.error('Error listing action items:', error);
      return NextResponse.json({ error: 'Failed to list action items' }, { status: 500 });
    }
  });
}

export async function POST(request: NextRequest) {
  return withProspectOrg(request, async () => {
    try {
      const parsed = createSchema.safeParse(await request.json());
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Provide a title and a valid ISO due date.' },
          { status: 400 },
        );
      }
      const item = await createActionItem(parsed.data);
      return NextResponse.json(item, { status: 201 });
    } catch (error) {
      console.error('Error creating action item:', error);
      return NextResponse.json({ error: 'Failed to create action item' }, { status: 500 });
    }
  });
}
```

(If `zod` is not already a dependency of `apps/outreach`, check `apps/outreach/package.json`; `prospects/route.ts` uses it, so it is.)

- [ ] **Step 3: Create the item route**

`apps/outreach/app/api/outreach/action-items/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withProspectOrg } from '@/lib/prospect-scope';
import {
  completeActionItem,
  deleteActionItem,
  dismissActionItem,
  updateActionItem,
} from '@/products/outreach/data/action-item-repository';
import { createProspectActivity } from '@/products/outreach/data/prospect-repository';

const patchSchema = z.union([
  z.object({ action: z.enum(['complete', 'dismiss']) }),
  z.object({
    title: z.string().trim().min(1).max(500).optional(),
    dueAt: z.string().datetime({ offset: true }).optional(),
  }).refine((value) => value.title !== undefined || value.dueAt !== undefined, {
    message: 'Provide a title or a due date.',
  }),
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await params;
      const parsed = patchSchema.safeParse(await request.json());
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid action item update.' }, { status: 400 });
      }
      const body = parsed.data;
      const item = 'action' in body
        ? body.action === 'complete'
          ? await completeActionItem(id)
          : await dismissActionItem(id)
        : await updateActionItem(id, body);
      if (!item) {
        return NextResponse.json({ error: 'Action item not found' }, { status: 404 });
      }
      if ('action' in body && body.action === 'complete' && item.prospectId) {
        // History lives on the prospect timeline; the repository stays single-store.
        await createProspectActivity(item.prospectId, {
          type: 'next_action_completed',
          title: item.title,
        }).catch((error) => console.error('Failed to record completion activity:', error));
      }
      return NextResponse.json(item);
    } catch (error) {
      console.error('Error updating action item:', error);
      return NextResponse.json({ error: 'Failed to update action item' }, { status: 500 });
    }
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await params;
      return NextResponse.json({ deleted: await deleteActionItem(id) });
    } catch (error) {
      console.error('Error deleting action item:', error);
      return NextResponse.json({ error: 'Failed to delete action item' }, { status: 500 });
    }
  });
}
```

Note: `next_action_completed` is NOT a contact type, so completing an item does not bump `lastContactedAt` or trigger a new auto follow-up — this is intentional; verify `CONTACT_ACTIVITY_TYPES` does not include it.

- [ ] **Step 4: Extend the architecture guard**

In `tests/architecture/prospect-route-tenant-scope.test.mjs`, change `ROOTS` to:

```js
const ROOTS = [
  "apps/outreach/app/api/outreach/prospects",
  "apps/outreach/app/api/outreach/accounts",
  "apps/outreach/app/api/outreach/action-items",
];
```

- [ ] **Step 5: Run the architecture test and typecheck**

Run: `pnpm test:architecture`
Expected: PASS (both new route files contain `withProspectOrg`).
Run: `pnpm --filter @content-automation/outreach-app typecheck 2>/dev/null || (cd apps/outreach && npx tsc --noEmit)`
Expected: no errors. (Check `apps/outreach/package.json` for the actual typecheck/lint script name and use that.)

- [ ] **Step 6: Commit**

```bash
git add apps/outreach/app/api/outreach/action-items tests/architecture/prospect-route-tenant-scope.test.mjs products/outreach/data/prospect-repository.ts
git commit -m "feat(outreach): org-scoped action item API routes"
```

---

### Task 5: Due-view helper (pure, TDD)

**Files:**
- Create: `products/outreach/domain/action-item-view.ts`
- Test: `products/outreach/tests/action-item-view.test.ts`

**Interfaces:**
- Consumes: `ActionItem` type (Task 2).
- Produces (used by Tasks 6–8):
  - `dueTone(dueAt: string, now: Date): 'overdue' | 'today' | 'upcoming'`
  - `dueLabel(dueAt: string, now: Date): string` — `"Overdue · yesterday"`, `"Overdue · 2 days ago"`, `"Overdue · 4 Aug"` (>6 days), `"Due today"`, `"Tomorrow"`, `"In 3 days"`, `"12 Aug"` (>6 days ahead)
  - `groupByDue<T extends { dueAt: string }>(items: T[], now: Date): { overdue: T[]; today: T[]; upcoming: T[] }` (input order preserved — items arrive due-date-sorted)

- [ ] **Step 1: Write the failing test**

`products/outreach/tests/action-item-view.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { dueLabel, dueTone, groupByDue } from '../domain/action-item-view';

// Fixed clock: Monday 2026-08-10T12:00 local.
const NOW = new Date(2026, 7, 10, 12, 0, 0);
const onDay = (day: number, hour = 9) => new Date(2026, 7, day, hour).toISOString();

test('dueTone classifies by calendar day, not 24h windows', () => {
  assert.equal(dueTone(onDay(9, 23), NOW), 'overdue');   // yesterday evening
  assert.equal(dueTone(onDay(10, 1), NOW), 'today');     // this morning (earlier hour, same day)
  assert.equal(dueTone(onDay(10, 23), NOW), 'today');
  assert.equal(dueTone(onDay(11, 1), NOW), 'upcoming');
});

test('dueLabel wording', () => {
  assert.equal(dueLabel(onDay(9), NOW), 'Overdue · yesterday');
  assert.equal(dueLabel(onDay(8), NOW), 'Overdue · 2 days ago');
  assert.equal(dueLabel(onDay(4), NOW), 'Overdue · 6 days ago');
  assert.equal(dueLabel(onDay(3), NOW), 'Overdue · 3 Aug');
  assert.equal(dueLabel(onDay(10), NOW), 'Due today');
  assert.equal(dueLabel(onDay(11), NOW), 'Tomorrow');
  assert.equal(dueLabel(onDay(13), NOW), 'In 3 days');
  assert.equal(dueLabel(onDay(17), NOW), '17 Aug');
});

test('groupByDue partitions preserving order', () => {
  const items = [
    { id: 'a', dueAt: onDay(8) },
    { id: 'b', dueAt: onDay(9) },
    { id: 'c', dueAt: onDay(10) },
    { id: 'd', dueAt: onDay(12) },
  ];
  const groups = groupByDue(items, NOW);
  assert.deepEqual(groups.overdue.map((entry) => entry.id), ['a', 'b']);
  assert.deepEqual(groups.today.map((entry) => entry.id), ['c']);
  assert.deepEqual(groups.upcoming.map((entry) => entry.id), ['d']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd products/outreach && node --import tsx --test tests/action-item-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `products/outreach/domain/action-item-view.ts`**

```ts
/** Pure due-date presentation logic for action items. Calendar-day based. */

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function dayDelta(dueAt: string, now: Date): number {
  return Math.round((startOfDay(new Date(dueAt)) - startOfDay(now)) / 86_400_000);
}

function shortDate(dueAt: string): string {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(dueAt));
}

export function dueTone(dueAt: string, now: Date): 'overdue' | 'today' | 'upcoming' {
  const delta = dayDelta(dueAt, now);
  if (delta < 0) return 'overdue';
  if (delta === 0) return 'today';
  return 'upcoming';
}

export function dueLabel(dueAt: string, now: Date): string {
  const delta = dayDelta(dueAt, now);
  if (delta === 0) return 'Due today';
  if (delta === -1) return 'Overdue · yesterday';
  if (delta < 0 && delta >= -6) return `Overdue · ${-delta} days ago`;
  if (delta < 0) return `Overdue · ${shortDate(dueAt)}`;
  if (delta === 1) return 'Tomorrow';
  if (delta <= 6) return `In ${delta} days`;
  return shortDate(dueAt);
}

export function groupByDue<T extends { dueAt: string }>(
  items: T[],
  now: Date,
): { overdue: T[]; today: T[]; upcoming: T[] } {
  const groups = { overdue: [] as T[], today: [] as T[], upcoming: [] as T[] };
  for (const item of items) groups[dueTone(item.dueAt, now)].push(item);
  return groups;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add products/outreach/domain/action-item-view.ts products/outreach/tests/action-item-view.test.ts
git commit -m "feat(outreach): due-date grouping and labels for action items"
```

---

### Task 6: `NextActionCard` on the prospect detail page

**Files:**
- Create: `products/outreach/ui/components/prospects/NextActionCard.tsx`
- Modify: `products/outreach/ui/components/prospects/index.ts` (barrel export)
- Modify: `apps/outreach/app/outreach/prospects/[id]/page.tsx` (fetch + render above `ActivityTimeline`, ~line 777)

**Interfaces:**
- Consumes: routes from Task 4, `dueLabel`/`dueTone` (Task 5), `ActionItem` (Task 2), shadcn `Card`/`Button`/`Badge`/`Popover`/`Input` from `@/components/ui/*`, sonner `toast`.
- Produces: `NextActionCard` component with props `{ items: ActionItem[]; isLoading: boolean; onComplete: (id: string) => void; onSnooze: (id: string, dueAt: string) => void; onCreate: (title: string, dueAt: string) => void; onEdit: (id: string, title: string, dueAt: string) => void }` — shows earliest-due open item + "+N more", or the empty state with an inline create form.

- [ ] **Step 1: Build the component**

`products/outreach/ui/components/prospects/NextActionCard.tsx` — client component. Layout rules: shadcn `Card` with `CardHeader` title "Next action"; body shows earliest item (`items[0]`): title, `Badge` with `dueLabel(item.dueAt, new Date())` — tone mapping: `overdue` → `variant="destructive"`, `today` → `variant="default"`, `upcoming` → `variant="secondary"`. Action row: `Done` button (size sm), `Snooze` popover with four options, `Edit` toggles an inline form (Input for title + `<input type="date">` styled via the shared `Input`). When `items.length > 1` render a muted "`+N` more scheduled" line. Empty state: muted "No next action" with inline title + date inputs and a "Set next action" button. Loading: two `Skeleton` rows inside the same Card. Snooze presets compute ISO strings client-side:

```ts
const SNOOZE_PRESETS = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
] as const;
const presetDueAt = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
};
```

plus a native date input for "Pick a date" (submit converts with `new Date(value + 'T09:00').toISOString()`). No entrance animation, `transition-colors` only, semantic tokens only.

- [ ] **Step 2: Export from the barrel**

Add `export { NextActionCard } from "./NextActionCard";` to `products/outreach/ui/components/prospects/index.ts`.

- [ ] **Step 3: Wire into the detail page**

In `apps/outreach/app/outreach/prospects/[id]/page.tsx`:
- State: `const [actionItems, setActionItems] = useState<ActionItem[]>([]); const [actionItemsLoading, setActionItemsLoading] = useState(true);`
- Loader (alongside the existing activity/outreach loaders, same fetch style):

```ts
const loadActionItems = useCallback(async () => {
  try {
    const response = await fetch(`/api/outreach/action-items?horizonDays=90`);
    if (!response.ok) throw new Error('Failed to load action items');
    const data = await response.json();
    setActionItems(
      (data.items as (ActionItem & { prospect: unknown })[])
        .filter((item) => item.prospectId === prospectId),
    );
  } catch {
    toast.error('Could not load the next action.');
  } finally {
    setActionItemsLoading(false);
  }
}, [prospectId]);
```

- Handlers calling PATCH/POST then `loadActionItems()`; `onComplete` also calls the existing activities refresh so the timeline shows `next_action_completed`. Success toasts: "Action completed", "Snoozed", "Next action set".
- Render `<NextActionCard … />` as the FIRST child of the right column `div.space-y-4.lg:col-span-2` (above `ActivityTimeline`, ~line 777).

- [ ] **Step 4: Verify**

Run the app typecheck (script found in Task 4 Step 5) and `pnpm dev:outreach`; open a prospect, set an action, snooze it, complete it — timeline gains "Action completed" entry.
Expected: no console errors; card renders in all three states.

- [ ] **Step 5: Commit**

```bash
git add products/outreach/ui/components/prospects/NextActionCard.tsx products/outreach/ui/components/prospects/index.ts "apps/outreach/app/outreach/prospects/[id]/page.tsx"
git commit -m "feat(outreach): next-action card on prospect detail"
```

---

### Task 7: Overview page "Due" dashboard

**Files:**
- Create: `apps/outreach/components/DueActionsCard.tsx` (client component)
- Modify: `apps/outreach/app/outreach/page.tsx:76-158` (replace the hardcoded queue array + ListCard)

**Interfaces:**
- Consumes: `GET /api/outreach/action-items?horizonDays=7`, `PATCH` for done/snooze (Task 4), `groupByDue`/`dueLabel`/`dueTone` (Task 5).
- Produces: `DueActionsCard` (no props) — self-fetching client card.

- [ ] **Step 1: Build `DueActionsCard`**

Client component. Fetch on mount into `{ items, loading }`. Group with `groupByDue(items, new Date())`. Render one `ListCard` titled **"Due"**, description "What needs your attention, oldest first.":
- Three labeled sections in order **Overdue**, **Due today**, **Upcoming**: a muted uppercase `text-xs` heading row (rendered only when its group is non-empty) followed by `ListRow`s.
- Each row: `title` = action item title; `meta` = `[prospect name · company, dueLabel]` (prospect part omitted when `prospect` is null); `href` = `/outreach/prospects/{prospectId}` when present; `badge` = `Badge` with tone variant (destructive/default/secondary as in Task 6); `actions` = row buttons for **Done** and **Snooze +3d** (use `ListRow`'s `actions` API — check `packages/ui/components/ListRow.tsx:15` `ListRowAction` for the exact shape; if it only supports `href` actions, render small ghost `Button`s in a trailing slot instead — inspect the component before deciding).
- Done → `PATCH { action: 'complete' }`, toast "Action completed", refetch. Snooze → `PATCH { dueAt: presetDueAt(3) }`, toast "Snoozed 3 days", refetch.
- Loading: 5 `Skeleton` rows inside the same `ListCard`. Empty: centered §4 empty state — `CheckCircle2` icon, "All caught up", "Action items appear here as you contact prospects or set follow-ups."
- Errors: `toast.error('Could not load due actions.')`, card stays with last data.

- [ ] **Step 2: Replace the fake queue on the overview page**

In `apps/outreach/app/outreach/page.tsx`: delete the `queue` array (lines 76-105) and the "Your outreach queue" `ListCard` (lines 129-158); render `<DueActionsCard />` in its place. Remove now-unused imports (`Search`, `Sparkles`, `CircleDot`, and `FileText` only if unused elsewhere — it is still used by the drafts card). The page stays a server component; `DueActionsCard` is `"use client"`.

- [ ] **Step 3: Verify**

`pnpm dev:outreach` → `http://localhost:3004/outreach`: with the Task 6 data, overdue/today/upcoming sections render correctly; Done and Snooze work and toast; empty org shows "All caught up".
Run the outreach app typecheck.
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/outreach/components/DueActionsCard.tsx apps/outreach/app/outreach/page.tsx
git commit -m "feat(outreach): real due-actions dashboard on the overview page"
```

---

### Task 8: Account page rows + prospect list due badges

**Files:**
- Modify: `products/outreach/data/account-repository.ts:270-286` (`AccountProspectSummary` + `getAccountDetail`)
- Modify: `apps/outreach/app/api/outreach/accounts/[id]/route.ts` (merge action-item + lastContactedAt data)
- Modify: `products/outreach/ui/components/prospects/AccountProspectsSection.tsx` (columns)
- Modify: `apps/outreach/app/outreach/prospects/page.tsx` (due badges)

**Interfaces:**
- Consumes: `getOpenActionItemsForProspects` (Task 2), `dueLabel`/`dueTone` (Task 5).
- Produces: `AccountProspectSummary` gains `lastContactedAt?: string` and `nextAction?: { id: string; title: string; dueAt: string } | null`; `AccountProspectRow` mirrors both.

- [ ] **Step 1: Extend `getAccountDetail`**

In `account-repository.ts`, add `lastContactedAt` to the prospect mapping (`lastContactedAt: p.lastContactedAt?.toString()` — same convention as `prospect-repository.ts:655`) and to `AccountProspectSummary`. Add `nextAction?: { id: string; title: string; dueAt: string } | null` to the interface, but do NOT query Postgres from this graph repository — the route merges it.

- [ ] **Step 2: Merge in the account route**

In `apps/outreach/app/api/outreach/accounts/[id]/route.ts`, after `getAccountDetail(id)`:

```ts
const open = await getOpenActionItemsForProspects(account.prospects.map((prospect) => prospect.id));
const prospects = account.prospects.map((prospect) => {
  const next = open.get(prospect.id)?.[0];
  return { ...prospect, nextAction: next ? { id: next.id, title: next.title, dueAt: next.dueAt } : null };
});
return NextResponse.json({ ...account, prospects });
```

- [ ] **Step 3: Show it in `AccountProspectsSection`**

Extend `AccountProspectRow` with `lastContactedAt?: string; nextAction?: { id: string; title: string; dueAt: string } | null`. In the prospects `Table`, add two columns:
- **Last contacted**: relative date (reuse the pattern from `ActivityTimeline.tsx:76`'s relative formatter — extract it to a small local helper or duplicate the 6-line function) or an em dash `—` when unset.
- **Next action**: `nextAction.title` truncated (`max-w-48 truncate`) + `Badge` with `dueLabel(nextAction.dueAt, new Date())` in the tone variant; em dash when null.

Verify the account page passes the new fields through (check where `AccountProspectRow[]` is built in `apps/outreach/app/outreach/accounts/[id]/page.tsx` and map both fields).

- [ ] **Step 4: Due badges on the prospect list**

In `apps/outreach/app/outreach/prospects/page.tsx`: on mount (alongside the existing loaders), fetch `/api/outreach/action-items?horizonDays=90` once into a `Map<prospectId, ActionItem>` (first per prospect = earliest due). In each `ListRow` (~line 393), append to `meta` when the map has an entry: a `Badge` with `dueLabel` in the tone variant (destructive for overdue, default for today, secondary otherwise). The existing `lastActivity` display now benefits from real `lastContactedAt` automatically — no change needed.

- [ ] **Step 5: Verify + commit**

Typecheck the outreach app; in the dev app confirm the account page shows last-contacted + next-action columns and the prospect list shows due badges.

```bash
git add products/outreach/data/account-repository.ts "apps/outreach/app/api/outreach/accounts/[id]/route.ts" products/outreach/ui/components/prospects/AccountProspectsSection.tsx apps/outreach/app/outreach/prospects/page.tsx "apps/outreach/app/outreach/accounts/[id]/page.tsx"
git commit -m "feat(outreach): surface touchpoints and next actions on account and list views"
```

---

### Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full outreach test suite**

Run: `cd products/outreach && set -a; . ../../.env; set +a; POSTGRES_HOST=localhost pnpm test`
Expected: PASS, including the three new test files.

- [ ] **Step 2: Architecture tests**

Run: `pnpm test:architecture`
Expected: PASS.

- [ ] **Step 3: Build the outreach app**

Run: `pnpm build:outreach`
Expected: clean build. (On this 8 GB machine, stop the dev server first.)

- [ ] **Step 4: Manual smoke via dev app**

`pnpm dev:outreach`: create prospect → generate/mark outreach sent → confirm `lastContactedAt` on detail, auto follow-up appears in NextActionCard and overview Due card → snooze → complete → timeline entry. Verify the account page columns.

- [ ] **Step 5: Commit any stragglers; do not push (user pushes after review or asks for merge)**
