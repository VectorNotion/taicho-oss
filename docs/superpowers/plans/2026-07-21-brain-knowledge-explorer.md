# Brain (Atlas) Knowledge Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Brain — a D3-force canvas knowledge explorer at `/brain` in the unified app: curated overview constellation, click-to-hop with breadcrumb trail, typed inspector cards firing the existing streaming agent actions, ⌘K search/fly-to, `+` add-a-lead, lenses, and semantic zoom — per `docs/superpowers/specs/2026-07-21-brain-knowledge-explorer-design.md`.

**Architecture:** One read-only graph repository (`packages/atlas/data/brain-repository.ts`) translates Neo4j labels into the user vocabulary behind three JSON routes (`/api/brain/overview|neighborhood/[id]|search`). One canvas component (`BrainCanvas`) owns d3-force physics, d3-zoom LOD, drawing, drag, and hover, exposing an imperative handle; one client view (`BrainView`) owns data fetching, hop/trail state, lenses, the inspector, and the command bar. Agent actions reuse `useActionStream` + the existing `/stream` routes untouched.

**Tech Stack:** `d3-force@^3`, `d3-zoom@^3`, `d3-selection@^3` (ISC) added to the unified app only. Existing: Next 16 App Router, `useActionStream` (`packages/ui/hooks/use-action-stream.ts`), platform Neo4j driver (`packages/platform/data/neo4j.ts`), genui kit conventions.

## Global Constraints

- **No database vocabulary in any user-visible string** — no "node/edge/label/query/Cypher"; use lead/topic/idea/draft/capability/persona/project.
- **Atlas is read-only against Neo4j.** No write Cypher anywhere under `packages/atlas/`. Add-a-lead uses the existing `POST /api/outreach/leads` route; agent actions use the existing `/stream` routes. No new agent code, no changes to orchestrators or streaming kernel.
- **Type/color vocabulary is fixed** (spec table): project violet `#8b7cf7` · capability cyan `#5fd4d0` · topic/research-item/source amber `#d9a15c` · idea/draft green `#7cc98f` · lead/lead-research/qualification rose `#d97c8a` · persona white `#e6e6f0`. `agent` type reserved, not emitted in v1.
- **Excluded labels v1:** LeadNote, LeadActivity, OutreachMessage, CompanyInsight, Competitor, Settings.
- **Overview cap 400 nodes / neighborhood cap 100 / search cap 12** exactly as specified.
- **Physics/LOD constants live only in `packages/atlas/physics/constants.ts`** — no magic numbers in components.
- The Brain page is committed dark (`#0c0c15` canvas) and unified-app only.
- Routes carry no in-route auth (middleware handles it, same as all `/api` siblings).
- Verify gates with: `pnpm test:content`, `pnpm test:cascade`, `pnpm --filter @content-automation/outreach test`, `pnpm test:architecture`, `pnpm build`. New repository tests run inside the content-generator test suite (house pattern: colocated in `products/content-generator/tests/` where local Neo4j env wiring already exists — Atlas tests go in `packages/atlas/` source but are executed by a new root script added in Task 2).
- Commit after every task; never push (push = deploy; user review gate).

## File Map

| File | Responsibility |
|---|---|
| `packages/atlas/types.ts` (create) | `BrainNode`, `BrainLink`, `BrainGraph`, `BrainNodeType`, type guards |
| `packages/atlas/palette.ts` (create) | color/radius/label rules per type (single source) |
| `packages/atlas/physics/constants.ts` (create) | force + LOD + animation constants |
| `packages/atlas/data/brain-repository.ts` (create) | `fetchOverview`, `fetchNeighborhood`, `searchNodes` (read-only Cypher) |
| `packages/atlas/data/brain-repository.test.ts` (create) | repository tests vs local Neo4j |
| `apps/unified/app/api/brain/{overview,neighborhood/[id],search}/route.ts` (create ×3) | thin JSON routes |
| `packages/atlas/components/BrainCanvas.tsx` (create) | physics + zoom + draw + drag/hover, imperative handle |
| `packages/atlas/components/BrainView.tsx` (create) | fetch/hop/trail/lenses/inspector/command-bar orchestration |
| `packages/atlas/components/Inspector.tsx` (create) | typed cards + streaming actions |
| `packages/atlas/components/CommandBar.tsx` (create) | ⌘K search/fly-to + `+` add-a-lead |
| `apps/unified/app/brain/page.tsx` (create) | page shell |
| unified sidebar nav (modify — locate in Task 7) | "Brain" nav item above Overview |
| `package.json` root (modify) | `test:atlas` script |
| `apps/unified/package.json` (modify) | d3 deps |

---

### Task 1: Atlas vocabulary — types, palette, constants

**Files:**
- Create: `packages/atlas/types.ts`, `packages/atlas/palette.ts`, `packages/atlas/physics/constants.ts`
- Modify: `apps/unified/package.json` (dependencies)

**Interfaces:**
- Produces (every later task imports these exact names):
  - `type BrainNodeType = 'project'|'capability'|'topic'|'idea'|'draft'|'research-item'|'source'|'lead'|'lead-research'|'qualification'|'persona'|'agent'`
  - `type BrainNode = { id: string; label: string; type: BrainNodeType; degree: number; createdAt: string | null; meta: Record<string, string | number | null> }`
  - `type BrainLink = { a: string; b: string; kind: string }`
  - `type BrainGraph = { nodes: BrainNode[]; links: BrainLink[] }`
  - `LABEL_TO_TYPE: Record<string, BrainNodeType>`, `TYPE_COLOR: Record<BrainNodeType, string>`, `TYPE_RING: Set<BrainNodeType>`, `nodeRadius(degree: number): number`
  - `PHYS` and `LOD` constant objects.

- [ ] **Step 1: Write the three modules**

`packages/atlas/types.ts`:

```ts
/** Atlas (the Brain) — shared vocabulary. User-facing words only; Neo4j
 *  labels are translated at the repository boundary and never leave it. */

export type BrainNodeType =
  | 'project' | 'capability' | 'topic' | 'idea' | 'draft'
  | 'research-item' | 'source' | 'lead' | 'lead-research'
  | 'qualification' | 'persona' | 'agent';

export type BrainNode = {
  id: string;
  label: string;
  type: BrainNodeType;
  degree: number;
  createdAt: string | null;
  meta: Record<string, string | number | null>;
};

export type BrainLink = { a: string; b: string; kind: string };
export type BrainGraph = { nodes: BrainNode[]; links: BrainLink[] };

export type BrainSearchResult = Pick<BrainNode, 'id' | 'label' | 'type'> & { sub: string };
```

`packages/atlas/palette.ts`:

```ts
import type { BrainNodeType } from './types';

/** Neo4j label → explorer type. The ONLY place labels are known. */
export const LABEL_TO_TYPE: Record<string, BrainNodeType> = {
  Project: 'project',
  Framework: 'capability', Database: 'capability', Cloud: 'capability',
  Language: 'capability', AIComponent: 'capability', Feature: 'capability',
  Integration: 'capability', BusinessValue: 'capability',
  Topic: 'topic',
  ContentIdea: 'idea',
  ContentDraft: 'draft',
  ResearchItem: 'research-item',
  ResearchSource: 'source',
  Lead: 'lead',
  LeadResearch: 'lead-research',
  LeadQualification: 'qualification',
  Persona: 'persona',
};

export const TYPE_COLOR: Record<BrainNodeType, string> = {
  project: '#8b7cf7', capability: '#5fd4d0', topic: '#d9a15c',
  idea: '#7cc98f', draft: '#7cc98f', 'research-item': '#d9a15c',
  source: '#d9a15c', lead: '#d97c8a', 'lead-research': '#d97c8a',
  qualification: '#d97c8a', persona: '#e6e6f0', agent: '#8b7cf7',
};

/** Ring-style (hollow) types. */
export const TYPE_RING = new Set<BrainNodeType>(['draft', 'source']);

/** User word shown in the inspector type line. */
export const TYPE_WORD: Record<BrainNodeType, string> = {
  project: 'Project', capability: 'Capability', topic: 'Topic', idea: 'Idea',
  draft: 'Draft', 'research-item': 'Research', source: 'Source', lead: 'Lead',
  'lead-research': 'Research', qualification: 'Qualification',
  persona: 'Persona', agent: 'Agent',
};

export function nodeRadius(degree: number): number {
  return Math.min(18, 5 + 3 * Math.sqrt(Math.max(0, degree)));
}
```

`packages/atlas/physics/constants.ts`:

```ts
/** All force/LOD/animation tuning in one place (spec §Physics, §Semantic zoom). */
export const PHYS = {
  charge: -180,
  linkDistance: 70,
  linkStrength: 0.4,
  collidePad: 6,
  clusterStrength: 0.03,
  alphaDecay: 0.02,
  reheatAlpha: 0.5,
} as const;

export const LOD = {
  zoomMin: 0.3,
  zoomMax: 3,
  farK: 0.55,       // below: constellation mode
  detailK: 1.1,     // above: all labels
  majorLabelR: 9,   // mid mode: label nodes with r >= this
  farNodeR: 12,     // far mode: draw only nodes with r >= this
} as const;

export const ANIM = {
  entranceMs: 450,
  flyMs: 600,
  dimAlpha: 0.12,
  edgeAlpha: 0.22,
  focusEdgeAlpha: 0.65,
} as const;
```

- [ ] **Step 2: Add d3 dependencies to the unified app**

In `apps/unified/package.json` dependencies add (then `pnpm install`):

```json
"d3-force": "^3.0.0",
"d3-selection": "^3.0.0",
"d3-zoom": "^3.0.0"
```

and devDependencies:

```json
"@types/d3-force": "^3.0.10",
"@types/d3-selection": "^3.0.11",
"@types/d3-zoom": "^3.0.8"
```

- [ ] **Step 3: Build to typecheck, commit**

Run: `pnpm --filter @content-automation/unified-app build`
Expected: `✓ Compiled successfully` (modules unused so far).

```bash
git add packages/atlas apps/unified/package.json pnpm-lock.yaml
git commit -m "feat(atlas): vocabulary, palette, physics constants + d3 deps"
```

---

### Task 2: Brain repository — Cypher behind the vocabulary

**Files:**
- Create: `packages/atlas/data/brain-repository.ts`
- Test: `packages/atlas/data/brain-repository.test.ts`
- Modify: root `package.json` (add `test:atlas` script)

**Interfaces:**
- Consumes: `getSession` from `@/packages/platform/data/neo4j` (same import used by `products/outreach/data/persona-repository.ts:1`).
- Produces: `fetchOverview(): Promise<BrainGraph>` · `fetchNeighborhood(id: string): Promise<BrainGraph>` · `searchNodes(q: string): Promise<BrainSearchResult[]>`.

- [ ] **Step 1: Write the failing test**

`packages/atlas/data/brain-repository.test.ts` (house pattern from `products/content-generator/tests/migration-repositories.test.ts`: test-prefixed ids + cleanup; run with local Neo4j):

```ts
process.env.NEO4J_URI = process.env.NEO4J_URI ?? 'bolt://localhost:7687';

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { getSession } from '@/packages/platform/data/neo4j';
import { fetchOverview, fetchNeighborhood, searchNodes } from './brain-repository';

const P = `atlas-test-project-${process.pid}`;
const T = `atlas-test-topic-${process.pid}`;
const L = `atlas-test-lead-${process.pid}`;

before(async () => {
  const s = await getSession();
  try {
    await s.run(
      `CREATE (p:Project {id: $p, title: 'Atlas Test Project', createdAt: datetime()})
       CREATE (f:Feature {id: $p + '-feat', name: 'Atlas Test Feature'})
       CREATE (t:Topic {id: $t, name: 'atlas-test-topic', displayName: 'Atlas Test Topic', status: 'active'})
       CREATE (l:Lead {id: $l, name: 'Atlas Test Lead', company: 'TestCo', title: 'CEO', status: 'new', priority: 'medium'})
       CREATE (p)-[:HAS_FEATURE]->(f)
       CREATE (t)-[:DERIVED_FROM]->(f)`,
      { p: P, t: T, l: L },
    );
  } finally { await s.close(); }
});

after(async () => {
  const s = await getSession();
  try {
    await s.run(
      `MATCH (n) WHERE n.id STARTS WITH 'atlas-test-' DETACH DELETE n`,
    );
  } finally { await s.close(); }
});

test('overview returns vocabulary-typed nodes and links, no raw labels', async () => {
  const g = await fetchOverview();
  const proj = g.nodes.find((n) => n.id === P);
  assert.ok(proj, 'seeded project present');
  assert.equal(proj!.type, 'project');
  assert.equal(proj!.label, 'Atlas Test Project');
  const topic = g.nodes.find((n) => n.id === T);
  assert.ok(topic, 'active topic present');
  assert.equal(topic!.type, 'topic');
  assert.equal(topic!.label, 'Atlas Test Topic');
  const lead = g.nodes.find((n) => n.id === L);
  assert.ok(lead, 'lead present');
  assert.equal(lead!.meta.company, 'TestCo');
  // capability attached to a topic must be included even at degree 2
  const feat = g.nodes.find((n) => n.id === P + '-feat');
  assert.ok(feat, 'topic-attached capability included');
  assert.equal(feat!.type, 'capability');
  // link integrity: every link endpoint exists in nodes
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const l of g.links) {
    assert.ok(ids.has(l.a) && ids.has(l.b), `dangling link ${l.a}->${l.b}`);
  }
  assert.ok(g.nodes.length <= 400);
});

test('neighborhood returns the node plus 1-hop, capped', async () => {
  const g = await fetchNeighborhood(P);
  assert.ok(g.nodes.some((n) => n.id === P));
  assert.ok(g.nodes.some((n) => n.id === P + '-feat'));
  assert.ok(g.nodes.length <= 100);
  assert.ok(g.links.some((l) => (l.a === P && l.b === P + '-feat') || (l.b === P && l.a === P + '-feat')));
});

test('search finds by partial name, case-insensitive, capped at 12', async () => {
  const r = await searchNodes('atlas test le');
  assert.ok(r.some((x) => x.id === L));
  assert.ok(r.length <= 12);
  const empty = await searchNodes('zz-no-such-thing-zz');
  assert.deepEqual(empty, []);
});
```

- [ ] **Step 2: Add the root script and verify the test fails**

Root `package.json` scripts (mirror the env pattern of `test:content` exactly — copy its `set -a`/`.env`/`POSTGRES_HOST` prefix and NEO4J override, pointing at the atlas test):

```json
"test:atlas": "set -a && . ./.env && set +a && POSTGRES_HOST=localhost NEO4J_URI=bolt://localhost:7687 npx tsx --test packages/atlas/data/brain-repository.test.ts"
```

(Read the existing `test:content` line first and copy its exact shell prefix — it is the proven env wiring for local Neo4j tests.)

Run: `pnpm test:atlas`
Expected: FAIL — `Cannot find module './brain-repository'`

- [ ] **Step 3: Write the repository**

`packages/atlas/data/brain-repository.ts`:

```ts
/** Read-only Cypher behind the Brain. The ONLY module that speaks Neo4j
 *  labels; everything leaves here in the user vocabulary (types.ts). */
import { getSession } from '@/packages/platform/data/neo4j';
import { LABEL_TO_TYPE } from '../palette';
import type { BrainGraph, BrainNode, BrainLink, BrainSearchResult, BrainNodeType } from '../types';

const EXCLUDED = ['LeadNote', 'LeadActivity', 'OutreachMessage', 'CompanyInsight', 'Competitor', 'Settings'];
const OVERVIEW_CAP = 400;
const NEIGHBORHOOD_CAP = 100;
const SEARCH_CAP = 12;

type Neo4jValue = { toNumber?: () => number } | number | string | null;
function num(v: Neo4jValue): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v);
}

/** Best-effort display label + createdAt + card meta per raw node. */
function toBrainNode(props: Record<string, unknown>, labels: string[], degree: number): BrainNode | null {
  const label = labels.find((l) => LABEL_TO_TYPE[l]);
  if (!label) return null;
  const type: BrainNodeType = LABEL_TO_TYPE[label];
  const p = props as Record<string, string | number | null>;
  const display =
    (p.displayName as string) || (p.title as string) || (p.name as string) ||
    (type === 'lead-research' ? 'Research' : type === 'qualification' ? `Qualification · ${p.score ?? '–'}` : String(p.id ?? 'Unknown'));
  const createdRaw = p.createdAt ?? p.created_at ?? p.qualifiedAt ?? p.first_mentioned ?? null;
  return {
    id: String(p.id ?? p.leadId ?? display),
    label: display,
    type,
    degree,
    createdAt: createdRaw === null ? null : String(createdRaw),
    meta: {
      status: (p.status as string) ?? null,
      priority: (p.priority as string) ?? null,
      company: (p.company as string) ?? null,
      title: type === 'lead' ? ((p.title as string) ?? null) : null,
      score: p.score !== undefined ? num(p.score as Neo4jValue) : null,
      type: (p.type as string) ?? null,
      ideaId: (p.ideaId as string) ?? null,
      matchedPersonaName: (p.matchedPersonaName as string) ?? null,
      processed: p.processed !== undefined ? String(p.processed) : null,
    },
  };
}

function dedupeGraph(nodes: BrainNode[], links: BrainLink[]): BrainGraph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const cleanLinks = links.filter((l) => {
    if (!byId.has(l.a) || !byId.has(l.b) || l.a === l.b) return false;
    const k = l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { nodes: [...byId.values()], links: cleanLinks };
}

/** Rows of {props, labels, degree} + relationship rows → BrainGraph. */
function buildGraph(
  nodeRows: Array<{ props: Record<string, unknown>; labels: string[]; degree: number }>,
  linkRows: Array<{ a: string; b: string; kind: string }>,
): BrainGraph {
  const nodes: BrainNode[] = [];
  for (const r of nodeRows) {
    const n = toBrainNode(r.props, r.labels, r.degree);
    if (n) nodes.push(n);
  }
  return dedupeGraph(nodes, linkRows);
}

export async function fetchOverview(): Promise<BrainGraph> {
  const session = await getSession();
  try {
    // Curated node set per spec: projects, active topics, leads, active personas,
    // ideas+drafts, lead satellites, topic-attached or degree>=2 capabilities,
    // 25 recent research items, enabled sources.
    const nodeResult = await session.run(
      `
      CALL () {
        MATCH (n:Project) RETURN n
        UNION
        MATCH (n:Topic {status: 'active'}) RETURN n
        UNION
        MATCH (n:Lead) RETURN n
        UNION
        MATCH (n:Persona {isActive: true}) RETURN n
        UNION
        MATCH (n:ContentIdea) RETURN n
        UNION
        MATCH (n:ContentDraft) RETURN n
        UNION
        MATCH (:Lead)-[:HAS_RESEARCH|HAS_QUALIFICATION]->(n) RETURN n
        UNION
        MATCH (n) WHERE (n:Framework OR n:Database OR n:Cloud OR n:Language
          OR n:AIComponent OR n:Feature OR n:Integration OR n:BusinessValue)
          AND (COUNT { (n)--() } >= 2 OR EXISTS { (:Topic)-[:DERIVED_FROM]->(n) })
        RETURN n
        UNION
        MATCH (n:ResearchItem) WITH n ORDER BY n.createdAt DESC LIMIT 25 RETURN n
        UNION
        MATCH (n:ResearchSource {enabled: true}) RETURN n
      }
      WITH DISTINCT n
      RETURN properties(n) AS props, labels(n) AS labels, COUNT { (n)--() } AS degree
      LIMIT ${OVERVIEW_CAP}
      `,
    );
    const nodeRows = nodeResult.records.map((r) => ({
      props: r.get('props') as Record<string, unknown>,
      labels: r.get('labels') as string[],
      degree: num(r.get('degree')),
    }));
    const ids = nodeRows
      .map((r) => (r.props as { id?: unknown; leadId?: unknown }).id ?? (r.props as { leadId?: unknown }).leadId)
      .filter(Boolean)
      .map(String);

    const linkResult = await session.run(
      `
      MATCH (a)-[r]->(b)
      WHERE coalesce(a.id, a.leadId) IN $ids AND coalesce(b.id, b.leadId) IN $ids
      RETURN coalesce(a.id, a.leadId) AS a, coalesce(b.id, b.leadId) AS b, type(r) AS kind
      `,
      { ids },
    );
    const linkRows = linkResult.records.map((r) => ({
      a: String(r.get('a')), b: String(r.get('b')), kind: String(r.get('kind')),
    }));
    return buildGraph(nodeRows, linkRows);
  } finally {
    await session.close();
  }
}

export async function fetchNeighborhood(id: string): Promise<BrainGraph> {
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (c) WHERE coalesce(c.id, c.leadId) = $id
      WITH c LIMIT 1
      OPTIONAL MATCH (c)-[r]-(m)
      WHERE NONE(l IN labels(m) WHERE l IN $excluded)
      WITH c, r, m LIMIT ${NEIGHBORHOOD_CAP}
      RETURN properties(c) AS cProps, labels(c) AS cLabels, COUNT { (c)--() } AS cDegree,
             collect({props: properties(m), labels: labels(m),
                      degree: COUNT { (m)--() },
                      a: coalesce(startNode(r).id, startNode(r).leadId),
                      b: coalesce(endNode(r).id, endNode(r).leadId),
                      kind: type(r)}) AS nbrs
      `,
      { id, excluded: EXCLUDED },
    );
    if (result.records.length === 0) return { nodes: [], links: [] };
    const rec = result.records[0];
    const nodeRows = [{
      props: rec.get('cProps') as Record<string, unknown>,
      labels: rec.get('cLabels') as string[],
      degree: num(rec.get('cDegree')),
    }];
    const linkRows: BrainLink[] = [];
    for (const nb of rec.get('nbrs') as Array<Record<string, unknown>>) {
      if (!nb || !nb.labels) continue;
      nodeRows.push({
        props: nb.props as Record<string, unknown>,
        labels: nb.labels as string[],
        degree: num(nb.degree as never),
      });
      if (nb.a && nb.b) linkRows.push({ a: String(nb.a), b: String(nb.b), kind: String(nb.kind) });
    }
    return buildGraph(nodeRows, linkRows);
  } finally {
    await session.close();
  }
}

export async function searchNodes(q: string): Promise<BrainSearchResult[]> {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (n)
      WHERE NONE(l IN labels(n) WHERE l IN $excluded)
        AND (toLower(coalesce(n.displayName, '')) CONTAINS $q
          OR toLower(coalesce(n.title, '')) CONTAINS $q
          OR toLower(coalesce(n.name, '')) CONTAINS $q)
      RETURN properties(n) AS props, labels(n) AS labels
      LIMIT ${SEARCH_CAP}
      `,
      { q: query, excluded: EXCLUDED },
    );
    const out: BrainSearchResult[] = [];
    for (const r of result.records) {
      const n = toBrainNode(r.get('props') as Record<string, unknown>, r.get('labels') as string[], 0);
      if (!n) continue;
      const sub = [n.meta.title, n.meta.company, n.meta.status].filter(Boolean).join(' · ');
      out.push({ id: n.id, label: n.label, type: n.type, sub });
    }
    return out;
  } finally {
    await session.close();
  }
}
```

Cypher syntax note: `CALL () { ... UNION ... }` subquery and `COUNT { (n)--() }` require Neo4j 5 — the deployed server and local container are Neo4j 5 (CI uses `neo4j:5`). If the local `cypher` version rejects `CALL ()`, use the older `CALL { ... }` form (no parens) — check by running the query once via the test.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:atlas`
Expected: PASS (3 tests). If `CALL ()` errors, apply the syntax note and re-run.

- [ ] **Step 5: Commit**

```bash
git add packages/atlas/data package.json
git commit -m "feat(atlas): brain repository — overview/neighborhood/search over Neo4j"
```

---

### Task 3: API routes

**Files:**
- Create: `apps/unified/app/api/brain/overview/route.ts`
- Create: `apps/unified/app/api/brain/neighborhood/[id]/route.ts`
- Create: `apps/unified/app/api/brain/search/route.ts`

**Interfaces:**
- Consumes: Task 2 repository functions.
- Produces: `GET /api/brain/overview` → `BrainGraph` · `GET /api/brain/neighborhood/[id]` → `BrainGraph` · `GET /api/brain/search?q=` → `{ results: BrainSearchResult[] }`.

- [ ] **Step 1: Write the routes**

`apps/unified/app/api/brain/overview/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { fetchOverview } from '@/packages/atlas/data/brain-repository';

export async function GET() {
  try {
    return NextResponse.json(await fetchOverview());
  } catch (error) {
    console.error('brain overview failed:', error);
    return NextResponse.json({ error: 'Could not load the map' }, { status: 500 });
  }
}
```

`apps/unified/app/api/brain/neighborhood/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { fetchNeighborhood } from '@/packages/atlas/data/brain-repository';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json(await fetchNeighborhood(id));
  } catch (error) {
    console.error('brain neighborhood failed:', error);
    return NextResponse.json({ error: 'Could not load connections' }, { status: 500 });
  }
}
```

`apps/unified/app/api/brain/search/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { searchNodes } from '@/packages/atlas/data/brain-repository';

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q') ?? '';
    return NextResponse.json({ results: await searchNodes(q) });
  } catch (error) {
    console.error('brain search failed:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build + smoke, commit**

Run: `pnpm --filter @content-automation/unified-app build` — Expected: green.
Smoke (server running locally with env): `curl -s localhost:3000/api/brain/overview | head -c 200` — Expected: `{"nodes":[{"id":...` (or a 307 to sign-in when unauthenticated — either proves the route mounts).

```bash
git add apps/unified/app/api/brain
git commit -m "feat(atlas): brain API routes"
```

---

### Task 4: BrainCanvas — physics, zoom, draw, drag

**Files:**
- Create: `packages/atlas/components/BrainCanvas.tsx`

**Interfaces:**
- Consumes: Task 1 modules; `d3-force`, `d3-zoom`, `d3-selection`.
- Produces (Task 5/6/7 rely on these exact shapes):

```ts
export type SimNode = BrainNode & { x: number; y: number; vx: number; vy: number; fx?: number | null; fy?: number | null; entered: number };
export type BrainCanvasHandle = {
  setGraph(g: BrainGraph): void;                    // replace all
  mergeGraph(g: BrainGraph, originId?: string): void; // add new nodes/links, entrance from origin
  focus(id: string | null): void;                   // dim non-neighborhood
  flyTo(id: string): void;                          // zoom/pan tween to node, then focus
  setLens(lens: 'everything' | 'content' | 'leads' | 'activity'): void;
  setPulse(id: string | null): void;                // streaming halo
};
type BrainCanvasProps = {
  onSelectNode: (node: BrainNode) => void;
  onClearFocus: () => void;
};
export const BrainCanvas = forwardRef<BrainCanvasHandle, BrainCanvasProps>(...)
```

- [ ] **Step 1: Write the component**

`packages/atlas/components/BrainCanvas.tsx`:

```tsx
'use client';

import {
  forwardRef, useEffect, useImperativeHandle, useRef,
} from 'react';
import {
  forceSimulation, forceManyBody, forceLink, forceCollide, forceX, forceY,
  type Simulation, type SimulationLinkDatum,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import type { BrainGraph, BrainNode, BrainNodeType } from '../types';
import { TYPE_COLOR, TYPE_RING, nodeRadius } from '../palette';
import { PHYS, LOD, ANIM } from '../physics/constants';

export type SimNode = BrainNode & {
  x: number; y: number; vx: number; vy: number;
  fx?: number | null; fy?: number | null; entered: number;
};
type SimLink = SimulationLinkDatum<SimNode> & { kind: string };

export type BrainCanvasHandle = {
  setGraph(g: BrainGraph): void;
  mergeGraph(g: BrainGraph, originId?: string): void;
  focus(id: string | null): void;
  flyTo(id: string): void;
  setLens(lens: 'everything' | 'content' | 'leads' | 'activity'): void;
  setPulse(id: string | null): void;
};

const CONTENT_TYPES = new Set<BrainNodeType>(['project', 'capability', 'topic', 'idea', 'draft', 'research-item', 'source']);
const LEAD_TYPES = new Set<BrainNodeType>(['lead', 'lead-research', 'qualification', 'persona']);
const RECENT_MS = 7 * 24 * 3600 * 1000;

/** Per-type anchor seeds (fractions of viewport) for gentle clustering. */
const CLUSTER: Partial<Record<BrainNodeType, [number, number]>> = {
  project: [0.42, 0.5], capability: [0.35, 0.55], topic: [0.62, 0.38],
  idea: [0.74, 0.62], draft: [0.78, 0.68], 'research-item': [0.55, 0.25],
  source: [0.5, 0.2], lead: [0.84, 0.3], 'lead-research': [0.88, 0.24],
  qualification: [0.88, 0.36], persona: [0.9, 0.44],
};

export const BrainCanvas = forwardRef<BrainCanvasHandle, {
  onSelectNode: (node: BrainNode) => void;
  onClearFocus: () => void;
}>(function BrainCanvas({ onSelectNode, onClearFocus }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({
    nodes: [] as SimNode[],
    links: [] as SimLink[],
    byId: new Map<string, SimNode>(),
    nbr: new Map<string, Set<string>>(),
    sim: null as Simulation<SimNode, SimLink> | null,
    transform: zoomIdentity as ZoomTransform,
    focusId: null as string | null,
    pulseId: null as string | null,
    hoverId: null as string | null,
    lens: 'everything' as 'everything' | 'content' | 'leads' | 'activity',
    dragging: null as SimNode | null,
    size: { w: 0, h: 0 },
    reduced: false,
  });

  function rebuildNeighbors() {
    const s = state.current;
    s.nbr = new Map(s.nodes.map((n) => [n.id, new Set([n.id])]));
    for (const l of s.links) {
      const a = (l.source as SimNode).id ?? String(l.source);
      const b = (l.target as SimNode).id ?? String(l.target);
      s.nbr.get(a)?.add(b);
      s.nbr.get(b)?.add(a);
    }
  }

  function applyForces() {
    const s = state.current;
    if (!s.sim) return;
    s.sim.nodes(s.nodes);
    (s.sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>)
      .links(s.links);
    s.sim
      .force('x', forceX<SimNode>((d) => (CLUSTER[d.type]?.[0] ?? 0.5) * s.size.w).strength(PHYS.clusterStrength))
      .force('y', forceY<SimNode>((d) => (CLUSTER[d.type]?.[1] ?? 0.5) * s.size.h).strength(PHYS.clusterStrength));
    s.sim.alpha(PHYS.reheatAlpha).restart();
  }

  useImperativeHandle(ref, () => ({
    setGraph(g) {
      const s = state.current;
      s.nodes = g.nodes.map((n) => ({
        ...n,
        x: (CLUSTER[n.type]?.[0] ?? 0.5) * (s.size.w || 900) + (Math.random() - 0.5) * 120,
        y: (CLUSTER[n.type]?.[1] ?? 0.5) * (s.size.h || 600) + (Math.random() - 0.5) * 120,
        vx: 0, vy: 0, entered: performance.now(),
      }));
      s.byId = new Map(s.nodes.map((n) => [n.id, n]));
      s.links = g.links
        .filter((l) => s.byId.has(l.a) && s.byId.has(l.b))
        .map((l) => ({ source: s.byId.get(l.a)!, target: s.byId.get(l.b)!, kind: l.kind }));
      rebuildNeighbors();
      applyForces();
    },
    mergeGraph(g, originId) {
      const s = state.current;
      const origin = originId ? s.byId.get(originId) : undefined;
      const ox = origin?.x ?? s.size.w / 2, oy = origin?.y ?? s.size.h / 2;
      for (const n of g.nodes) {
        if (s.byId.has(n.id)) continue;
        const sn: SimNode = {
          ...n,
          x: ox + (Math.random() - 0.5) * 40, y: oy + (Math.random() - 0.5) * 40,
          vx: 0, vy: 0, entered: performance.now(),
        };
        s.nodes.push(sn); s.byId.set(n.id, sn);
      }
      const have = new Set(s.links.map((l) => `${(l.source as SimNode).id}|${(l.target as SimNode).id}`));
      for (const l of g.links) {
        if (!s.byId.has(l.a) || !s.byId.has(l.b)) continue;
        if (have.has(`${l.a}|${l.b}`) || have.has(`${l.b}|${l.a}`)) continue;
        s.links.push({ source: s.byId.get(l.a)!, target: s.byId.get(l.b)!, kind: l.kind });
      }
      rebuildNeighbors();
      applyForces();
    },
    focus(id) { state.current.focusId = id; },
    flyTo(id) {
      const s = state.current;
      const n = s.byId.get(id);
      const canvas = canvasRef.current;
      if (!n || !canvas) return;
      const k = Math.max(1, s.transform.k);
      const t = zoomIdentity.translate(s.size.w / 2 - n.x * k, s.size.h / 2 - n.y * k).scale(k);
      select(canvas).transition().duration(ANIM.flyMs)
        .call((zoomBehavior as never as { transform: (sel: unknown, t: ZoomTransform) => void }).transform as never, t);
      s.focusId = id;
      onSelectNode(n);
    },
    setLens(lens) { state.current.lens = lens; },
    setPulse(id) { state.current.pulseId = id; },
  }));

  // zoom behavior lives at module scope of the component instance
  const zoomBehavior = useRef(
    zoom<HTMLCanvasElement, unknown>().scaleExtent([LOD.zoomMin, LOD.zoomMax]),
  ).current;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const s = state.current;
    s.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      s.size = { w: r.width, h: r.height };
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas); resize();

    s.sim = forceSimulation<SimNode>([])
      .force('charge', forceManyBody().strength(PHYS.charge))
      .force('link', forceLink<SimNode, SimLink>([]).distance(PHYS.linkDistance).strength(PHYS.linkStrength))
      .force('collide', forceCollide<SimNode>((d) => nodeRadius(d.degree) + PHYS.collidePad))
      .alphaDecay(PHYS.alphaDecay)
      .stop();

    zoomBehavior.on('zoom', (ev) => { s.transform = ev.transform; });
    select(canvas).call(zoomBehavior).on('dblclick.zoom', null);

    const toWorld = (mx: number, my: number): [number, number] => [
      (mx - s.transform.x) / s.transform.k,
      (my - s.transform.y) / s.transform.k,
    ];
    const pick = (mx: number, my: number): SimNode | null => {
      const [wx, wy] = toWorld(mx, my);
      let best: SimNode | null = null; let bd = 18 / s.transform.k;
      for (const n of s.nodes) {
        const d = Math.hypot(n.x - wx, n.y - wy) - nodeRadius(n.degree);
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    };

    let downNode: SimNode | null = null; let moved = false;
    canvas.addEventListener('pointerdown', (ev) => {
      const r = canvas.getBoundingClientRect();
      downNode = pick(ev.clientX - r.left, ev.clientY - r.top);
      moved = false;
      if (downNode) {
        s.dragging = downNode;
        downNode.fx = downNode.x; downNode.fy = downNode.y;
        canvas.setPointerCapture(ev.pointerId);
        ev.stopImmediatePropagation(); // keep d3-zoom from panning while dragging a node
      }
    }, { capture: true });
    canvas.addEventListener('pointermove', (ev) => {
      const r = canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      if (s.dragging) {
        const [wx, wy] = toWorld(mx, my);
        s.dragging.fx = wx; s.dragging.fy = wy;
        s.sim?.alpha(0.3).restart();
        moved = true;
      } else {
        s.hoverId = pick(mx, my)?.id ?? null;
        canvas.style.cursor = s.hoverId ? 'pointer' : 'grab';
      }
    });
    canvas.addEventListener('pointerup', () => {
      if (s.dragging) { s.dragging.fx = null; s.dragging.fy = null; s.dragging = null; }
      if (downNode && !moved) {
        s.focusId = downNode.id;
        onSelectNode(downNode);
      } else if (!downNode && !moved) {
        s.focusId = null;
        onClearFocus();
      }
      downNode = null;
    });

    const now = () => performance.now();
    let raf = 0;
    const frame = () => {
      if (!s.reduced || s.dragging) s.sim?.tick();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s.size.w, s.size.h);
      ctx.save();
      ctx.translate(s.transform.x, s.transform.y);
      ctx.scale(s.transform.k, s.transform.k);
      const k = s.transform.k;
      const focusSet = s.focusId ? s.nbr.get(s.focusId) : null;
      const lensAlpha = (n: SimNode): number => {
        if (s.lens === 'content') return CONTENT_TYPES.has(n.type) ? 1 : 0.15;
        if (s.lens === 'leads') return LEAD_TYPES.has(n.type) ? 1 : 0.15;
        if (s.lens === 'activity') {
          const recent = n.createdAt && now() - Date.parse(n.createdAt) < RECENT_MS;
          return recent ? 1 : 0.15;
        }
        return 1;
      };
      // edges
      if (k >= LOD.farK) {
        for (const l of s.links) {
          const a = l.source as SimNode, b = l.target as SimNode;
          const lit = focusSet && (a.id === s.focusId || b.id === s.focusId);
          ctx.globalAlpha = focusSet
            ? (lit ? ANIM.focusEdgeAlpha : 0.05)
            : ANIM.edgeAlpha * Math.min(lensAlpha(a), lensAlpha(b));
          ctx.strokeStyle = lit ? '#b9aefc' : '#8a8aa3';
          ctx.lineWidth = (lit ? 1.4 : 1) / k;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      // nodes
      for (const n of s.nodes) {
        const r0 = nodeRadius(n.degree);
        if (k < LOD.farK && r0 < LOD.farNodeR) continue;
        const enter = Math.min(1, (now() - n.entered) / ANIM.entranceMs);
        const r = r0 * (0.3 + 0.7 * enter);
        const dimmed = focusSet && !focusSet.has(n.id);
        ctx.globalAlpha = (dimmed ? ANIM.dimAlpha : 1) * lensAlpha(n) * enter;
        const color = TYPE_COLOR[n.type];
        if (n.id === s.hoverId || n.id === s.focusId || n.id === s.pulseId) {
          const pulse = n.id === s.pulseId ? 1 + 0.25 * Math.sin(now() / 180) : 1;
          ctx.beginPath(); ctx.arc(n.x, n.y, (r + 7) * pulse, 0, 7);
          ctx.fillStyle = color + '30'; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7);
        if (TYPE_RING.has(n.type)) {
          ctx.strokeStyle = color; ctx.lineWidth = 2 / k;
          ctx.fillStyle = '#0c0c15'; ctx.fill(); ctx.stroke();
        } else { ctx.fillStyle = color; ctx.fill(); }
        // activity glow
        if (s.lens === 'activity' && n.createdAt && now() - Date.parse(n.createdAt) < RECENT_MS) {
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 4, 0, 7);
          ctx.strokeStyle = color + '66'; ctx.lineWidth = 3 / k; ctx.stroke();
        }
        // labels per LOD
        const labeled = k > LOD.detailK
          || (k >= LOD.farK && r0 >= LOD.majorLabelR)
          || n.id === s.hoverId || n.id === s.focusId
          || (focusSet?.has(n.id) ?? false);
        if (labeled && !dimmed) {
          ctx.fillStyle = '#e9e9f4';
          ctx.font = `${n.id === s.focusId ? '600 ' : ''}${11 / k}px -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(n.label, n.x, n.y - r - 7 / k);
        }
      }
      // far mode: constellation type words at cluster centroids
      if (k < LOD.farK) {
        const groups = new Map<string, { x: number; y: number; c: number; color: string; word: string }>();
        for (const n of s.nodes) {
          const key = CONTENT_TYPES.has(n.type) ? (n.type === 'topic' ? 'Topics' : 'Product')
            : LEAD_TYPES.has(n.type) ? 'Pipeline' : 'Other';
          const g = groups.get(key) ?? { x: 0, y: 0, c: 0, color: TYPE_COLOR[n.type], word: key };
          g.x += n.x; g.y += n.y; g.c += 1;
          groups.set(key, g);
        }
        for (const g of groups.values()) {
          if (g.c < 2) continue;
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = g.color;
          ctx.font = `${13 / k}px -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(g.word, g.x / g.c, g.y / g.c);
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); s.sim?.stop(); };
  }, [onClearFocus, onSelectNode, zoomBehavior]);

  return <canvas ref={canvasRef} className="h-full w-full touch-none" style={{ background: '#0c0c15' }} />;
});
```

- [ ] **Step 2: Build to typecheck, commit**

Run: `pnpm --filter @content-automation/unified-app build` — Expected: green (component unused yet). Fix type errors strictly (d3 typings are picky; the `flyTo` transition cast is the documented d3-zoom + canvas selection pattern — if the transition typing fights, fall back to `zoomBehavior.transform(select(canvas) as never, t)` without the tween; the tween is polish, not contract).

```bash
git add packages/atlas/components/BrainCanvas.tsx
git commit -m "feat(atlas): BrainCanvas — d3-force physics, zoom LOD, drag/hover/focus on canvas"
```

---

### Task 5: BrainView + page — fetch, hop, trail, lenses

**Files:**
- Create: `packages/atlas/components/BrainView.tsx`
- Create: `apps/unified/app/brain/page.tsx`

**Interfaces:**
- Consumes: `BrainCanvas` handle (Task 4), API routes (Task 3), `Inspector` + `CommandBar` (Tasks 6–7 — imported here; Task 5 ships with placeholder-free minimal versions inline? **No** — Task 5 builds the view with the real components' props already wired but renders them only when the files exist; to keep every task green, Task 5 creates the view WITHOUT Inspector/CommandBar and Tasks 6–7 add them. The view compiles and works standalone: overview, hop, trail, lenses).
- Produces: `BrainView` client component; `/brain` page; `refreshNeighborhood(id)` callback shape used by Task 6: `(id: string) => Promise<void>`.

- [ ] **Step 1: Write the view**

`packages/atlas/components/BrainView.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrainGraph, BrainNode } from '../types';
import { BrainCanvas, type BrainCanvasHandle } from './BrainCanvas';

type Lens = 'everything' | 'content' | 'leads' | 'activity';
const LENSES: Lens[] = ['everything', 'content', 'leads', 'activity'];
const LENS_LABEL: Record<Lens, string> = {
  everything: 'Everything', content: 'Content', leads: 'Leads', activity: 'Activity',
};

export function BrainView() {
  const canvas = useRef<BrainCanvasHandle>(null);
  const [selected, setSelected] = useState<BrainNode | null>(null);
  const [trail, setTrail] = useState<BrainNode[]>([]);
  const [lens, setLensState] = useState<Lens>('everything');
  const [loading, setLoading] = useState(true);
  const loadedNeighborhoods = useRef(new Set<string>());

  useEffect(() => {
    fetch('/api/brain/overview')
      .then((r) => r.json())
      .then((g: BrainGraph) => canvas.current?.setGraph(g))
      .finally(() => setLoading(false));
  }, []);

  const refreshNeighborhood = useCallback(async (id: string) => {
    const g: BrainGraph = await fetch(`/api/brain/neighborhood/${encodeURIComponent(id)}`).then((r) => r.json());
    canvas.current?.mergeGraph(g, id);
    loadedNeighborhoods.current.add(id);
  }, []);

  const handleSelect = useCallback((node: BrainNode) => {
    setSelected(node);
    canvas.current?.focus(node.id);
    setTrail((t) => (t[t.length - 1]?.id === node.id ? t : [...t.slice(-7), node]));
    if (!loadedNeighborhoods.current.has(node.id)) void refreshNeighborhood(node.id);
  }, [refreshNeighborhood]);

  const handleClear = useCallback(() => {
    setSelected(null);
    canvas.current?.focus(null);
  }, []);

  const handleBack = useCallback(() => {
    setTrail((t) => {
      const next = t.slice(0, -1);
      const prev = next[next.length - 1];
      if (prev) { canvas.current?.flyTo(prev.id); setSelected(prev); }
      else handleClear();
      return next;
    });
  }, [handleClear]);

  const setLens = (l: Lens) => { setLensState(l); canvas.current?.setLens(l); };

  return (
    <div className="relative h-[calc(100vh-0px)] w-full overflow-hidden bg-[#0c0c15]">
      <BrainCanvas ref={canvas} onSelectNode={handleSelect} onClearFocus={handleClear} />

      {/* trail */}
      {trail.length > 0 && (
        <div className="absolute left-4 top-4 flex max-w-[60%] items-center gap-1 rounded-lg border border-border/50 bg-background/80 px-3 py-1.5 text-xs backdrop-blur">
          {trail.map((n, i) => (
            <span key={`${n.id}-${i}`} className="flex items-center gap-1 whitespace-nowrap">
              {i > 0 && <span className="text-muted-foreground">›</span>}
              <button
                className={i === trail.length - 1 ? 'font-semibold' : 'text-muted-foreground hover:text-foreground'}
                onClick={() => { canvas.current?.flyTo(n.id); setSelected(n); }}
              >
                {n.label}
              </button>
            </span>
          ))}
          <button className="ml-2 text-primary hover:underline" onClick={handleBack}>← back</button>
        </div>
      )}

      {/* lenses */}
      <div className="absolute right-4 top-4 flex gap-1.5">
        {LENSES.map((l) => (
          <button
            key={l}
            onClick={() => setLens(l)}
            className={`rounded-full border px-3 py-1 font-mono text-[11px] backdrop-blur transition-colors ${
              lens === l
                ? 'border-primary/60 bg-primary/15 text-foreground'
                : 'border-border/50 bg-background/70 text-muted-foreground hover:text-foreground'
            }`}
          >
            {LENS_LABEL[l]}
          </button>
        ))}
      </div>

      {loading && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          waking the brain…
        </div>
      )}
    </div>
  );
}
```

`apps/unified/app/brain/page.tsx`:

```tsx
import { BrainView } from '@/packages/atlas/components/BrainView';

export const metadata = { title: 'Brain' };

export default function BrainPage() {
  return <BrainView />;
}
```

Layout note: the unified app's authenticated layout wraps pages with the sidebar — the Brain page must fill the content area edge-to-edge. Read the layout the sibling pages use (`apps/unified/app/` root layout chain); if content is padded by default, the Brain page's own container already compensates with full-bleed height; adjust the height calc to the layout's actual header offset if one exists.

- [ ] **Step 2: Build + live check, commit**

Run: `pnpm --filter @content-automation/unified-app build` — Expected: green.
Live: with the local server running, open `/brain` — Expected: the constellation paints from real data; drag works; click focuses + blooms (fetches neighborhood); trail grows; lenses restyle; empty-canvas click clears.

```bash
git add packages/atlas/components/BrainView.tsx apps/unified/app/brain
git commit -m "feat(atlas): BrainView + /brain page — overview, hop, trail, lenses"
```

---

### Task 6: Inspector — typed cards with streaming actions

**Files:**
- Create: `packages/atlas/components/Inspector.tsx`
- Modify: `packages/atlas/components/BrainView.tsx` (mount Inspector; pass `refreshNeighborhood`, `setPulse`)

**Interfaces:**
- Consumes: `useActionStream` from `@/hooks/use-action-stream` (exists; returns `{ start, partial, final, reasoning, error, isStreaming }`); existing stream routes: `/api/content/projects/:id/ingest/stream`, `/api/content/generate-ideas/stream`, `/api/content/ideas/:id/refine/stream`, `/api/content/ideas/:id/draft/stream` (body `{contentType}`), `/api/outreach/leads/:id/qualify/stream`.
- Produces: `<Inspector node={BrainNode} onDone={(id)=>void} onPulse={(id|null)=>void} onClose={()=>void} />`.

- [ ] **Step 1: Write the inspector**

`packages/atlas/components/Inspector.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useActionStream } from '@/hooks/use-action-stream';
import type { BrainNode } from '../types';
import { TYPE_COLOR, TYPE_WORD } from '../palette';

const DRAFT_TYPES = [
  ['blog_post', 'Blog post'], ['tweet_thread', 'Tweet thread'],
  ['linkedin_post', 'LinkedIn post'], ['video_script', 'Video script'],
] as const;

type StreamAction = { label: string; api: string; body?: Record<string, unknown> };

function actionsFor(node: BrainNode): { streams: StreamAction[]; open: string | null } {
  switch (node.type) {
    case 'project':
      return {
        streams: [{ label: 'Re-extract capabilities', api: `/api/content/projects/${node.id}/ingest/stream` }],
        open: `/content/projects/${node.id}`,
      };
    case 'topic':
      return {
        streams: [{ label: 'Generate ideas', api: '/api/content/generate-ideas/stream', body: { count: 5 } }],
        open: '/content/topics',
      };
    case 'idea':
      return {
        streams: node.meta.status === 'refined'
          ? [] // drafts handled by the picker below
          : [{ label: 'Refine', api: `/api/content/ideas/${node.id}/refine/stream` }],
        open: `/content/ideas/${node.id}`,
      };
    case 'lead':
      return {
        streams: [{ label: 'Re-qualify', api: `/api/outreach/leads/${node.id}/qualify/stream` }],
        open: `/outreach/leads/${node.id}`,
      };
    case 'draft':
      return { streams: [], open: node.meta.ideaId ? `/content/ideas/${node.meta.ideaId}` : '/content' };
    case 'persona':
      return { streams: [], open: '/outreach/leads' };
    case 'capability':
      return { streams: [], open: null };
    default:
      return { streams: [], open: null };
  }
}

function subtitle(node: BrainNode): string {
  const m = node.meta;
  switch (node.type) {
    case 'lead': return [m.title, m.company && `@ ${m.company}`, m.status].filter(Boolean).join(' · ');
    case 'idea': return [m.status, m.priority && `${m.priority} priority`].filter(Boolean).join(' · ');
    case 'draft': return [m.type, m.status].filter(Boolean).join(' · ');
    case 'topic': return String(m.status ?? '');
    case 'project': return m.processed === 'true' ? 'processed' : 'not processed yet';
    case 'qualification': return m.matchedPersonaName ? `matched ${m.matchedPersonaName}` : '';
    default: return '';
  }
}

export function Inspector({ node, onDone, onPulse, onClose }: {
  node: BrainNode;
  onDone: (id: string) => void;
  onPulse: (id: string | null) => void;
  onClose: () => void;
}) {
  const { streams, open } = useMemo(() => actionsFor(node), [node]);
  const [active, setActive] = useState<StreamAction | null>(null);
  const stream = useActionStream({ api: active?.api ?? '/api/brain/overview' });

  useEffect(() => { setActive(null); }, [node.id]);
  useEffect(() => { onPulse(stream.isStreaming ? node.id : null); }, [stream.isStreaming, node.id, onPulse]);
  useEffect(() => {
    if (stream.final) { onDone(node.id); setActive(null); }
  }, [stream.final, node.id, onDone]);

  const run = (a: StreamAction) => { setActive(a); };
  useEffect(() => {
    if (active) stream.start(active.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per action selection
  }, [active]);

  const color = TYPE_COLOR[node.type];
  return (
    <div className="absolute right-4 top-16 w-72 rounded-xl border border-border/60 bg-background/90 p-4 backdrop-blur">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color }}>
          {TYPE_WORD[node.type]}
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <div className="mb-1 text-[15px] font-semibold leading-snug">{node.label}</div>
      <div className="mb-3 text-xs text-muted-foreground">{subtitle(node)}</div>

      {node.type === 'qualification' && node.meta.score !== null && (
        <div className="mb-3 text-2xl font-bold tabular-nums">{node.meta.score}<span className="text-sm text-muted-foreground">/100</span></div>
      )}

      {stream.isStreaming && (
        <div className="mb-3 truncate rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
          {stream.reasoning ? stream.reasoning.slice(-90) : 'working…'}
        </div>
      )}
      {stream.error && <div className="mb-3 text-xs text-destructive">{stream.error}</div>}

      <div className="flex flex-wrap gap-1.5">
        {streams.map((a) => (
          <button
            key={a.label}
            disabled={stream.isStreaming}
            onClick={() => run(a)}
            className="rounded-lg border border-primary/50 bg-primary/15 px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/25 disabled:opacity-50"
          >
            {a.label}
          </button>
        ))}
        {node.type === 'idea' && node.meta.status === 'refined' && (
          <select
            disabled={stream.isStreaming}
            className="rounded-lg border border-primary/50 bg-primary/15 px-2 py-1.5 text-xs"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) run({ label: 'Draft', api: `/api/content/ideas/${node.id}/draft/stream`, body: { contentType: e.target.value } });
            }}
          >
            <option value="" disabled>Draft as…</option>
            {DRAFT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        {open && (
          <a href={open} className="rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs hover:bg-muted/70">
            Open
          </a>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount in BrainView**

In `packages/atlas/components/BrainView.tsx`: import `Inspector`; render below the lens row:

```tsx
{selected && (
  <Inspector
    node={selected}
    onClose={handleClear}
    onPulse={(id) => canvas.current?.setPulse(id)}
    onDone={(id) => { void refreshNeighborhood(id); }}
  />
)}
```

- [ ] **Step 3: Build + live verify, commit**

Build green; live: click a refined idea → Draft as… Tweet thread → reasoning line in the card, focus node pulses, on finish new draft node blooms into the map. Click a lead → Re-qualify → same, and the qualification satellite updates on merge.

```bash
git add packages/atlas/components
git commit -m "feat(atlas): typed inspector cards with streaming agent actions"
```

---

### Task 7: CommandBar (⌘K search + add-a-lead) and nav

**Files:**
- Create: `packages/atlas/components/CommandBar.tsx`
- Modify: `packages/atlas/components/BrainView.tsx` (mount)
- Modify: the unified sidebar nav (locate: `grep -rn "Overview" apps/unified packages/ui --include='*.tsx' -l` — the file rendering the sidebar nav items; add a "Brain" item pointing to `/brain` ABOVE Overview, using the existing nav-item markup with a `Sparkles` or `Network` icon from lucide-react, matching neighbors' import style)

**Interfaces:**
- Consumes: `/api/brain/search`; existing `POST /api/outreach/leads` (READ the route first — `grep -rn "POST" apps/outreach/app/api/outreach/leads/route.ts` — and use its exact body field names for name/company/title; the Add-lead modal in the leads page is the reference client).
- Produces: `<CommandBar onPick={(id)=>void} onLeadAdded={(id)=>void} />`.

- [ ] **Step 1: Write the command bar**

`packages/atlas/components/CommandBar.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrainSearchResult } from '../types';
import { TYPE_COLOR } from '../palette';

/** Parse "+ Name[, Title][ @ Company]" → lead fields. */
export function parseAddLead(input: string): { name: string; title?: string; company?: string } | null {
  const m = input.replace(/^\+\s*/, '').trim();
  if (!m) return null;
  const [beforeAt, company] = m.split('@').map((s) => s.trim());
  const [name, title] = beforeAt.split(',').map((s) => s.trim());
  if (!name) return null;
  return { name, title: title || undefined, company: company || undefined };
}

export function CommandBar({ onPick, onLeadAdded }: {
  onPick: (id: string) => void;
  onLeadAdded: (id: string) => void;
}) {
  const [openBar, setOpenBar] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<BrainSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isAdd = q.startsWith('+');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setOpenBar(true); setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (e.key === 'Escape') { setOpenBar(false); setQ(''); setResults([]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (isAdd || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/brain/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setResults(d.results ?? []))
        .catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q, isAdd]);

  const submitAdd = useCallback(async () => {
    const lead = parseAddLead(q);
    if (!lead) return;
    setBusy(true);
    try {
      // Body field names verified against the existing leads POST route.
      const res = await fetch('/api/outreach/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead),
      });
      const data = await res.json();
      const id = data?.id ?? data?.lead?.id;
      if (id) { onLeadAdded(String(id)); setOpenBar(false); setQ(''); }
    } finally { setBusy(false); }
  }, [q, onLeadAdded]);

  if (!openBar) {
    return (
      <button
        onClick={() => { setOpenBar(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        className="absolute left-1/2 top-4 -translate-x-1/2 rounded-lg border border-border/50 bg-background/80 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur hover:text-foreground"
      >
        ⌘K — find anything · “+ name” to add a lead
      </button>
    );
  }

  return (
    <div className="absolute left-1/2 top-4 w-[420px] max-w-[90%] -translate-x-1/2 rounded-xl border border-border/60 bg-background/95 p-2 backdrop-blur">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (isAdd) void submitAdd();
            else if (results[0]) { onPick(results[0].id); setOpenBar(false); setQ(''); }
          }
        }}
        placeholder="Find anything… or “+ Sarah Chen, CTO @ Linear”"
        className="w-full bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      {isAdd && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {busy ? 'adding…' : `↵ add lead ${JSON.stringify(parseAddLead(q) ?? {})}`}
        </div>
      )}
      {!isAdd && results.length > 0 && (
        <ul className="max-h-64 overflow-y-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
                onClick={() => { onPick(r.id); setOpenBar(false); setQ(''); }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[r.type] }} />
                <span>{r.label}</span>
                <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{r.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount in BrainView + wire add-to-map**

In `BrainView`, render `<CommandBar onPick={(id) => { canvas.current?.flyTo(id); }} onLeadAdded={handleLeadAdded} />` where:

```tsx
const handleLeadAdded = useCallback(async (id: string) => {
  await refreshNeighborhood(id);       // merges the new lead node
  canvas.current?.flyTo(id);           // fly + focus so its card opens
}, [refreshNeighborhood]);
```

`flyTo` calls `onSelectNode` internally (Task 4), so the inspector opens with the new lead's actions ready.

Before committing: read `apps/outreach/app/api/outreach/leads/route.ts` POST body handling and reconcile `parseAddLead`'s output keys with the route's expected field names (rename keys in `submitAdd`'s JSON if the route expects e.g. `title`/`company` differently). Also confirm the create response shape (`data.id` vs `data.lead.id`) and keep only the correct one.

- [ ] **Step 3: Nav item**

Locate the sidebar nav file (`grep -rn '"Overview"\|>Overview<' apps/unified packages/ui --include='*.tsx'`). Add a nav entry **Brain** → `/brain` directly above Overview, copying the exact item markup/icon pattern of its siblings (lucide `Network` icon). No other nav changes.

- [ ] **Step 4: Build + live verify, commit**

Build green. Live: ⌘K → type a lead's name → Enter → camera flies to it, card opens. Type `+ Test Lead, CTO @ TestCo` → Enter → node lands, focused, actions available. Nav shows Brain; clicking it opens the explorer.

```bash
git add packages/atlas/components apps/unified
git commit -m "feat(atlas): command bar — search/fly-to, add-a-lead; Brain nav item"
```

---

### Task 8: Gates, live e2e, film pass

**Files:**
- Test: full suite + manual film checklist

- [ ] **Step 1: Full gates**

Run in order: `pnpm test:atlas && pnpm test:content && pnpm test:cascade && pnpm --filter @content-automation/outreach test && pnpm test:architecture && pnpm build`
Expected: all green, `Tasks: 5 successful`.

- [ ] **Step 2: Live e2e checklist (local server, real data)**

1. `/brain` paints the overview < 1.5 s (network tab); constellation drifts.
2. Drag any node — springy follow.
3. Click Cascade project → bloom + inspector; Re-extract streams (reasoning line, pulse), finish merges nodes.
4. Hop project → topic → lead; trail shows three chips; back retraces; fly-to animates.
5. Refined idea → Draft as… tweet thread → new draft node blooms in.
6. ⌘K search "guillermo" → Enter flies to the lead. `+ Film Test, CEO @ Demo` adds and focuses.
7. Lenses: Content/Leads dim the other half; Activity glows the freshly added lead.
8. Zoom out below the far threshold → constellation words; zoom in → all labels.
9. `grep -rn "node\|edge\|label\|cypher\|query" packages/atlas/components --include='*.tsx' -i | grep -iv "// \|import\|classname\|type\|onKey"` — confirm no user-visible database vocabulary (variable names are fine; strings are not).

- [ ] **Step 3: Film pass (spec success criterion 2)**

Record 3-second clips: overview drift · a hop bloom · a draft action growing the map · an add landing. Every clip must show real motion. Tune `PHYS`/`ANIM` constants only (single file) if any clip is static.

- [ ] **Step 4: Final commit — do NOT push**

```bash
git add -A
git commit -m "feat(atlas): the Brain — gates green, film pass done"
```

Pushing deploys to production — present the branch/commits for user review first.

---

## Self-review notes

- **Spec coverage:** vocabulary table → Task 1; curation/caps/API → Tasks 2–3; drag/hover/focus/LOD/lenses/physics → Task 4; hop/trail → Task 5; typed cards + streaming actions + pulse → Task 6; ⌘K/fly-to/add/nav → Task 7; success criteria + film rule → Task 8. Excluded labels enforced in repository (`EXCLUDED`) and neighborhood query. Non-goals honored: zero write Cypher in Atlas, no agent nodes emitted, unified-only.
- **Deliberate read-first steps** (not placeholders — each names the file, the command, and what to reconcile): leads POST body/response shape (Task 7), sidebar nav file (Task 7), unified layout height offset (Task 5), `CALL ()` syntax fallback (Task 2), `test:content` shell prefix (Task 2).
- **Type consistency:** `BrainNode/BrainLink/BrainGraph/BrainSearchResult` (Task 1) used verbatim in Tasks 2–7; `BrainCanvasHandle` methods (`setGraph/mergeGraph/focus/flyTo/setLens/setPulse`) match all call sites; `useActionStream` consumed with its real production shape (`start/partial/final/reasoning/error/isStreaming`); lens union `'everything'|'content'|'leads'|'activity'` identical in Tasks 4–5.
- **Risk register:** (a) d3-zoom + manual pointer capture interplay — drag uses capture-phase `stopImmediatePropagation`, the standard pattern; if pan-vs-drag misbehaves, gate zoom's pointer filter with `zoomBehavior.filter(ev => !pick(...))`; (b) Cypher `CALL ()`/`COUNT {}` syntax pinned to Neo4j 5 with a stated fallback; (c) `useActionStream` transport is created per `api` value — the inspector instantiates it with a changing `api`; if the hook memoizes on first render only, lift to `key={active?.api}` on an inner component (one-line fix, noted here so the implementer recognizes the symptom: action fires against a stale route).
