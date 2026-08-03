# FalkorDB Local-Dev POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the platform runs against FalkorDB locally (repositories + Brain + integration tests green, app boots and serves real pages) and produce a hard verdict on migration cost — replacing the 1.2 GiB / full-core Neo4j dev container with a ~130 MiB FalkorDB one.

**Architecture:** Two-path POC. Path 1 (cheapest): keep `neo4j-driver` and connect through FalkorDB's experimental Bolt port — zero adapter code, dialect rewrites only. Path 2 (fallback if Bolt is flaky): native `falkordb` npm client behind the existing single seam (`packages/platform/data/neo4j.ts` — every repository already goes through `getSession()`), with a ~150-line result-shape adapter. Either way, the dialect work is identical and is the real migration cost being measured.

**Tech Stack:** `falkordb/falkordb:latest` docker image (RESP :6379 + Browser UI :3000, Bolt via `FALKORDB_ARGS="BOLT_PORT 7687"`), openCypher 9 dialect, optionally `falkordb@^6.6.2` npm client. POC scope is **local dev only** — production stays on the shared Neo4j; no data migration (fresh local graph).

## Global Constraints

- **POC only, this branch/worktree only** (`feat/falkordb-poc` at `../content-automation-falkordb-poc`). No push. Prod and CI stay Neo4j; nothing here may leak into main until a go/no-go decision.
- **Known dialect walls (from research, July 2026, FalkorDB v4.20.1):**
  - `datetime()` does not exist → `localdatetime()` (no-arg = now; `localdatetime($iso)` parses). `duration({days:$n})` and temporal comparisons/ordering ARE supported. Calendar (month/year) duration arithmetic is buggy upstream (#2222) — we only use `days`, safe.
  - `COUNT { pattern }` and `EXISTS { pattern }` subqueries are rejected (Neo4j-5-only syntax, upstream #2161) → use `size([(n)--(m) | m])` / pattern predicates `WHERE (n)-[:R]->()`; node degree via built-ins `indegree(n)+outdegree(n)`.
  - `CALL { ... UNION ... }` bare-branch form is unreliable → rewrite the one user (Brain overview) as sequential queries merged in TS.
  - No APOC (we use none ✓), no `=~` regex (we use none ✓), no Cypher constraints (we create none ✓).
- **Only these files may change:** `docker-compose.yml` (falkordb service), `packages/platform/data/neo4j.ts` (+ optional new `falkordb-adapter.ts` beside it), the 10 Cypher-bearing files (dialect only — no behavior changes), `.env.example`, this plan, and a findings doc. Repository function signatures are frozen.
- **Acceptance gate = the two integration suites + live app:** `pnpm test:content` (51 incl. migration-repositories) and `pnpm test:atlas` (3) green against FalkorDB, then the unified app boots locally and `/brain`, a project page, and a lead page render from FalkorDB data.
- Env switch is `NEO4J_URI` pointing at the FalkorDB Bolt port (Path 1) or a new `GRAPH_BACKEND=falkordb` + `FALKORDB_URL` (Path 2). Neo4j fallback must keep working — one env flip back.

## File Map

| File | Responsibility |
|---|---|
| `docker-compose.yml` (modify) | add `falkordb` service (profile `falkordb`), keep neo4j |
| `packages/platform/data/neo4j.ts` (modify, Path 2 only) | backend switch reading `GRAPH_BACKEND` |
| `packages/platform/data/falkordb-adapter.ts` (create, Path 2 only) | `falkordb` client wrapped in the session contract |
| 10 Cypher files (modify) | dialect rewrites, mechanical where possible |
| `docs/superpowers/plans/2026-07-21-falkordb-poc-findings.md` (create, Task 6) | the verdict deliverable |

---

### Task 1: FalkorDB container + Bolt smoke test

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add the service** (after the neo4j service, with a profile so it's opt-in):

```yaml
  falkordb:
    image: falkordb/falkordb:latest
    container_name: content-automation-falkordb
    profiles: ["falkordb"]
    ports:
      - "6379:6379"   # RESP
      - "3001:3000"   # FalkorDB Browser (3000 clashes with unified dev)
      - "7688:7687"   # experimental Bolt (7687 kept free for neo4j)
    environment:
      - FALKORDB_ARGS=BOLT_PORT 7687
    volumes:
      - falkordb_data:/data
    deploy:
      resources:
        limits:
          memory: 512M
    restart: unless-stopped
```

Add `falkordb_data:` under the top-level `volumes:` key.

- [ ] **Step 2: Boot and smoke both protocols**

Run: `docker compose --profile falkordb up -d falkordb && sleep 3 && docker exec content-automation-falkordb redis-cli GRAPH.QUERY poc "RETURN 1" && docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}' content-automation-falkordb`
Expected: a result row and idle memory well under 200 MiB.

Bolt probe (Path-1 viability, from repo root with deps installed):

```bash
npx tsx -e "
import neo4j from 'neo4j-driver';
const d = neo4j.driver('bolt://localhost:7688', neo4j.auth.basic('falkordb', ''));
const s = d.session({ database: 'poc' });
s.run('CREATE (a:T {n: 1, at: localdatetime()})-[:R]->(b:T {n: 2}) RETURN a.n AS n')
  .then(r => console.log('bolt write ok:', r.records[0].get('n')))
  .then(() => s.run('MATCH (a:T) RETURN count(a) AS c, localdatetime() AS now'))
  .then(r => console.log('count:', String(r.records[0].get('c')), 'temporal:', String(r.records[0].get('now'))))
  .catch(e => console.error('BOLT FAILED:', e.message))
  .finally(() => d.close());"
```

Expected: both lines print. Record verbatim what integer and temporal values look like through the driver (this decides how much of the repos' `.toInt()`/`.toString()` handling survives). If Bolt fails to connect/authenticate or mangles types, note it and plan for Path 2 from Task 4 on.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "poc(falkordb): opt-in falkordb service with Bolt port"
```

---

### Task 2: Mechanical dialect sweep — `datetime()` → `localdatetime()`

**Files:**
- Modify: all 10 Cypher-bearing files (~40 templates)

- [ ] **Step 1: Sweep with verification.** Across `products/content-generator/data/*.ts`, `products/outreach/data/*.ts`, `packages/platform/settings/repository.ts`, `packages/atlas/data/brain-repository.ts`, `products/content-generator/agent/knowledge-graph-tools.ts`, `apps/content-generator/app/api/content/publishing/route.ts` and the two test fixtures (`migration-repositories.test.ts`, `brain-repository.test.ts`), replace inside Cypher template strings only:
  - `datetime()` → `localdatetime()`
  - `datetime($x)` → `localdatetime($x)`
  - `datetime() - duration(` → `localdatetime() - duration(`

Then verify zero remainders: `grep -rn "datetime(" products packages apps --include='*.ts' | grep -v node_modules | grep -v localdatetime` → empty.

- [ ] **Step 2: Prove Neo4j still passes (dialect stays dual-compatible — `localdatetime()` is valid Neo4j too).**

Run: `docker start content-automation-neo4j && sleep 15 && pnpm test:content && pnpm test:atlas && docker stop content-automation-neo4j`
Expected: 51 + 3 green. This sweep is the one dialect change that could merge to main regardless of the POC verdict.

- [ ] **Step 3: Commit** — `git commit -am "poc(falkordb): localdatetime() dialect (valid on both engines)"`

---

### Task 3: Real rewrites — the Neo4j-5-only queries

**Files:**
- Modify: `packages/atlas/data/brain-repository.ts` (all four queries)

- [ ] **Step 1: Rewrite `fetchOverview`** — replace the 10-branch `CALL { ... UNION ... }` with sequential per-category `session.run` calls (Project / active Topic / Lead / active Persona / ContentIdea / ContentDraft / lead satellites / curated capabilities / 25 recent ResearchItems / enabled Sources), concatenating rows in TS and deduping by id (the existing `dedupeGraph` already handles it). Replace `COUNT { (n)--() }` with `indegree(n) + outdegree(n) AS degree` and the capability filter with:

```cypher
MATCH (n) WHERE (n:Framework OR n:Database OR n:Cloud OR n:Language
  OR n:AIComponent OR n:Feature OR n:Integration OR n:BusinessValue)
  AND (indegree(n) + outdegree(n) >= 2 OR (:Topic)-[:DERIVED_FROM]->(n))
RETURN properties(n) AS props, labels(n) AS labels, indegree(n) + outdegree(n) AS degree
```

(pattern predicate replaces `EXISTS {}`). Ten small queries on one session ≈ the same latency class locally.

- [ ] **Step 2: Rewrite `fetchNeighborhood` and `searchNodes`** the same way: `COUNT { (c)--() }` → `indegree(c) + outdegree(c)`; keep `collect({...})` (supported) but compute neighbor degrees with the same built-ins; everything else (coalesce, startNode/endNode, type, labels, properties, toLower/CONTAINS) is supported as-is.

- [ ] **Step 3: Dual-compat check.** `indegree()`/`outdegree()` do NOT exist on Neo4j — so unlike Task 2 this file becomes engine-specific. Gate the two variants on the backend env (`const DEGREE = process.env.GRAPH_BACKEND === 'falkordb' ? 'indegree(n) + outdegree(n)' : 'COUNT { (n)--() }'` interpolated) OR use the portable `size([(n)--(m) | m])` on both engines if FalkorDB accepts it — try portable first, verify on both, fall back to the env gate.

- [ ] **Step 4: Neo4j regression + commit.** `pnpm test:atlas` against Neo4j still green (start/stop the container as in Task 2), then `git commit -am "poc(falkordb): brain queries in openCypher-9 form"`.

---

### Task 4: Connect the app — Path 1, else Path 2

- [ ] **Step 1 (Path 1 — Bolt):** with the Task-1 Bolt probe green: `NEO4J_URI=bolt://localhost:7688 pnpm test:atlas` then `NEO4J_URI=bolt://localhost:7688 POSTGRES_HOST=localhost pnpm --filter @content-automation/content-generator test`.
Expected: failures now are *dialect or type-shape* findings, not connection errors. Fix what's mechanical (e.g. `.toInt()` vs plain numbers via the existing duck-type patterns); log every fix in the findings doc. If Bolt itself proves unstable (drops, wrong types, auth), abandon Path 1 — record why — and do Step 2.

- [ ] **Step 2 (Path 2 — native adapter, only if needed):** `pnpm add -w falkordb@^6.6.2`; create `packages/platform/data/falkordb-adapter.ts` exporting the seam contract (`run(cypher, params)` → `{ records: [{ get(name) }] }`, `close()`), wrapping: GraphNode → `{ properties }`, numbers → `IntLike { toInt(); toNumber(); valueOf() }`, temporal strings pass through (`.toString()` is native). Switch `getSession()` on `GRAPH_BACKEND=falkordb` + `FALKORDB_URL=redis://localhost:6379` + `FALKORDB_GRAPH=content`. Re-run the same suites.

- [ ] **Step 3: Commit** whichever path landed.

---

### Task 5: Live app on FalkorDB

- [ ] **Step 1: Seed a minimal graph** (script or by clicking through the app): create a project via UI → entity extraction writes through the new backend; generate topics; add a lead.
- [ ] **Step 2: Boot and verify.** Build + start unified with the FalkorDB env; verify `/brain` (overview + hop + inspector), `/content/projects/[id]` (entities), `/outreach/leads` (+ lead page) all render. Record memory: `docker stats --no-stream` for falkordb vs the old neo4j numbers (1.2 GiB / 99% CPU baseline).
- [ ] **Step 3: Commit** any fixes found.

---

### Task 6: Findings + verdict (the actual deliverable)

- [ ] **Step 1: Write `docs/superpowers/plans/2026-07-21-falkordb-poc-findings.md`:** table of every change made (file, kind: mechanical/rewrite/adapter, dual-engine safe? yes/no); Path 1 vs Path 2 outcome; suite results; memory/startup numbers side by side; upstream bugs hit; the go/no-go recommendation with the exact migration cost (files touched, engine-specific forks needed, CI implications — CI would swap its neo4j:5 service for falkordb, prod unaffected).
- [ ] **Step 2: Full gates one last time on BOTH engines** (env flip), commit, report back for review. Do NOT push.

## Self-review notes

- Effort shape from the research: 125 Cypher call sites, but only **two real cost centers** — the ubiquitous-but-mechanical `datetime()` sweep (dual-engine safe) and the four Brain queries (the only Neo4j-5 syntax in the repo). Zero transactions, zero APOC/GDS, zero Cypher indexes, one driver seam with two direct-driver files. That is an unusually migration-friendly codebase.
- Risks named with fallbacks: experimental Bolt (→ native adapter), `size([...])` portability (→ env-gated degree expression), falkordb-ts result hydration shape (→ adapter owns it), upstream CALL{}-write bugs (avoided entirely — we never write inside CALL{}).
- Out of scope, deliberately: prod migration, data migration, CI switch, Mastra memory (Postgres, unaffected), cascade (Postgres-only, unaffected).
