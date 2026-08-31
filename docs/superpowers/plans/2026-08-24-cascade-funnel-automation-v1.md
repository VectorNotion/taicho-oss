# Cascade Funnel Automation v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat funnel lists with a persisted automation graph — typed nodes (touch/wait/branch/goal/route), labeled edges, per-member cursor — edited through the restored `FunnelVisualBuilder` on the real funnel page.

**Architecture:** New `funnel_nodes`/`funnel_edges`/`funnel_events` tables plus columns on `funnels`/`funnel_members` (org-RLS like every cascade table). A pure validation module gates a replace-all `putGraph`. Three new registry capabilities (`cascade.graph.get`, `cascade.graph.put`, `cascade.member.move`) plus an extended funnel detail read. The pre-simplification builder components (already restored under `apps/styleguide/components/funnel-legacy/`) move to `products/cascade/components/` with the node vocabulary swapped to the spec's, and `apps/unified/app/cascade/funnels/[id]/page.tsx` becomes builder-first.

**Tech Stack:** Drizzle (schema + `pnpm db:generate`), zod, capability registry (`packages/capabilities`), `@xyflow/react@12.11.2`, Next.js unified app, vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-cascade-funnel-steps-design.md`

**v1 scope cut (deliberate, spec §2 deferred):** no touch generation, no reply ingest/classification, no predicate evaluation runtime, no due computation, no per-node metrics. This plan delivers structure + member positions + events end-to-end. The brain jobs are the next plan.

## Global Constraints

- Postgres `cascade` schema; every new table carries the attribution columns (`created_by`, `actor_type`, `request_id`, `parent_execution_id`, `trace_id`, `traceparent`), `organization_id text().default(organizationIdDefault)`, an org RLS `pgPolicy`, and a `uniqueIndex` on `(organization_id, id)` — copy the exact pattern of `funnel_membersInCascade` in `packages/database/schema/tables.ts:1258`.
- Migrations are generated (`pnpm db:generate`), never hand-written; `pnpm db:migrate` must apply cleanly; `node --test tests/architecture/database-migrations.test.mjs` and `tests/architecture/local-database-parity.test.mjs` must pass.
- No new route files in `apps/unified/app/api` — all server surface goes through `packages/capabilities/catalog-cascade.ts` (single-registry rule).
- Graph is **forward-only**: `putGraph` rejects any cycle (Rajesh's "no step back" decision).
- UI copy: never "node", "predicate", "classifier" — say "step", "If they…", "the AI decides".
- Dark design language per `docs/design-language.md`; semantic tokens only.
- Commit after every task (main, push after fetch).

---

### Task 1: Schema + migration

**Files:**
- Modify: `packages/database/schema/tables.ts` (after `funnel_membersInCascade`, ~line 1280)
- Generated: `packages/database/migrations/0035_*.sql` via `pnpm db:generate`

**Interfaces:**
- Produces: exports `funnel_nodesInCascade`, `funnel_edgesInCascade`, `funnel_eventsInCascade`; new columns on `funnelsInCascade` (`goal_type`, `goal_description`, `send_window`, `auto_approve`, `reentry_days`, `builder_layout`, `entry_node_id`) and on `funnel_membersInCascade` (`current_node_id`, `status`, `status_reason`, `entered_node_at`, `attempt`, `snoozed_until`).

- [ ] **Step 1: Add columns to `funnelsInCascade`** (inside its existing column object):

```ts
	goal_type: text().default('reply').notNull(),
	goal_description: text().default('').notNull(),
	send_window: jsonb(),
	auto_approve: boolean().default(false).notNull(),
	reentry_days: integer(),
	builder_layout: jsonb().default({}).notNull(),
	entry_node_id: uuid(),
```

- [ ] **Step 2: Add columns to `funnel_membersInCascade`**:

```ts
	current_node_id: uuid(),
	status: text().default('active').notNull(),
	status_reason: text(),
	entered_node_at: timestamp({ withTimezone: true, mode: 'string' }),
	attempt: integer().default(0).notNull(),
	snoozed_until: timestamp({ withTimezone: true, mode: 'string' }),
```

- [ ] **Step 3: Add the three tables** after `funnel_membersInCascade`, copying its attribution/RLS/index pattern verbatim (policy name `<table>_organization_policy`):

```ts
export const funnel_nodesInCascade = cascade.table("funnel_nodes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	funnel_id: uuid().notNull(),
	type: text().notNull(),
	name: text().default('').notNull(),
	config: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: text(), actor_type: text(), request_id: text(),
	parent_execution_id: text(), trace_id: text(), traceparent: text(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	foreignKey({ columns: [table.funnel_id, table.organization_id], foreignColumns: [funnelsInCascade.id, funnelsInCascade.organization_id], name: "funnel_nodes_funnel_id_organization_fkey" }).onDelete("cascade"),
	uniqueIndex("funnel_nodes_organization_id_id_key").on(table.organization_id, table.id),
	index("funnel_nodes_funnel_idx").on(table.funnel_id),
	pgPolicy("funnel_nodes_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))` }),
]);

export const funnel_edgesInCascade = cascade.table("funnel_edges", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	funnel_id: uuid().notNull(),
	from_node_id: uuid().notNull(),
	to_node_id: uuid().notNull(),
	label: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: text(), actor_type: text(), request_id: text(),
	parent_execution_id: text(), trace_id: text(), traceparent: text(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	foreignKey({ columns: [table.funnel_id, table.organization_id], foreignColumns: [funnelsInCascade.id, funnelsInCascade.organization_id], name: "funnel_edges_funnel_id_organization_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.from_node_id, table.organization_id], foreignColumns: [funnel_nodesInCascade.id, funnel_nodesInCascade.organization_id], name: "funnel_edges_from_node_organization_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.to_node_id, table.organization_id], foreignColumns: [funnel_nodesInCascade.id, funnel_nodesInCascade.organization_id], name: "funnel_edges_to_node_organization_fkey" }).onDelete("cascade"),
	uniqueIndex("funnel_edges_organization_id_id_key").on(table.organization_id, table.id),
	unique("funnel_edges_from_label_key").on(table.from_node_id, table.label),
	pgPolicy("funnel_edges_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))` }),
]);

export const funnel_eventsInCascade = cascade.table("funnel_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	funnel_id: uuid().notNull(),
	member_id: uuid(),
	node_id: uuid(),
	type: text().notNull(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	metadata: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: text(), actor_type: text(), request_id: text(),
	parent_execution_id: text(), trace_id: text(), traceparent: text(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	foreignKey({ columns: [table.funnel_id, table.organization_id], foreignColumns: [funnelsInCascade.id, funnelsInCascade.organization_id], name: "funnel_events_funnel_id_organization_fkey" }).onDelete("cascade"),
	uniqueIndex("funnel_events_organization_id_id_key").on(table.organization_id, table.id),
	index("funnel_events_funnel_occurred_idx").on(table.funnel_id, table.occurred_at),
	pgPolicy("funnel_events_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))` }),
]);
```

(If `boolean`, `integer`, `jsonb`, `unique` aren't imported at the top of tables.ts, add them to the existing drizzle-orm/pg-core import.)

- [ ] **Step 4: Generate + apply.** Run `pnpm db:generate` (expect `0035_*.sql`), then `pnpm db:migrate`. Expect "migrations applied"/up-to-date with the new tables present.
- [ ] **Step 5: Verify contracts.** Run `node --test tests/architecture/database-migrations.test.mjs tests/architecture/local-database-parity.test.mjs` (or the repo's equivalent invocation — check how CI runs `tests/architecture` in package.json). Expect PASS.
- [ ] **Step 6: Commit** `feat(cascade): funnel graph schema (nodes, edges, events, member cursor)`.

---

### Task 2: Graph domain + validation (pure)

**Files:**
- Create: `products/cascade/domain/graph.ts`
- Test: `products/cascade/tests/graph-validation.test.ts`
- Modify: `products/cascade/index.ts` (re-export the new module)

**Interfaces:**
- Produces:
  - `graphDocumentSchema` (zod) parsing `GraphDocument = { entryNodeId: string | null, nodes: GraphNode[], edges: GraphEdge[], layout: Record<string, {x: number, y: number}> }`
  - `GraphNode = { id: string(uuid), type: 'touch'|'wait'|'branch'|'goal'|'route', name: string, config: TouchConfig|WaitConfig|BranchConfig|GoalConfig|RouteConfig }`
  - `GraphEdge = { fromNodeId: string, toNodeId: string, label: 'next'|'yes'|'no'|'responded'|'exhausted' }`
  - `validateGraph(doc: GraphDocument): string[]` — empty array = valid.

- [ ] **Step 1: Write failing tests** (pure, no DB):

```ts
import { describe, expect, it } from "vitest";
import { validateGraph, type GraphDocument } from "../domain/graph";

const touch = (id: string) => ({ id, type: "touch" as const, name: id, config: { instruction: "write", repeat: { maxAttempts: 1, intervalDays: 3 } } });
const goal = (id: string) => ({ id, type: "goal" as const, name: id, config: {} });
const edge = (from: string, to: string, label: "next" | "yes" | "no" | "responded" | "exhausted") => ({ fromNodeId: from, toNodeId: to, label });
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const doc = (partial: Partial<GraphDocument>): GraphDocument => ({ entryNodeId: A, nodes: [], edges: [], layout: {}, ...partial });

describe("validateGraph", () => {
  it("accepts a touch that exhausts into a goal", () => {
    expect(validateGraph(doc({ nodes: [touch(A), goal(B)], edges: [edge(A, B, "exhausted")] }))).toEqual([]);
  });
  it("rejects a missing entry node", () => {
    expect(validateGraph(doc({ entryNodeId: null, nodes: [touch(A)] }))[0]).toMatch(/entry/i);
  });
  it("rejects edges to unknown nodes", () => {
    expect(validateGraph(doc({ nodes: [touch(A)], edges: [edge(A, B, "exhausted")] }))[0]).toMatch(/unknown/i);
  });
  it("rejects labels illegal for the node type", () => {
    expect(validateGraph(doc({ nodes: [touch(A), goal(B)], edges: [edge(A, B, "yes")] }))[0]).toMatch(/label/i);
  });
  it("requires both yes and no on a branch", () => {
    const branch = { id: B, type: "branch" as const, name: "b", config: { condition: { kind: "event" as const, event: "replied" as const } } };
    const errors = validateGraph(doc({ nodes: [touch(A), branch, goal(C)], edges: [edge(A, B, "exhausted"), edge(B, C, "yes")] }));
    expect(errors[0]).toMatch(/no/i);
  });
  it("rejects unreachable nodes", () => {
    expect(validateGraph(doc({ nodes: [touch(A), goal(B), goal(C)], edges: [edge(A, B, "exhausted")] }))[0]).toMatch(/unreachable/i);
  });
  it("rejects cycles (forward-only)", () => {
    const errors = validateGraph(doc({ nodes: [touch(A), touch(B)], edges: [edge(A, B, "exhausted"), edge(B, A, "exhausted")] }));
    expect(errors.some((error) => /cycle|back/i.test(error))).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @content-automation/cascade exec vitest run tests/graph-validation.test.ts` (match how `pnpm test:cascade` invokes vitest). Expect FAIL (module missing).
- [ ] **Step 3: Implement `products/cascade/domain/graph.ts`:**

```ts
import { z } from "zod";

export const NODE_TYPES = ["touch", "wait", "branch", "goal", "route"] as const;
export const EDGE_LABELS = ["next", "yes", "no", "responded", "exhausted"] as const;

const touchConfig = z.object({
  instruction: z.string().max(20_000).default(""),
  model: z.string().max(200).optional(),
  repeat: z.object({
    maxAttempts: z.number().int().min(1).max(10).default(1),
    intervalDays: z.number().int().min(1).max(90).default(3),
  }).default({ maxAttempts: 1, intervalDays: 3 }),
});
const waitConfig = z.object({ days: z.number().int().min(0).max(365) });
const branchCondition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), event: z.enum(["replied", "positive_reply", "clicked", "opened"]) }),
  z.object({ kind: z.literal("attribute"), key: z.string().min(1).max(200), equals: z.string().max(500) }),
  z.object({ kind: z.literal("predicate"), prompt: z.string().min(1).max(5_000) }),
]);
const branchConfig = z.object({ condition: branchCondition });
const goalConfig = z.object({ outcome: z.string().max(200).optional() });
const routeConfig = z.object({ toFunnelId: z.string().uuid() });

const graphNodeSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().uuid(), type: z.literal("touch"), name: z.string().max(300), config: touchConfig }),
  z.object({ id: z.string().uuid(), type: z.literal("wait"), name: z.string().max(300), config: waitConfig }),
  z.object({ id: z.string().uuid(), type: z.literal("branch"), name: z.string().max(300), config: branchConfig }),
  z.object({ id: z.string().uuid(), type: z.literal("goal"), name: z.string().max(300), config: goalConfig }),
  z.object({ id: z.string().uuid(), type: z.literal("route"), name: z.string().max(300), config: routeConfig }),
]);
const graphEdgeSchema = z.object({
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
  label: z.enum(EDGE_LABELS),
});
export const graphDocumentSchema = z.object({
  entryNodeId: z.string().uuid().nullable(),
  nodes: z.array(graphNodeSchema).max(200),
  edges: z.array(graphEdgeSchema).max(500),
  layout: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).default({}),
});

export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type GraphDocument = z.infer<typeof graphDocumentSchema>;

const ALLOWED_OUT: Record<GraphNode["type"], readonly string[]> = {
  touch: ["responded", "exhausted"],
  wait: ["next"],
  branch: ["yes", "no"],
  goal: [],
  route: [],
};
const REQUIRED_OUT: Record<GraphNode["type"], readonly string[]> = {
  touch: ["exhausted"],
  wait: ["next"],
  branch: ["yes", "no"],
  goal: [],
  route: [],
};

export function validateGraph(doc: GraphDocument): string[] {
  const errors: string[] = [];
  const nodeById = new Map(doc.nodes.map((node) => [node.id, node]));
  if (doc.nodes.length === 0) return ["The funnel needs at least one step."];
  if (!doc.entryNodeId || !nodeById.has(doc.entryNodeId)) errors.push("The funnel has no entry step.");
  const seenLabels = new Set<string>();
  for (const edge of doc.edges) {
    const from = nodeById.get(edge.fromNodeId);
    if (!from || !nodeById.has(edge.toNodeId)) { errors.push(`An arrow points at an unknown step (${edge.fromNodeId} → ${edge.toNodeId}).`); continue; }
    if (!ALLOWED_OUT[from.type].includes(edge.label)) errors.push(`"${from.name || from.type}" cannot have a "${edge.label}" label.`);
    const key = `${edge.fromNodeId}:${edge.label}`;
    if (seenLabels.has(key)) errors.push(`"${from.name || from.type}" has two "${edge.label}" arrows.`);
    seenLabels.add(key);
  }
  for (const node of doc.nodes) {
    for (const required of REQUIRED_OUT[node.type]) {
      if (!doc.edges.some((edge) => edge.fromNodeId === node.id && edge.label === required)) {
        errors.push(`"${node.name || node.type}" is missing its "${required === "next" ? "next" : required === "exhausted" ? "no response" : required}" arrow.`);
      }
    }
  }
  if (doc.entryNodeId && nodeById.has(doc.entryNodeId)) {
    const reachable = new Set<string>([doc.entryNodeId]);
    const queue = [doc.entryNodeId];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of doc.edges) {
        if (edge.fromNodeId === current && nodeById.has(edge.toNodeId) && !reachable.has(edge.toNodeId)) {
          reachable.add(edge.toNodeId);
          queue.push(edge.toNodeId);
        }
      }
    }
    for (const node of doc.nodes) if (!reachable.has(node.id)) errors.push(`"${node.name || node.type}" is unreachable from the entry step.`);
  }
  // Forward-only: reject cycles via DFS coloring.
  const color = new Map<string, 1 | 2>();
  const hasCycle = (id: string): boolean => {
    color.set(id, 1);
    for (const edge of doc.edges) {
      if (edge.fromNodeId !== id || !nodeById.has(edge.toNodeId)) continue;
      const c = color.get(edge.toNodeId);
      if (c === 1) return true;
      if (!c && hasCycle(edge.toNodeId)) return true;
    }
    color.set(id, 2);
    return false;
  };
  if (doc.nodes.some((node) => !color.has(node.id) && hasCycle(node.id))) {
    errors.push("The funnel loops back on itself — steps only ever move forward.");
  }
  return errors;
}
```

- [ ] **Step 4: Re-run the test.** Expect PASS. Add `export * from "./domain/graph";` to `products/cascade/index.ts` (match its existing export style) and run `pnpm --filter @content-automation/cascade typecheck`.
- [ ] **Step 5: Commit** `feat(cascade): funnel graph document schema and forward-only validation`.

---

### Task 3: Graph repository + member move + events

**Files:**
- Create: `products/cascade/data/graph-repository.ts`
- Modify: `products/cascade/data/funnel-repository.ts` (extend detail read; member add lands at entry)
- Test: `products/cascade/tests/graph-repository.test.ts` (model harness on `products/cascade/tests/schema.test.ts` — reuse however it obtains a pool/organization context; if it uses a live local Postgres, do the same)

**Interfaces:**
- Consumes: Task 2's `GraphDocument`, `validateGraph`; Task 1's tables.
- Produces:
  - `getGraph(pool, funnelId): Promise<GraphDocument>`
  - `putGraph(pool, funnelId, doc: GraphDocument, attribution): Promise<{ relocatedMembers: number }>` — validates (throws `Error` with joined messages), replaces nodes/edges in one transaction, persists `layout` to `funnels.builder_layout` and `entryNodeId` to `funnels.entry_node_id`, then: members whose `current_node_id` no longer exists **or** is null move to the entry node (`status` untouched, `entered_node_at = now()`, `attempt = 0`) with a `funnel_events` row `{ type: 'advanced', metadata: { reason: 'graph_edit' } }`.
  - `moveMember(pool, funnelId, contactId, patch: { nodeId?: string | null, status?: 'active'|'paused'|'converted'|'exhausted'|'exited'|'unsubscribed', reason?: string }, attribution): Promise<void>` — updates cursor/status, resets `attempt` to 0 on node change, appends one event (`type: 'advanced'` for node change, else the status value).
  - `listEvents(pool, funnelId, limit = 50): Promise<Array<{ id, memberId, nodeId, type, occurredAt, metadata }>>` newest first.
  - Extended `getFunnelDetail` return: adds `graph: GraphDocument`, `settings: { goalType, goalDescription, autoApprove }`, member fields `currentNodeId, status, statusReason, enteredNodeAt, attempt`, `events` (listEvents result), `nodeCounts: Record<nodeId, number>` (active members per node).

- [ ] **Step 1: Write failing tests** — round-trip put/get, relocation on node delete, move + event append, member-add lands at entry. Use two orgs to assert RLS isolation the way `schema.test.ts` does.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.** All writes inside `databaseFor(pool).transaction`; delete edges before nodes; insert in dependency order; use `sql\`now()\`` for timestamps. Attribution columns filled from the `attribution` argument the way `funnel-repository.ts` fills `created_by`/`actor_type` today.
- [ ] **Step 4: Run tests + `pnpm test:cascade` + typecheck.** Expect PASS.
- [ ] **Step 5: Commit** `feat(cascade): graph repository with member relocation and funnel events`.

---

### Task 4: Capabilities

**Files:**
- Modify: `packages/capabilities/catalog-cascade.ts`
- Test: `packages/capabilities/tests/catalog-cascade-graph.test.ts` (model on the existing cascade/catalog test file style)

**Interfaces:**
- Consumes: Task 3 repository functions via the `cascadeModule()` dynamic import (add re-exports to `products/cascade/index.ts`).
- Produces REST surface (mirrored to MCP automatically):
  - `cascade.graph.get` — GET `/cascade/funnels/:id/graph` → `{ graph: GraphDocument }` (query capability, `vn:cascade:read` scope, mirror how the existing GET list/detail queries are defined in this file)
  - `cascade.graph.put` — `registerCascadeCommand` with method PATCH, path `/cascade/funnels/:id/graph`, `risk: "write"`, `action: "update"`, input `z.object({ id: entityId, graph: graphDocumentSchema })`, output `z.object({ relocatedMembers: z.number() })`. Validation failures throw `CapabilityError` with status 422 and the joined messages.
  - `cascade.member.move` — POST `/cascade/funnels/:funnelId/members/:contactId/move`, input `z.object({ funnelId: entityId, contactId: entityId, nodeId: entityId.nullable().optional(), status: z.enum([...]).optional(), reason: z.string().max(500).optional() })`, output `z.object({ ok: z.literal(true) })`.
  - Extend the existing funnel detail GET handler to return the Task-3 extended payload.
  - Extend the existing member-add command: after insert, if the funnel has an `entry_node_id`, position the member there and append an `entered` event (this lives in the repository's add function, Task 3).
  - Knowledge event: after `graph.put`, `recordCascadeKnowledge` with a new `CASCADE_GRAPH_KNOWLEDGE_EVENT = 'knowledge.cascade.graph.changed'` (add constant + adapter registration in `products/cascade/knowledge-events.ts`, copying the funnel adapter's shape with content `Funnel automation updated: <name> — <N> steps`).

- [ ] **Step 1: Write failing contract tests** (schema-level: inputs parse/reject as specified; if the existing catalog tests execute handlers against a live pool, follow that pattern for a put→get round trip).
- [ ] **Step 2: Run; expect FAIL.** — **Step 3: Implement.** — **Step 4: Run capability tests + `pnpm --filter @content-automation/capabilities typecheck` (or repo equivalent) + `node --test tests/architecture/mcp-projection-boundary.test.mjs`.** Expect PASS.
- [ ] **Step 5: Commit** `feat(cascade): graph get/put and member move capabilities`.

---

### Task 5: Builder components move + new vocabulary

**Files:**
- Create: `products/cascade/components/FunnelVisualBuilder.tsx`, `VisualWorkflowBuilder.tsx`, `runtime-ui.ts`, `workflow-duration.ts` (move from `apps/styleguide/components/funnel-legacy/`, keep git history via `git mv` from the styleguide copies)
- Modify: `apps/styleguide/app/funnel/page.tsx` (import from the new location), delete `apps/styleguide/components/funnel-legacy/`
- Modify: `apps/unified/package.json` (add `"@xyflow/react": "12.11.2"`)

**Interfaces:**
- Produces: `FunnelVisualBuilder` prop contract changes to graph-document form:
  `{ funnelId, funnelName, graph: GraphDocument, funnels: Option[], onSave(doc: GraphDocument): Promise<void>, headerActions? }` — it no longer fetches; the page owns IO.
- Node spec vocabulary replaces the old one inside `FunnelVisualBuilder.tsx`:
  - **Touch** (was Email): fields `name` (text), `instruction` (textarea, label "What should the AI write?"), `maxAttempts` (number, label "Attempts before giving up"), `intervalDays` (number, label "Days between attempts"); outputs `responded` (tone primary, label "They responded") and `exhausted` (label "No response").
  - **Wait**: field `days` (number). Output `next`.
  - **If / else** (was Branch): field `conditionKind` select — "They replied" (`event:replied`), "Reply was positive" (`event:positive_reply`), "Contact attribute" (attribute key/equals text fields, `visibleWhen`), "Let the AI decide" (predicate `prompt` textarea, `visibleWhen`, placeholder "e.g. They sound like an enterprise buyer"); outputs `yes`/`no`.
  - **Goal**: field `outcome` (text, optional). No outputs.
  - **Send to funnel** (was Route): field `toFunnelId` select from `funnels`. No outputs.
- Serialization maps builder nodes/edges ⇄ `GraphDocument` (node ids are uuids minted with `crypto.randomUUID()` on palette-add; layout from node positions; entry = the unique node with no incoming edge, validated by `validateGraph` on save; drop the old spatial renumbering — labels come from node `name`).

- [ ] **Step 1: `git mv` the four files, fix relative imports, point the styleguide page at `products/cascade/components/…` (styleguide already resolves `@/components/ui/*`; the unified app resolves the same alias — confirm `products/*` imports from styleguide work the way the old unified page's `@/products/cascade/components/...` import did, and mirror that alias if needed).**
- [ ] **Step 2: Swap the node specs + serialization as above; delete the `/api/cascade/funnels/:id/workflow` fetch (replace with `onSave`), delete the mock API route `apps/styleguide/app/api/cascade/...`.**
- [ ] **Step 3: Update the styleguide demo page to the new prop contract with an in-memory `onSave` that round-trips state and toasts.**
- [ ] **Step 4: `pnpm --filter @content-automation/styleguide-app typecheck` + load `http://localhost:3006/funnel`, add a Touch from the palette, edit its instruction, save — expect success toast and the node label to show the name.** Screenshot for the record.
- [ ] **Step 5: Commit** `feat(cascade): builder components move to products with instruction-touch vocabulary`.

---

### Task 6: Builder-first funnel page

**Files:**
- Modify: `apps/unified/app/cascade/funnels/[id]/page.tsx` (rewrite), `apps/unified/app/cascade/funnels/[id]/loading.tsx` (skeleton for the new layout)

**Interfaces:**
- Consumes: `apiGet`/`apiMutate` against `/cascade/funnels/:id` (extended detail), `/cascade/funnels/:id/graph` (PATCH), `/cascade/funnels/:funnelId/members/:contactId/move` (POST), plus the existing member/email/rename/delete calls (all preserved).

- [ ] **Step 1: Rewrite the page**, top to bottom per spec §5 with v1 cuts:
  1. `PageHeader` — name, goal chip (read-only in v1), Rename/Delete actions (existing dialogs kept).
  2. **Automation** — `FunnelVisualBuilder` with `graph` from the detail payload, `funnels` from the funnel list call, `onSave` → `apiMutate("PATCH", …/graph, { graph })`, then reload; server validation errors surface via `toast.error`.
  3. **People** — existing `ListSurface`, rows extended with the current step name (`graph.nodes` lookup), status `Badge` (`active`→default, `converted`→the positive variant used elsewhere, others→outline/destructive per the §3 status mapping in `docs/design-language.md`), and a "Move to step…" row action opening a small dialog (step `Select` + status `Select` → member move call).
  4. **Activity** — `ListRows` of `events` (type → sentence: `advanced`→"moved to <step>", `entered`→"entered <step>", status types → "<status>").
  5. Plain-text email `ListSurface` stays at the bottom unchanged.
- [ ] **Step 2: Verify live.** `pnpm dev` (unified, port 3000): open a funnel, add steps (touch→branch→goal + route), save, reload — graph persists; add a member — lands on the entry step with an `entered` event visible; move them — activity updates. Screenshot.
- [ ] **Step 3: Run `pnpm test:cascade`, unified typecheck, and `node --test tests/architecture/` suite.** Expect PASS.
- [ ] **Step 4: Commit** `feat(cascade): builder-first funnel page with member positions and activity`.

---

### Task 7: Docs + sweep

**Files:**
- Modify: `products/cascade/CLAUDE.md`, `products/cascade/docs/decisions/0002-postgres-state-machine-over-workflow-engine.md`, `pending tasks.md`

- [ ] **Step 1: Rewrite `products/cascade/CLAUDE.md`:** Cascade owns the funnel automation graph (typed steps, labeled forward-only edges, per-member cursor, append-only events) as *data*; generation/classification arrive next phase; scheduling, rendering, and delivery stay external (n8n). Keep the RLS/migration/test instructions, update the table list.
- [ ] **Step 2: Append a status note to ADR 0002** ("2026-08-24: funnel structure restored as a forward-only graph — data only, no engine; see spec 2026-08-23") **and update the `pending tasks.md` status note** (Nurture is being deliberately rebuilt; reference the spec).
- [ ] **Step 3: Full sweep:** `pnpm test:cascade`, capabilities tests, both app typechecks, `node --test tests/architecture/`. Expect all PASS.
- [ ] **Step 4: Commit** `docs(cascade): funnel automation restored — contributor notes, ADR, pending tasks` and push.
