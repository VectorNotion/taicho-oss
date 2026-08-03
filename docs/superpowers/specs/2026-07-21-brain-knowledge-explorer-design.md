# Brain (Atlas) — Knowledge Explorer Design

Approved direction: the interactive concept at claude.ai/code/artifact/cee86ee3-68c0-4acd-8e94-e7d935821a7c (M1–M5). This spec makes it buildable.

## What it is

A tasteful, living knowledge explorer over the platform's Neo4j graph. The user sees their world — projects, capabilities, topics, ideas, drafts, leads, personas — as one force-directed map they can drag, hop through, inspect, act from, and grow. Cypher, labels, and every other database concept stay invisible.

- **Codename / package:** Atlas (`packages/atlas/`). Never user-facing.
- **User-facing name:** **Brain** — nav item at the top of the sidebar, route `/brain` in the unified app.
- **Renderer:** D3 (`d3-force`, `d3-zoom`) driving a `<canvas>`; React owns state, D3 owns physics and zoom transforms. ISC/MIT licenses only.
- **Data:** three JSON API routes backed by one graph repository that runs read-only Cypher through the existing platform Neo4j driver.

## Principles (from the concept, binding)

1. **No database words, ever.** No "node", "edge", "label", "Cypher", "query" in any user-visible string. Things are called what they are: lead, topic, idea, draft, capability, persona.
2. **Hop is the primary gesture.** Click focuses a thing and blooms its neighborhood; each hop extends a breadcrumb trail; back retraces.
3. **Every node is actionable.** The inspector is a typed card with real agent actions that stream results back into the map.
4. **Agents grow it while you watch.** Actions and Add use the existing streaming routes; when they finish, new nodes animate into the simulation.
5. **Filmable at every zoom.** A 3-second screen recording of any state shows motion (drift, bloom, or growth). Launch requirement.

## Vocabulary mapping (Neo4j → user)

| Explorer type | Neo4j labels | User word | Color token |
|---|---|---|---|
| `project` | Project | Project | violet `#8b7cf7` |
| `capability` | Framework, Database, Cloud, Language, AIComponent, Feature, Integration, BusinessValue | Capability | cyan `#5fd4d0` |
| `topic` | Topic | Topic | amber `#d9a15c` |
| `idea` | ContentIdea | Idea | green `#7cc98f` |
| `draft` | ContentDraft | Draft | green, ring-style |
| `research-item` | ResearchItem | Research | amber, small |
| `source` | ResearchSource | Source | amber, ring-style |
| `lead` | Lead | Lead | rose `#d97c8a` |
| `lead-research` | LeadResearch | Research | rose, small |
| `qualification` | LeadQualification | Qualification | rose, small |
| `persona` | Persona | Persona | white `#e6e6f0` |
| `agent` *(reserved)* | Agent *(future — other workstream)* | Agent | violet, small, dashed edges |

**Excluded from v1** (noise; reachable via deep links from inspector cards): LeadNote, LeadActivity, OutreachMessage, CompanyInsight, Competitor, Settings.

Edge kinds are passed through by relationship type but rendered uniformly (one visual style; agent edges dashed when the `agent` type arrives later).

## Views & behavior

### Overview constellation (initial load)

Curated, never a hairball. Inclusion rules:
- All `Project`, active `Topic` (status `active`), all `Lead`, active `Persona` (isActive), all `ContentIdea` + `ContentDraft`, `LeadResearch`/`LeadQualification` satellites of included leads.
- `capability` nodes only with degree ≥ 2 **or** attached to a Topic (DERIVED_FROM target).
- `ResearchItem` only the 25 most recent; `ResearchSource` only if enabled.
- Hard cap 400 nodes; if exceeded, drop lowest-degree capabilities first, then oldest research items.

### Focus & hop

- Click node → node becomes focus: neighbors + edges at full strength, everything else dims to ~12%; inspector opens; trail appends.
- If the node's neighborhood isn't fully loaded, fetch `/api/brain/neighborhood/:id` and merge new nodes into the live simulation (they animate in from the focus node's position with a brief entrance).
- Click empty canvas → clear focus, close inspector (trail persists until a new hop replaces the tail or Back is used).
- Trail: `A › B › C` chips + Back; max 8 shown, older collapse into `…`.

### Inspector (typed cards)

Right-side floating panel. Per-type content and actions (actions call **existing** routes; no new agent code):

| Type | Card shows | Actions |
|---|---|---|
| project | title, processed state, capability count | **Re-extract** → POST `/api/content/projects/:id/ingest/stream` · Open (`/content/projects/:id`) |
| capability | name, connected projects/topics count | Show connections (= focus stays, no route) |
| topic | displayName, status, idea/research counts | **Generate ideas** → POST `/api/content/generate-ideas/stream` · Open (`/content/topics`) |
| idea | title, status, priority | **Refine** → `/api/content/ideas/:id/refine/stream` · **Draft…** (type picker) → `/api/content/ideas/:id/draft/stream` · Open (`/content/ideas/:id`) |
| draft | title, type, status | Open (`/content/ideas/:ideaId` when known, else `/content`) |
| lead | name, title @ company, status, score if qualified | **Research** (marks: run from lead page v1 — deep link) · **Re-qualify** → `/api/outreach/leads/:id/qualify/stream` · Open (`/outreach/leads/:id`) |
| research-item / lead-research / qualification / source | title/summary fields | Open parent page |
| persona | name, matched-lead count | Open (`/outreach/leads`) |

Streaming actions use the existing `useActionStream` hook; while streaming, the inspector shows the reasoning line (single-line ticker) and the focus node gets a pulsing halo; on `final`, the view refetches the focus neighborhood and merges — new nodes animate in. On `error`, toast + halo turns rose.

### Search / Add (⌘K)

- One command bar, top-left overlay. Typing filters `/api/brain/search?q=` (name/title fuzzy, server-side `toLower CONTAINS`, cap 12); Enter/click flies (zoom+pan tween) to the node and focuses it.
- Input starting with `+` switches to Add-a-lead: `+ Name, Title @ Company` (Title and Company optional; parse `+ <name>[, <title>][ @ <company>]`). Enter → POST existing `/api/outreach/leads` route → new node merged at viewport center with entrance animation → focused. v1 adds leads only. (Auto-research chaining is a fast-follow; v1 shows the card so the user can hit its actions.)

### Lenses

`Everything · Content · Leads · Activity` — pill row, top-right.
- Content: project/capability/topic/idea/draft/research-item/source at full opacity; pipeline types at 15%.
- Leads: inverse.
- Activity: nodes with `createdAt` within 7 days at full opacity + soft glow; rest 15%. (Server returns best-effort `createdAt` per node; missing → treated as old.)
- Lenses only re-style; they never re-fetch or remove nodes.

### Semantic zoom (d3-zoom, LOD by scale k)

- k < 0.55 — constellation: edges hidden, per-type cluster tint ellipses (centroid ± 1.5σ) with type-word labels; only nodes r ≥ 12 drawn.
- 0.55 ≤ k ≤ 1.1 — majors: all nodes, edges at low alpha, labels only for r ≥ 9 or hovered/focused.
- k > 1.1 — detail: all labels.
- Node radius: `5 + 3·√degree`, clamped to 18. Zoom extent [0.3, 3].

### Physics (initial tuning, one place to change)

`forceManyBody(-180)` · `forceLink(distance 70, strength 0.4)` · `forceCollide(r + 6)` · `forceCenter` + weak per-type cluster anchors (`forceX/forceY` strength 0.03 toward type centroid seeds). `alphaDecay 0.02`; reheat (`alpha(0.5).restart()`) on merge/drag. `prefers-reduced-motion`: simulation runs to settle then pauses; drag still works.

## API contracts

All responses share:

```ts
type BrainNode = {
  id: string; label: string; type: BrainNodeType; // vocabulary table above
  degree: number; createdAt: string | null;
  meta: Record<string, string | number | null>; // type-specific card fields
};
type BrainLink = { a: string; b: string; kind: string };
type BrainGraph = { nodes: BrainNode[]; links: BrainLink[] };
```

- `GET /api/brain/overview` → `BrainGraph` (curation rules above).
- `GET /api/brain/neighborhood/[id]` → `BrainGraph` (the node + 1-hop neighbors, all types except v1 exclusions; cap 100).
- `GET /api/brain/search?q=` → `{ results: Array<Pick<BrainNode,'id'|'label'|'type'> & { sub: string }> }` (cap 12).

Repository: `packages/atlas/data/brain-repository.ts`, read-only Cypher via `getSession()` from `@/packages/platform/data/neo4j`. No writes anywhere in Atlas — Add uses the existing leads route.

## Placement

- `apps/unified/app/brain/page.tsx` (client view), nav item **Brain** inserted where Overview sits (Overview stays routable at `/`; nav's top item becomes Brain). Unified app only in v1 — this is the workspace's home surface, not a per-product feature.
- Dark canvas `#0c0c15` regardless of future theming; the Brain is committed dark (product decision, matches concept).

## Non-goals (v1)

- No editing/deleting from the graph; no drag-to-connect.
- No cascade/Postgres-mirrored data (funnels, variants, runs) and no `agent`-type nodes until the Agent/AgentRun graph bridge lands (other workstream); the type map reserves them.
- No mobile-optimized interactions (desktop pointer first); no saved views/multi-select; no natural-language query mode.

## Success criteria

1. Overview paints < 1.5 s on the live dataset; hop merge < 300 ms perceived (fetch + entrance).
2. The film test: recording any of — overview drift, a hop bloom, an action streaming new nodes in, an add landing — shows real motion within 3 s.
3. Zero database vocabulary anywhere in the UI.
4. All existing test gates stay green; new repository tests pass against local Neo4j.
