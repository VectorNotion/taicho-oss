# Agents module pages — Overview, Manage, Playground

Date: 2026-09-02 · Status: approved (approach A) · Owner: Rajesh

## Problem

`/agents` is a single hand-rolled workspace page: custom header, spinner
loading, a custom button list for agent selection, the playground and the
endpoint/deployment management all inlined. It predates the design language's
structural recipes and gives no operational picture (how many agents, how many
messages, trend).

## Decision (approach A)

Split the module into three user-facing pages plus management subpages, and
derive all metrics from the **existing** `usage_event` rows that every agent
message already settles (`kind='agent_action'`, metadata `agentId`, `channel`,
`operation`, `simulation`). No new tables, no new writes, history included.
Rejected: product-event spine emission (no history until shipped) and a
dedicated `agent_run` table (hot-path write + migration; YAGNI).

## Routes & navigation

| Route | Page | Access |
| --- | --- | --- |
| `/agents` | Overview: stats, chart, recent activity | member with `ai.basic` |
| `/agents/manage` | Agent list (browsable list surface) | visible to members; mutations owner/admin |
| `/agents/manage/new` | Create agent (full-page form, §5) | owner/admin |
| `/agents/manage/[agentId]` | Agent detail | visible to members; actions owner/admin |
| `/agents/manage/[agentId]/edit` | Edit name/description/mission/channels/memory (existing PATCH + `expectedUpdatedAt`) | owner/admin |
| `/agents/playground` | Standalone playground; `?agent=<id-or-slug>` preselects; selection synced to URL | member with `ai.basic` |

Sidebar `Agents` section items: Overview (`/agents`, exact), Agents
(`/agents/manage`), Playground (`/agents/playground`) — the Outreach sub-nav
pattern in `apps/unified/components/unified-sidebar.tsx`.

## Overview page (`/agents`)

- `PageHeader`; primary action "New agent" (owner/admin) → `/agents/manage/new`.
- `StatRow` tiles: **Total agents** (featured; description "N active · M
  paused"), **Messages (30d)** (delta vs prior 30d, sparkline from the daily
  series), **Credits spent (30d)** (delta), **Active deployments**
  (description: across N agents).
- Chart card "Messages · last 30 days": `ChartContainer` +
  `ChartTooltipContent` + `ChartLegendContent`, daily counts, exactly two
  series — Deployed channels (`chart-2`) and Playground (`chart-6`) — grid
  horizontal `var(--border)` only, no axis/tick lines, 11px muted ticks.
- Recent activity card: last 10 messages as a table — agent name, channel
  badge, credits (right-aligned `tabular-nums`), relative time with exact
  timestamp in `title`.
- Zero agents: the existing launchpad empty state (AI-BR-010 step 2 tests its
  story) renders on this page unchanged.
- §4 states: skeletons mirroring layout (never a spinner), `toast.error` +
  usable view on failure.

## Stats API

- New capability `agents.stats` (v1, kind query, risk read) in
  `packages/capabilities/catalog-agents.ts`, REST `GET /agents/stats`, served
  by the `/api/v1` dispatcher. Implementation must verify static
  `/agents/stats` wins over `/agents/:agentId`; if the dispatcher cannot, the
  path becomes `/agents/overview-stats`.
- Data ownership: `packages/platform/commercial` gains a read
  `summarizeAgentUsage(organizationId, { days })` — org-scoped SQL over
  `usage_event` (`kind='agent_action'`): totals + previous-window totals +
  per-day per-channel counts (channel = `metadata->>'channel'`, `playground`
  vs everything else) + last 10 events (agentId, channel, credits,
  created_at).
- `products/agents/stats.ts` joins that with the graph repository's agents +
  deployments (names, active/paused, deployment counts, per-agent message
  counts for the list page's "last used"/volume columns).
- Response shape:
  `{ totals: { agents, active, paused, deployments, activeDeployments },
     window: { days },
     messages: { current, previous, credits, creditsPrevious },
     daily: [{ date, deployed, playground }],
     perAgent: [{ agentId, messages30d, lastMessageAt }],
     recent: [{ agentId, agentName, channel, credits, at }] }`
- Simulated (stub-mode) messages count; no simulation distinction in v1.
- Forward-looking: the three settle sites (playground lib, chat completions
  non-stream and stream) add `durationMs` to settle metadata. No reader yet.

## Management pages

- `/agents/manage`: §8 browsable list — `ListSurface` (search over
  name/description/slug; `FilterSelect` status all/active/paused) +
  `ListRows`: name, status `Badge`, destination badges (overflow "+N"),
  deployments count, messages (30d), last used, created (relative). Row →
  detail. Empty state per §4 with creation action.
- Detail: back link "All agents" + `PageHeader` (status badge; actions:
  Pause/Resume, Delete with existing type-name confirmation dialog, "Open in
  playground" deep link). Content sections: Mission, Destinations, Endpoint &
  deployments (existing deploy/copy-key/test/revoke blocks moved as-is).
- Create/edit: full-page forms per §5 reusing the current creator fields;
  edit PATCHes with `expectedUpdatedAt`.
- `apps/unified/app/agents/workspace.tsx` dissolves into these pages; the
  `AgentPlayground` component survives unchanged.

## Playground page

- Agent `Select` listing active agents (paused disabled with hint) + the
  existing `AgentPlayground`. `?agent=` accepts id or slug (the repository
  already resolves both); invalid/missing → picker with prompt, no error
  toast. Selection updates the URL via `replaceState`.
- Server: `handleAgentPlayground` drops `hasAnyRole(['owner','admin'])` for
  the `ai.basic` capability gate (already enforced deeper via
  `requireCapability`). Management mutations keep their role gates.

## Testing

- Unit: `summarizeAgentUsage` (seeded rows: window math, channel split, org
  isolation), stats handler shape, playground gate (ai.basic member passes,
  entitlement-less rejected), id/slug resolution.
- Focused component/behavior tests in proportion (per CLAUDE.md testing
  policy); no browser-QA evidence run now.
- `tests/browser-qa/spec-source/catalog.mjs`: AI-BR-010 routes/steps updated
  for the new pages; regenerate the generated flow docs.
