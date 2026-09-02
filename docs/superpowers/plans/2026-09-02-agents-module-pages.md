# Agents Module Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `/agents` into Overview (stats + chart), Manage (design-language list/detail/forms), and a standalone Playground, with metrics derived from existing `usage_event` rows.

**Architecture:** A new `summarizeAgentUsage` read behind the platform commercial-provider seam (unmetered default returns an empty summary — keeps the open-core mirror standalone; the metered implementation in `packages/commerce` runs the SQL). `products/agents/stats.ts` joins that with the graph agent list; a new `agents.stats` capability serves `GET /api/v1/agents/stats`. Pages are rebuilt on `PageHeader`/`StatRow`/`ListSurface`/`ListRow`/`ChartContainer`.

**Tech Stack:** Next.js (app router), zod, drizzle (commerce DB), node:test + tsx, shadcn chart primitives on Recharts.

**Spec:** `docs/superpowers/specs/2026-09-02-agents-module-pages-design.md`

## Global Constraints

- Package manager: `corepack pnpm` (global pnpm 9.x fails the engines check).
- Design language `docs/design-language.md` is binding: `PageHeader` on every page, skeletons (never a lone spinner), semantic tokens only, sonner toasts, series colors exactly `var(--chart-2)` + `var(--chart-6)`.
- `packages/platform` is open-core; `packages/commerce` is commercial. Nothing in platform/products may import from commerce; the unmetered provider must fully implement any new provider method.
- REST matching is method-filtered first-match (`apps/unified/lib/external-api.ts`); no existing GET has a 2-segment `/agents/*` template, so `GET /agents/stats` cannot collide today. Do not add a `GET /agents/:agentId` without registering it after `/agents/stats`.
- Import aliases in `apps/unified`: `@/components/PageHeader|StatRow|ListSurface|ListRow` → `packages/ui/components/*`; `@/components/ui/*` → `packages/ui/components/ui/*`.
- Playground POSTs `/api/chat` with an `agentPlayground` discriminator (`apps/unified/app/api/chat/route.ts:556` → `handleAgentPlayground`).
- Commit after every task; never commit with failing tests/typecheck.

---

### Task 1: Pure usage-summary helper (platform)

**Files:**
- Create: `packages/platform/commercial/agent-usage.ts`
- Test: `packages/platform/tests/agent-usage.test.ts`

**Interfaces:**
- Produces: `AgentUsageSummary`, `AgentUsageEventRow`, `summarizeAgentUsageRows(rows, options)`, `emptyAgentUsageSummary(days, now?)` — consumed by Tasks 2, 3, 4.

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform/tests/agent-usage.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyAgentUsageSummary,
  summarizeAgentUsageRows,
  type AgentUsageEventRow,
} from "../commercial/agent-usage";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const day = (offset: number, hour = 6) =>
  new Date(NOW.getTime() - offset * 86_400_000 + hour * 3_600_000 - 12 * 3_600_000).toISOString();

function row(overrides: Partial<AgentUsageEventRow>): AgentUsageEventRow {
  return { agentId: "agent-1", channel: "openai", credits: 10, createdAt: day(1), ...overrides };
}

test("empty summary has a full zero-filled daily window", () => {
  const summary = emptyAgentUsageSummary(30, NOW);
  assert.equal(summary.window.days, 30);
  assert.equal(summary.daily.length, 30);
  assert.ok(summary.daily.every((point) => point.deployed === 0 && point.playground === 0));
  assert.deepEqual(summary.messages, { current: 0, previous: 0 });
  assert.deepEqual(summary.credits, { current: 0, previous: 0 });
  assert.deepEqual(summary.perAgent, []);
  assert.deepEqual(summary.recent, []);
});

test("splits current and previous windows and buckets by channel", () => {
  const rows = [
    row({ createdAt: day(1), channel: "playground" }),
    row({ createdAt: day(2), channel: "openai" }),
    row({ createdAt: day(2), channel: "openai", credits: 5 }),
    row({ createdAt: day(35), channel: "openai" }), // previous window
    row({ createdAt: day(70), channel: "openai" }), // outside both windows
  ];
  const summary = summarizeAgentUsageRows(rows, { days: 30, now: NOW });
  assert.equal(summary.messages.current, 3);
  assert.equal(summary.messages.previous, 1);
  assert.equal(summary.credits.current, 25);
  assert.equal(summary.credits.previous, 10);
  assert.equal(summary.daily.length, 30);
  const byDate = Object.fromEntries(summary.daily.map((p) => [p.date, p]));
  assert.equal(byDate[day(1).slice(0, 10)]?.playground, 1);
  assert.equal(byDate[day(2).slice(0, 10)]?.deployed, 2);
});

test("aggregates per agent and caps recent at 10 newest", () => {
  const rows: AgentUsageEventRow[] = [];
  for (let i = 0; i < 12; i += 1) rows.push(row({ createdAt: day(3, i % 10), agentId: i % 2 ? "agent-2" : "agent-1" }));
  const summary = summarizeAgentUsageRows(rows, { days: 30, now: NOW });
  assert.equal(summary.recent.length, 10);
  const newest = Math.max(...rows.map((r) => Date.parse(r.createdAt)));
  assert.equal(Date.parse(summary.recent[0]!.at), newest);
  const agentOne = summary.perAgent.find((entry) => entry.agentId === "agent-1");
  assert.equal(agentOne?.messages, 6);
  assert.equal(agentOne?.credits, 60);
  const agentOneNewest = Math.max(...rows.filter((r) => r.agentId === "agent-1").map((r) => Date.parse(r.createdAt)));
  assert.equal(Date.parse(agentOne?.lastMessageAt ?? ""), agentOneNewest);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @content-automation/platform test`
Expected: FAIL — `Cannot find module '../commercial/agent-usage'`

- [ ] **Step 3: Write the implementation**

```ts
// packages/platform/commercial/agent-usage.ts
/**
 * Pure aggregation for external-agent usage. The metered commerce provider
 * fetches raw usage_event rows (kind='agent_action' with metadata.agentId)
 * and delegates all window/bucket math here so it is testable without a
 * database; the unmetered provider returns emptyAgentUsageSummary.
 */
export interface AgentUsageEventRow {
  agentId: string;
  channel: string;
  credits: number;
  createdAt: string;
}

export interface AgentUsageDailyPoint { date: string; deployed: number; playground: number }
export interface AgentUsagePerAgent { agentId: string; messages: number; credits: number; lastMessageAt: string | null }
export interface AgentUsageRecentMessage { agentId: string; channel: string; credits: number; at: string }

export interface AgentUsageSummary {
  window: { days: number; from: string; to: string };
  messages: { current: number; previous: number };
  credits: { current: number; previous: number };
  daily: AgentUsageDailyPoint[];
  perAgent: AgentUsagePerAgent[];
  recent: AgentUsageRecentMessage[];
}

const DAY_MS = 86_400_000;
const RECENT_LIMIT = 10;

function dateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function zeroDaily(days: number, from: number): AgentUsageDailyPoint[] {
  return Array.from({ length: days }, (_, index) => ({
    date: dateKey(from + index * DAY_MS),
    deployed: 0,
    playground: 0,
  }));
}

export function emptyAgentUsageSummary(days: number, now: Date = new Date()): AgentUsageSummary {
  const to = now.getTime();
  const from = to - days * DAY_MS;
  return {
    window: { days, from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    messages: { current: 0, previous: 0 },
    credits: { current: 0, previous: 0 },
    daily: zeroDaily(days, from),
    perAgent: [],
    recent: [],
  };
}

export function summarizeAgentUsageRows(
  rows: AgentUsageEventRow[],
  options: { days: number; now?: Date },
): AgentUsageSummary {
  const summary = emptyAgentUsageSummary(options.days, options.now);
  const to = Date.parse(summary.window.to);
  const from = Date.parse(summary.window.from);
  const previousFrom = from - options.days * DAY_MS;
  const byDate = new Map(summary.daily.map((point) => [point.date, point]));
  const perAgent = new Map<string, AgentUsagePerAgent>();
  const current: AgentUsageEventRow[] = [];

  for (const row of rows) {
    const at = Date.parse(row.createdAt);
    if (Number.isNaN(at) || at >= to || at < previousFrom) continue;
    if (at < from) {
      summary.messages.previous += 1;
      summary.credits.previous += row.credits;
      continue;
    }
    current.push(row);
    summary.messages.current += 1;
    summary.credits.current += row.credits;
    const point = byDate.get(dateKey(at));
    if (point) {
      if (row.channel === "playground") point.playground += 1;
      else point.deployed += 1;
    }
    const entry = perAgent.get(row.agentId) ?? { agentId: row.agentId, messages: 0, credits: 0, lastMessageAt: null };
    entry.messages += 1;
    entry.credits += row.credits;
    if (!entry.lastMessageAt || Date.parse(entry.lastMessageAt) < at) entry.lastMessageAt = row.createdAt;
    perAgent.set(row.agentId, entry);
  }

  summary.perAgent = [...perAgent.values()].sort((a, b) => b.messages - a.messages);
  summary.recent = current
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, RECENT_LIMIT)
    .map((row) => ({ agentId: row.agentId, channel: row.channel, credits: row.credits, at: row.createdAt }));
  return summary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @content-automation/platform test`
Expected: PASS (all platform tests)

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(platform): pure agent-usage summary aggregation"`

---

### Task 2: Provider seam — `summarizeAgentUsage`

**Files:**
- Modify: `packages/platform/commercial/provider.ts` (interface + unmetered impl + facade export)
- Test: extend `packages/platform/tests/agent-usage.test.ts`

**Interfaces:**
- Consumes: `emptyAgentUsageSummary`, `AgentUsageSummary` (Task 1).
- Produces: `CommercialProvider.summarizeAgentUsage(organizationId, options?) => Promise<AgentUsageSummary>`; module facade `summarizeAgentUsage(...)` with a fallback to the empty summary when a stale provider bundle lacks the method. Re-exported through `packages/platform/commercial/index.ts`? — index does `export * from "./provider"`, and add `export * from "./agent-usage"` to `packages/platform/commercial/index.ts`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { UnmeteredCommercialProvider, summarizeAgentUsage, setCommercialProvider, commercialProvider } from "../commercial/provider";

test("unmetered provider returns an empty usage summary", async () => {
  const summary = await new UnmeteredCommercialProvider().summarizeAgentUsage("org-1", { days: 14 });
  assert.equal(summary.window.days, 14);
  assert.equal(summary.messages.current, 0);
  assert.equal(summary.daily.length, 14);
});

test("facade falls back to the empty summary when the installed provider lacks the method", async () => {
  const original = commercialProvider();
  try {
    setCommercialProvider({ ...original, summarizeAgentUsage: undefined } as never);
    const summary = await summarizeAgentUsage("org-1");
    assert.equal(summary.messages.current, 0);
    assert.equal(summary.window.days, 30);
  } finally {
    setCommercialProvider(original);
  }
});
```

- [ ] **Step 2: Run to verify failure** — `corepack pnpm --filter @content-automation/platform test` → FAIL (`summarizeAgentUsage` not exported / not a function)

- [ ] **Step 3: Implement**

In `packages/platform/commercial/provider.ts`:
1. `import { emptyAgentUsageSummary, type AgentUsageSummary } from "./agent-usage";`
2. Add to the `CommercialProvider` interface (next to `settleReservation`):
```ts
  summarizeAgentUsage(
    organizationId: string,
    options?: { days?: number },
  ): Promise<AgentUsageSummary>;
```
3. Add to `UnmeteredCommercialProvider`:
```ts
  async summarizeAgentUsage(_organizationId: string, options?: { days?: number }) {
    return emptyAgentUsageSummary(options?.days ?? 30);
  }
```
4. Add a facade export next to the existing ones (with the stale-bundle guard):
```ts
export const summarizeAgentUsage: CommercialProvider["summarizeAgentUsage"] = (organizationId, options) => {
  const provider = commercialProvider();
  if (typeof provider.summarizeAgentUsage !== "function") {
    return Promise.resolve(emptyAgentUsageSummary(options?.days ?? 30));
  }
  return provider.summarizeAgentUsage(organizationId, options);
};
```
5. In `packages/platform/commercial/index.ts` add `export * from "./agent-usage";`

- [ ] **Step 4: Verify** — platform tests PASS; `corepack pnpm --filter @content-automation/platform typecheck` (script exists? if not, skip — turbo build covers it later).

- [ ] **Step 5: Commit** — `feat(platform): summarizeAgentUsage on the commercial provider seam`

---

### Task 3: Metered implementation (commerce)

**Files:**
- Modify: `packages/commerce/server.ts` (new export), `packages/commerce/register.ts` (wire method)

**Interfaces:**
- Consumes: `summarizeAgentUsageRows` (Task 1), `usageEvent` table, `commerceDb`, existing drizzle imports (`and`, `desc`, `eq`, `sql` — **add `gte`** to the import list).
- Produces: metered `summarizeAgentUsage(organizationId, options?)`.

- [ ] **Step 1: Implement in `packages/commerce/server.ts`** (after `listUsage`):

```ts
export async function summarizeAgentUsage(
  organizationId: string,
  options?: { days?: number },
) {
  await ready();
  const days = Math.min(Math.max(Math.trunc(options?.days ?? 30), 1), 90);
  const from = new Date(Date.now() - 2 * days * 86_400_000).toISOString();
  const rows = await commerceDb
    .select({
      agentId: sql<string>`${usageEvent.metadata} ->> 'agentId'`,
      channel: sql<string>`coalesce(${usageEvent.metadata} ->> 'channel', 'unknown')`,
      credits: usageEvent.credits,
      createdAt: usageEvent.created_at,
    })
    .from(usageEvent)
    .where(and(
      eq(usageEvent.organization_id, organizationId),
      eq(usageEvent.kind, "agent_action"),
      sql`${usageEvent.metadata} ? 'agentId'`,
      gte(usageEvent.created_at, from),
    ))
    .orderBy(desc(usageEvent.created_at));
  return summarizeAgentUsageRows(
    rows.map((row) => ({ ...row, credits: number(row.credits) })),
    { days },
  );
}
```
Imports: add `gte` to the drizzle-orm import block and `import { summarizeAgentUsageRows } from "@content-automation/platform/commercial";` (the platform package export — check `packages/platform/package.json` exports map includes `./commercial`; it does, all provider consumers import from there).

The `metadata ? 'agentId'` filter deliberately excludes in-app Taicho Chat settles (they carry no `agentId`) — this module counts external agents only.

- [ ] **Step 2: Wire `packages/commerce/register.ts`** — add `summarizeAgentUsage` to the import from `./server` and to the `meteredProvider` object literal.

- [ ] **Step 3: Verify** — `corepack pnpm --filter @content-automation/commerce test` (existing tests still pass; no new DB test — the SQL is a thin fetch, the math is covered by Task 1) and typecheck via `corepack pnpm --filter @content-automation/commerce typecheck` if the script exists (else rely on build).

- [ ] **Step 4: Commit** — `feat(commerce): metered summarizeAgentUsage over usage_event`

---

### Task 4: `products/agents/stats.ts` + capability `agents.stats`

**Files:**
- Create: `products/agents/stats.ts`
- Modify: `products/agents/package.json` (exports `./stats`), `products/agents/index.ts` (re-export), `packages/capabilities/catalog-agents.ts` (new capability)
- Test: `products/agents/tests/stats.test.ts`

**Interfaces:**
- Consumes: `listAgents` (repository), platform `summarizeAgentUsage` (Task 2).
- Produces: `getAgentsStats(organizationId, options?, deps?)` returning:
```ts
export interface AgentsStats {
  totals: { agents: number; active: number; paused: number; deployments: number; activeDeployments: number };
  window: { days: number; from: string; to: string };
  messages: { current: number; previous: number };
  credits: { current: number; previous: number };
  daily: Array<{ date: string; deployed: number; playground: number }>;
  agents: Array<{ agentId: string; name: string; status: 'active' | 'paused'; messages: number; credits: number; lastMessageAt: string | null }>;
  recent: Array<{ agentId: string; agentName: string; channel: string; credits: number; at: string }>;
}
```
REST: `GET /api/v1/agents/stats` (capability `agents.stats`, authorize `ai.basic`).

- [ ] **Step 1: Write the failing test**

```ts
// products/agents/tests/stats.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { getAgentsStats } from '../stats';
import type { AgentWithDeployments } from '../domain';

const agent = (id: string, name: string, status: 'active' | 'paused', deployments: Array<'active' | 'revoked'>): AgentWithDeployments => ({
  agent: {
    id, organizationId: 'org-1', slug: name.toLowerCase(), version: 1, status,
    createdBy: 'user-1', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    name, description: 'd', instructions: 'i'.repeat(10), channels: ['api-sdk'],
    projectionKeys: ['workspace'], allowedUses: ['content_generation'], maxSensitivity: 'restricted',
    maxHops: 3, maxResults: 50, canWriteNotes: true,
  },
  deployments: deployments.map((s, index) => ({
    id: `dep-${id}-${index}`, organizationId: 'org-1', agentId: id, name: `d${index}`, channel: 'openai',
    tokenPrefix: 'ag_live_x', status: s, createdBy: 'user-1',
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  })),
});

const usage = {
  window: { days: 30, from: '2026-08-03T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' },
  messages: { current: 3, previous: 1 },
  credits: { current: 30, previous: 10 },
  daily: [{ date: '2026-09-01', deployed: 2, playground: 1 }],
  perAgent: [
    { agentId: 'a1', messages: 2, credits: 20, lastMessageAt: '2026-09-01T10:00:00.000Z' },
    { agentId: 'gone', messages: 1, credits: 10, lastMessageAt: '2026-09-01T09:00:00.000Z' },
  ],
  recent: [{ agentId: 'a1', channel: 'playground', credits: 10, at: '2026-09-01T10:00:00.000Z' }],
};

test('joins usage with the agent roster and totals deployments', async () => {
  const stats = await getAgentsStats('org-1', { days: 30 }, {
    listAgents: async () => [agent('a1', 'Analyst', 'active', ['active', 'revoked']), agent('a2', 'Scout', 'paused', [])],
    summarizeAgentUsage: async () => usage,
  });
  assert.deepEqual(stats.totals, { agents: 2, active: 1, paused: 1, deployments: 2, activeDeployments: 1 });
  assert.equal(stats.agents[0]?.agentId, 'a1');
  assert.equal(stats.agents[0]?.messages, 2);
  assert.equal(stats.agents[1]?.messages, 0);          // roster agent with no usage still listed
  assert.equal(stats.recent[0]?.agentName, 'Analyst');
  assert.equal(stats.messages.current, 3);
});

test('names usage from deleted agents safely', async () => {
  const stats = await getAgentsStats('org-1', undefined, {
    listAgents: async () => [],
    summarizeAgentUsage: async () => ({ ...usage, recent: [{ agentId: 'gone', channel: 'openai', credits: 10, at: '2026-09-01T09:00:00.000Z' }] }),
  });
  assert.equal(stats.recent[0]?.agentName, 'Deleted agent');
  assert.equal(stats.totals.agents, 0);
});
```

- [ ] **Step 2: Run to verify failure** — `corepack pnpm --filter @content-automation/agents test` → FAIL (module missing)

- [ ] **Step 3: Implement `products/agents/stats.ts`**

```ts
import { summarizeAgentUsage as platformSummarizeAgentUsage } from '@content-automation/platform/commercial';
import type { AgentUsageSummary } from '@content-automation/platform/commercial';
import type { AgentWithDeployments } from './domain';
import { listAgents as repositoryListAgents } from './repository';

export interface AgentsStats {
  totals: { agents: number; active: number; paused: number; deployments: number; activeDeployments: number };
  window: { days: number; from: string; to: string };
  messages: { current: number; previous: number };
  credits: { current: number; previous: number };
  daily: Array<{ date: string; deployed: number; playground: number }>;
  agents: Array<{ agentId: string; name: string; status: 'active' | 'paused'; messages: number; credits: number; lastMessageAt: string | null }>;
  recent: Array<{ agentId: string; agentName: string; channel: string; credits: number; at: string }>;
}

interface StatsDeps {
  listAgents: (organizationId: string) => Promise<AgentWithDeployments[]>;
  summarizeAgentUsage: (organizationId: string, options?: { days?: number }) => Promise<AgentUsageSummary>;
}

const DELETED_AGENT_NAME = 'Deleted agent';

export async function getAgentsStats(
  organizationId: string,
  options?: { days?: number },
  deps: StatsDeps = { listAgents: repositoryListAgents, summarizeAgentUsage: platformSummarizeAgentUsage },
): Promise<AgentsStats> {
  const [roster, usage] = await Promise.all([
    deps.listAgents(organizationId),
    deps.summarizeAgentUsage(organizationId, { days: options?.days ?? 30 }),
  ]);
  const names = new Map(roster.map(({ agent }) => [agent.id, agent.name]));
  const usageByAgent = new Map(usage.perAgent.map((entry) => [entry.agentId, entry]));
  const deployments = roster.flatMap((item) => item.deployments);
  return {
    totals: {
      agents: roster.length,
      active: roster.filter(({ agent }) => agent.status === 'active').length,
      paused: roster.filter(({ agent }) => agent.status === 'paused').length,
      deployments: deployments.length,
      activeDeployments: deployments.filter((deployment) => deployment.status === 'active').length,
    },
    window: usage.window,
    messages: usage.messages,
    credits: usage.credits,
    daily: usage.daily,
    agents: roster
      .map(({ agent }) => {
        const entry = usageByAgent.get(agent.id);
        return {
          agentId: agent.id, name: agent.name, status: agent.status,
          messages: entry?.messages ?? 0, credits: entry?.credits ?? 0,
          lastMessageAt: entry?.lastMessageAt ?? null,
        };
      })
      .sort((a, b) => b.messages - a.messages),
    recent: usage.recent.map((message) => ({
      ...message, agentName: names.get(message.agentId) ?? DELETED_AGENT_NAME,
    })),
  };
}
```
Add `"./stats": "./stats.ts"` to `products/agents/package.json` exports and `export * from './stats';` to `products/agents/index.ts`.

- [ ] **Step 4: Verify** — agents tests PASS.

- [ ] **Step 5: Register the capability** in `packages/capabilities/catalog-agents.ts` (inside `registerAgentsCatalog`, immediately after `agents.list`; import `getAgentsStats` from `@content-automation/agents`):

```ts
  const usageDailyPointSchema = z.object({ date: z.string(), deployed: z.number().int().nonnegative(), playground: z.number().int().nonnegative() });
  defineCapability({
    id: 'agents.stats', version: 1, kind: 'query', risk: 'read', idempotency: 'none',
    scopes: ['vn:read'], authorize: (context) => context.capabilities.includes('ai.basic'),
    input: z.object({}),
    output: z.object({
      totals: z.object({ agents: z.number().int(), active: z.number().int(), paused: z.number().int(), deployments: z.number().int(), activeDeployments: z.number().int() }),
      window: z.object({ days: z.number().int(), from: z.string(), to: z.string() }),
      messages: z.object({ current: z.number().int(), previous: z.number().int() }),
      credits: z.object({ current: z.number(), previous: z.number() }),
      daily: z.array(usageDailyPointSchema),
      agents: z.array(z.object({ agentId: z.string(), name: z.string(), status, messages: z.number().int(), credits: z.number(), lastMessageAt: z.string().nullable() })),
      recent: z.array(z.object({ agentId: z.string(), agentName: z.string(), channel: z.string(), credits: z.number(), at: z.string() })),
    }),
    rest: { method: 'GET', path: '/agents/stats', tag: 'Agents', summary: 'External-agent usage overview', description: 'Roster totals plus message and credit usage aggregated from settled agent actions over the requested window (default 30 days).' },
    execute: async (context) => ({ data: await getAgentsStats(context.organizationId), summary: 'Loaded agent usage overview.' }),
  });
```

- [ ] **Step 6: Verify end-to-end** — with `pnpm dev` running: `curl -s -H "Cookie: $(cat)" http://localhost:3010/api/v1/agents/stats` is awkward; instead verify from the signed-in browser via devtools fetch or defer to Task 8's page. Minimum here: `corepack pnpm --filter @content-automation/capabilities test` passes and the unified app compiles.

- [ ] **Step 7: Commit** — `feat(agents): agents.stats capability serving GET /api/v1/agents/stats`

---

### Task 5: `durationMs` on settle metadata + playground gate

**Files:**
- Modify: `apps/unified/lib/agent-playground.ts`, `apps/unified/app/api/agents/v1/chat/completions/route.ts`

- [ ] **Step 1: durations** — in `runInteractiveAgent` (agent-playground.ts) capture `const startedAt = Date.now();` before `runAgentChat` and add `durationMs: Date.now() - startedAt` to the settle `metadata`. Same in the completions route: non-stream settle (line ~47) and stream settle (line ~72; measure from just before `streamAgentChat` iteration starts).
- [ ] **Step 2: gate** — in `handleAgentPlayground` delete the owner/admin block:
```ts
  if (!hasAnyRole(context.role, ['owner', 'admin'])) {
    return error('Only workspace owners and administrators can test agents.', 403);
  }
```
and remove the now-unused `hasAnyRole` import (line 9) if nothing else in the file uses it. Entitlement stays enforced: `runInteractiveAgent` → `requireCapability(organizationId, userId, 'ai.basic')`.
- [ ] **Step 3: Verify** — `corepack pnpm --filter @content-automation/unified-app typecheck` (if script missing, `corepack pnpm exec tsc --noEmit -p apps/unified`); send one playground message in the running dev app and confirm a new `usage_event` row has `metadata->>'durationMs'`.
- [ ] **Step 4: Commit** — `feat(agents): settle durationMs; open playground to ai.basic members`

---

### Task 6: Shared page pieces — channel icons, launchpad, sidebar

**Files:**
- Create: `apps/unified/app/agents/channel-icons.tsx` (export `agentChannelIcons` map — moved verbatim from `workspace.tsx`)
- Create: `apps/unified/app/agents/launchpad.tsx` (the `EmptyState` component from `workspace.tsx`, renamed `AgentLaunchpad`, same markup/test-id `agent-empty-state`, its create button now `asChild` linking `/agents/manage/new`)
- Modify: `apps/unified/components/unified-sidebar.tsx` — Agents `items` become:

```ts
    items: [
      { href: "/agents", label: "Overview", icon: LayoutDashboard, exact: true },
      { href: "/agents/manage", label: "Agents", icon: Bot },
      { href: "/agents/playground", label: "Playground", icon: MessagesSquare },
    ],
```
(`Bot` is already imported for the section icon; add `MessagesSquare` to the lucide import if absent.)

- [ ] Extract, update imports in `workspace.tsx` to keep it compiling until Task 9 removes it, typecheck, commit — `refactor(agents): extract launchpad and channel icons; three-item sidebar`

---

### Task 7: Overview page (`/agents`)

**Files:**
- Modify: `apps/unified/app/agents/page.tsx` (render `<AgentsOverview />` instead of `<AgentsWorkspace />`; keep the `ai.basic` redirect; `metadata.title = 'Agents'`)
- Create: `apps/unified/app/agents/overview.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/agents/stats` (Task 4 shape), `GET /api/v1/agents` (`WorkspaceData`: agents, channels, canManage), `AgentLaunchpad`, `StatRow`, `PageHeader`, chart primitives, `ListRows`/`ListRow`, `Skeleton`.

- [ ] **Step 1: Build `overview.tsx`** ('use client'). Behavior:
  - `Promise.all([apiGet('/agents/stats'), apiGet('/agents')])` in a `useEffect`-driven `load()`; failures → `toast.error('Agent stats failed to load. Retry from the page header.')` with a retry button in `PageHeader` actions; loading → `StatRow isLoading` + `Skeleton` blocks mirroring chart (`h-64`) and list (5 rows).
  - Zero agents → `PageHeader` + `<AgentLaunchpad channels canManage />` only.
  - Stats tiles:
```tsx
const delta = (current: number, previous: number) =>
  current === previous ? undefined : `${current > previous ? '+' : ''}${current - previous}`;
const direction = (current: number, previous: number) =>
  current === previous ? 'flat' as const : current > previous ? 'up' as const : 'down' as const;
const stats = [
  { label: 'Total agents', value: String(t.agents), featured: true, description: `${t.active} active · ${t.paused} paused` },
  { label: 'Messages · 30d', value: String(m.current), delta: delta(m.current, m.previous), direction: direction(m.current, m.previous), trend: daily.slice(-10).map((p) => p.deployed + p.playground) },
  { label: 'Credits · 30d', value: String(c.current), delta: delta(c.current, c.previous), direction: direction(c.current, c.previous) },
  { label: 'Active deployments', value: String(t.activeDeployments), description: `across ${t.agents} agent${t.agents === 1 ? '' : 's'}` },
];
```
  - Chart card (Card > CardHeader "Messages · last 30 days" / CardDescription "Settled agent messages per day, split by origin." > CardContent):
```tsx
const chartConfig = {
  deployed: { label: 'Deployed channels', color: 'var(--chart-2)' },
  playground: { label: 'Playground', color: 'var(--chart-6)' },
} satisfies ChartConfig;
const axisTick = { fill: 'var(--muted-foreground)', fontSize: 11 };
<ChartContainer className="h-64 w-full" config={chartConfig}>
  <BarChart data={stats.daily}>
    <CartesianGrid stroke="var(--border)" vertical={false} />
    <XAxis axisLine={false} dataKey="date" minTickGap={24} tick={axisTick} tickFormatter={(d: string) => d.slice(5)} tickLine={false} />
    <YAxis allowDecimals={false} axisLine={false} tick={axisTick} tickLine={false} width={32} />
    <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: 'var(--muted)', opacity: 0.35 }} />
    <ChartLegend content={<ChartLegendContent />} />
    <Bar dataKey="deployed" fill="var(--color-deployed)" stackId="m" stroke="var(--card)" strokeWidth={2} />
    <Bar dataKey="playground" fill="var(--color-playground)" radius={[4, 4, 0, 0]} stackId="m" stroke="var(--card)" strokeWidth={2} />
  </BarChart>
</ChartContainer>
```
    Imports come from `@/components/ui/chart` and `recharts` (see `apps/styleguide/app/stats/content-views.tsx` for the living pattern).
  - Recent activity Card (`p-0` content) with `ListRows`: per message `ListRow` — `title` agentName (href `/agents/manage/${agentId}` when the agent still exists in the roster), `badge` `<Badge variant="outline">{channel}</Badge>`, `meta` `[`${credits} credits`, <span title={new Date(at).toLocaleString()}>{relativeTime(at)}</span>]`. `relativeTime` via `date-fns` `formatDistanceToNow` if `date-fns` is already a unified-app dependency (`grep '"date-fns"' apps/unified/package.json`); otherwise a small local helper using `Intl.RelativeTimeFormat`. Empty recent → muted one-liner "No messages yet. Test an agent in the playground." linking `/agents/playground`.
  - `PageHeader` actions: `canManage` → Button asChild → `/agents/manage/new` "New agent".
- [ ] **Step 2: Verify in browser** — `/agents` shows tiles with the ~279-row local history, chart renders, recent list populated; loading skeletons on hard refresh; no console errors.
- [ ] **Step 3: Commit** — `feat(agents): overview page with usage stats, chart, and recent activity`

---

### Task 8: Manage pages (list, new, detail, edit)

**Files:**
- Create: `apps/unified/app/agents/manage/page.tsx` (server gate: same `ai.basic` redirect; renders `<AgentsList />`), `apps/unified/app/agents/manage/list.tsx`
- Create: `apps/unified/app/agents/manage/agent-form.tsx` (shared create/edit form)
- Create: `apps/unified/app/agents/manage/new/page.tsx`
- Create: `apps/unified/app/agents/manage/[agentId]/page.tsx`, `apps/unified/app/agents/manage/[agentId]/detail.tsx`
- Create: `apps/unified/app/agents/manage/[agentId]/edit/page.tsx`

**Interfaces:**
- Consumes: `GET /agents`, `GET /agents/stats` (per-agent volumes), `POST /agents`, `PATCH /agents/:agentId` (`expectedUpdatedAt`), `DELETE /agents/:agentId`, `POST /agents/:agentId/deployments`, `DELETE /agents/:agentId/deployments/:deploymentId` — all existing; `ListSurface`/`FilterSelect`/`ListRows`/`ListRow`, `PageHeader`, `agentChannelIcons`.

- [ ] **Step 1: `list.tsx`** — client component: load `/agents` + `/agents/stats`; `ListSurface` (`title="Agents"`, search over name/description/slug, `filters`: one `FilterSelect` label "Status" options all/active/paused, `count`); rows:
```tsx
<ListRow
  key={agent.id}
  title={agent.name}
  href={`/agents/manage/${agent.id}`}
  badge={<Badge variant={agent.status === 'active' ? 'default' : 'secondary'}>{agent.status}</Badge>}
  meta={[
    channelNames(agent.channels),                       // "Slack, API & SDK"
    `${item.deployments.length} deployment${item.deployments.length === 1 ? '' : 's'}`,
    `${usage?.messages ?? 0} messages · 30d`,
    usage?.lastMessageAt ? <span title={new Date(usage.lastMessageAt).toLocaleString()}>{`used ${relativeTime(usage.lastMessageAt)}`}</span> : 'never used',
  ]}
  actions={[{ label: 'Open', iconName: 'arrow-right', href: `/agents/manage/${agent.id}` }]}
/>
```
  Header action "New agent" (canManage). Empty state per §4 (muted `Bot` icon + sentence + create button). No pagination (roster is small; client-side filter only).
- [ ] **Step 2: `agent-form.tsx`** — extract the `AgentCreator` fields verbatim (name, description, instructions, channel grid with `aria-pressed` buttons, memory switch) into `AgentForm({ initial, submitLabel, saving, onSubmit, onCancel })`; `new/page.tsx` wraps it in `PageHeader title="New agent"` and POSTs `/agents`, then `router.push('/agents/manage/' + agent.id)`; keep `data-testid="agent-creator"`.
- [ ] **Step 3: detail** — `[agentId]/page.tsx` server component passes `agentId` to client `detail.tsx`, which loads `/agents`, finds by id (missing → §4 empty state "This agent no longer exists" + back link). Layout: back link "All agents" → `/agents/manage`; `PageHeader title={agent.name}` with status/version badges in description slot and actions: "Open in playground" (Button variant outline asChild → `/agents/playground?agent=${agent.slug}`), Edit (→ `.../edit`), Pause/Resume, Delete (existing dialog, moved verbatim, test-ids preserved: `delete-agent-dialog`, `new-api-key`, `api-test-response`). Below: Mission card, Destinations card, Endpoint & deployments card — all moved from `AgentDetail` without behavior changes.
- [ ] **Step 4: edit** — `edit/page.tsx` loads the agent, renders `AgentForm` with `initial`, PATCHes `{...changedFields, expectedUpdatedAt: agent.updatedAt}`; 409 → `toast.error('This agent changed while you were editing. Reload and retry.')`.
- [ ] **Step 5: Verify in browser** — walk list → detail → edit → save; create an agent; pause/resume; deploy key flow still works; delete flow still works.
- [ ] **Step 6: Commit** — `feat(agents): manage list, detail, create, and edit pages on the list-surface system`

---

### Task 9: Standalone playground page + retire workspace.tsx

**Files:**
- Create: `apps/unified/app/agents/playground/page.tsx` (server gate `ai.basic`), `apps/unified/app/agents/playground/playground-client.tsx`
- Delete: `apps/unified/app/agents/workspace.tsx`

- [ ] **Step 1: `playground-client.tsx`** — 'use client': load `/agents`; resolve `useSearchParams().get('agent')` against `agent.id` or `agent.slug`; selection UI = `Select` over the roster (paused entries `disabled` with "(paused)" suffix); on change `router.replace('/agents/playground?agent=' + agent.slug, { scroll: false })`; render `<AgentPlayground key={agent.id} agent={agent} />` (existing component, unchanged path `apps/unified/app/agents/playground.tsx`); no/unknown param → centered §4 empty state "Choose an agent to start a test conversation." (no error toast). Zero agents → empty state linking `/agents/manage/new` (canManage) or explanatory sentence.
- [ ] **Step 2: Delete `workspace.tsx`**; `grep -rn "workspace" apps/unified/app/agents` and `grep -rn "AgentsWorkspace" apps/unified` must return nothing.
- [ ] **Step 3: Verify** — `/agents/playground?agent=<slug>` preselects and chats (as the member-level flow: sign in as `content@local.test` to confirm the Task 5 gate change); switching agents updates the URL; typecheck passes.
- [ ] **Step 4: Commit** — `feat(agents): standalone playground with URL-addressed agent selection`

---

### Task 10: Browser-QA catalog + final verification

**Files:**
- Modify: `tests/browser-qa/spec-source/catalog.mjs` (AI-BR-010, ~line 940)

- [ ] **Step 1: Update AI-BR-010** — `routes`: add `/agents/manage`, `/agents/manage/new`, `/agents/manage/:agentId`, `/agents/manage/:agentId/edit`, `/agents/playground`, `/api/v1/agents/stats`. `sources`: add `products/agents/stats.ts`, `packages/platform/commercial/agent-usage.ts`, `packages/commerce/server.ts`. `fixtures`: add 'Non-admin member with ai.basic for the standalone playground'. `checks`: update the launchpad step to say it renders on the Overview page; update the playground step to start from `/agents/playground?agent=<slug>` (URL preselect + member access); add one step: `step('Review the Overview stats, chart, and recent activity against the settled usage rows.', 'Tile counts match the roster, the two-series daily chart matches settled agent actions with playground and deployed origins separated, the recent list names agents (Deleted agent for removed ones), and zero-agent workspaces show the launchpad instead.')`. Update the agent-management steps' route references from the single-page workspace to `/agents/manage`.
- [ ] **Step 2: Regenerate + validate** — `corepack pnpm qa:browser:generate-specs && corepack pnpm qa:browser:validate` (generated `AI-BR-010.md/.json` change; commit them).
- [ ] **Step 3: Full verification sweep** — `corepack pnpm --filter @content-automation/platform test --filter @content-automation/agents test --filter @content-automation/commerce test --filter @content-automation/capabilities test`; typecheck unified; browser-walk all three pages signed in as owner and as `content@local.test`; confirm `/agents` numbers move after one playground message.
- [ ] **Step 4: Commit** — `test(browser-qa): AI-BR-010 covers agents overview, manage, and standalone playground`
