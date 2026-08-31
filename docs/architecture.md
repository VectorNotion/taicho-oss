# Platform architecture

Taicho (cloud.taicho.ai) is one product built from three layers: a **monorepo** that separates domain logic from UI shells, a **single unified Next.js app** that mounts everything, and dedicated long-running workers that execute sending, publishing, and MCP operations. Runtime state lives in two databases with a hard rule about which kind of data goes where; attributed operational telemetry goes to Datadog and AI telemetry goes to Langfuse.

## 1. The monorepo (pnpm + Turborepo)

```
content-automation/
├── apps/
│   ├── unified/             ← THE deployed app (cloud.taicho.ai)
│   ├── content-generator/   ← standalone shell for the Content product (dev convenience)
│   └── outreach/            ← standalone shell for the Outreach product (dev convenience)
├── products/                ← domain logic, no UI framework coupling
│   ├── content-generator/   ← ideas/drafts/research/topics (graph) + publishing engine (Postgres)
│   ├── outreach/            ← leads, qualification, outreach messages (graph)
│   └── cascade/             ← "Nurture": people lists and text emails (Postgres)
└── packages/                ← shared foundations
    ├── auth/                ← Better Auth + org entitlements + role permissions
    ├── ui/                  ← the design system (shadcn/tokens, docs/design-language.md) + genui streaming kit
    ├── knowledge/           ← shared registry, evidence graph, extraction and query contract
    ├── atlas/               ← the Brain knowledge explorer (/brain) over the graph
    ├── platform/            ← shared data access (workspace Contacts/Content, graph session, jobs)
    ├── observability/       ← execution attribution, ledger, privacy filters, Datadog + Langfuse exporters
    └── config/              ← shared configuration
```

**The rule that makes it hang together:** `products/*` packages contain
product engines, repositories, and agents. Workspace-owned context does not
live in a product package: canonical Contacts and Content are exposed through
`packages/platform/workspace/*`. `apps/unified` owns their dashboard pages and
APIs. The standalone apps remain product-development shells.

### 1.1 Shared knowledge registry

Every mounted module contributes its knowledge types, relationships, extraction
profiles, read projections, and existing capability references through one
versioned manifest. The dashboard compiles those manifests into a shared
registry before serving traffic or running workers. Every authorized module can
inspect that registry and query the same organization-scoped canonical
knowledge through the shared knowledge API.

In one line: modules describe their vocabulary to the shared registry, research
becomes evidence-backed canonical knowledge, and every authorized module or
agent reads that same knowledge to assess, generate, and explain its work.

Modules may add roles and meaning around canonical entities, but they may not
create private semantic stores that other authorized processes cannot discover.
The owner never administers graph schema: module developers resolve vocabulary
overlap as reuse, extension, equivalence, or an explicitly distinct namespaced
concept. Models can propose entities, claims, and relationships only from the
active registry slice; they cannot create graph types or emit persistence
queries.

The knowledge registry is distinct from the existing capability registry. The
knowledge registry describes what concepts and projections exist; the
capability registry remains the sole authority for what a caller may execute.
Module manifests reference capability IDs rather than duplicating capability
authorization or implementation. See the approved
[shared knowledge registry design](superpowers/specs/2026-08-19-shared-knowledge-registry-design.md)
and its [implementation plan](superpowers/plans/2026-08-19-shared-knowledge-registry.md).

Transactional modules contribute through a durable internal outbox: after the
module record commits, it appends a replay-safe `knowledge.*` product event.
The worker reloads that event under the owning tenant, runs the module's graph
adapter, and records a projection receipt only after success. This is how
Contacts, transcripts, Cascade, Intelligence, Support, Resonance, publishing,
and performance feedback become shared knowledge without making FalkorDB the
execution queue.

### 1.2 Shared calendar registry

Every capability module contributes a versioned calendar manifest and names
the single authorized read capability, `calendar.events.list`. A module must
also declare whether it owns user-visible scheduled work: owners provide one
or more namespaced event kinds, while non-owners provide an explicit reason
and cannot declare events. This makes calendar participation mandatory without
inventing schedules for modules such as Nurture, Brain, Chat, or Resonance.

The owning module remains the source of truth and emits replay-safe
`calendar.entry.changed` events for every lifecycle transition. The capability
worker projects those events into the tenant-scoped `calendar_entries` read
model; source snapshots repair legacy records or missed emissions. Calendar,
Today, REST, MCP, and agents all read that same authorized projection, and
calendar actions call the owning module's registered capability instead of
changing source records directly. Future provider-sync adapters consume this
same event boundary rather than introducing a second scheduling model.

## 2. One app, three products, one gate

The unified app serves the sidebar shell and all pages. Its API routes do **not** call product services over HTTP — they import the product packages directly (`@content-automation/cascade`, `.../publishing/*`) and hit their repositories. There is no internal service mesh or RPC layer: the function call is the API.

Authorization is one funnel: every request passes through
`apps/unified/proxy.ts` → `packages/auth` — Better Auth session → organization
→ entitlements → role actions. Product routes use `permissionForRequest`.
Workspace routes combine the relevant product capabilities at the route
boundary because Contacts and Content serve more than one product.

The unified app also serves the **Brain** (`/brain`, package `packages/atlas`),
a read-only force-directed knowledge explorer over the workspace graph. The
Brain is the human presentation layer; modules and agents use the shared
registry, query, coverage, and explanation contracts. Every AI action streams
through the generative-UI kit (`packages/ui/components/genui`, kernel
`packages/platform/agents/streaming.ts`) beside the authoritative `jobs` table.

`packages/resonance` and `packages/intelligence` are platform services: packages
that own domain logic, clients, and components consumed through thin
`apps/unified` route shells. Resonance scores creative variants against a
synthetic audience by reading next-token Yes/No probabilities from a small model
instead of generating text. The actual GPU scoring runs in
`services/resonance/`, a Python service deployed to Modal. The platform reaches
it only through signed outbound HTTP (trigger, then poll-on-read for the result),
never an inbound call.

## 3. The engines (where work actually happens)

The runtime processes use Postgres poll loops with `SELECT … FOR UPDATE SKIP LOCKED` as the queue — no Redis, no job library, safe for N concurrent workers:

| Worker | What it does | Surface |
|---|---|---|
| **unified** (Next.js, :3003) | UI + API routes | behind nginx at cloud.taicho.ai |
| **publishing worker** | token-refresh heartbeat (never publish on a dead OAuth token) + publish loop through destination adapters (YouTube, X, LinkedIn, Instagram, CMS, signed webhook) | none public; writes results back onto drafts in-process |
| **MCP operation worker** | durable MCP tools and asynchronous AI operations | none public; MCP protocol traffic enters through `/api/mcp` |

Content and Outreach agents resolve through OpenRouter + Qwen. Cascade is plain CRUD and has no model, workflow, template, scheduler, worker, or delivery layer.

## 4. Data: two stores, one rule

- **FalkorDB** — the knowledge graph: workspace Contacts and Content plus
  product-specific roles, research, topics, and activity. A person has one
  `Contact` identity; `Lead` and `NurtureContact` are role projections.
- **Postgres** — the transactional runtime: one instance with product-owned schemas — `auth` tables (Better Auth + entitlements), `cascade` (funnels, memberships, plain-text emails), `publishing` (channels, posts), jobs, MCP operations, and the `observability.execution_event` support ledger. The "what we're doing" store.

The rule: **durable engines execute from Postgres; the graph never owns job
locks, schedules, retries, idempotency, or external delivery.** Intelligence and
generation workflows may query the graph to assemble an authorized context
bundle before committing an assessment or artifact. Delivery workers execute
from committed Postgres work records and frozen inputs, never from mutable graph
state. Where the stores meet, the engine bridges through an explicit product
boundary — the UI never sees the seam.

External stores/services: **Cloudflare R2** (media staging for publishing),
customer-operated **n8n** (external email orchestration), the four **social platform APIs** (behind
destination adapters), **OpenRouter** (agents only), **Datadog Cloud**
(operational telemetry), and **Langfuse Cloud** (privacy-filtered AI
telemetry). Cascade stores no email-provider credentials.

## 5. Infrastructure (graph-server, 77.42.45.165)

```
Cloudflare DNS (cloud.taicho.ai → 77.42.45.165)
        │
   nginx (TLS via certbot)
   └── all application traffic ────► unified next :3003    (docker)

                                     content-worker         (docker, no port)
                                     mcp-worker             (docker, no port)
                                     pricing-worker         (docker, no port)
        │                                    │
   ┌────┴─────────────┬──────────────────────┴──────┐
   │ Postgres 16      │ FalkorDB (docker,           │  R2 (Cloudflare)
   │ (docker,         │ falkordb:6379 on the        │  social APIs
   │ localhost:15432) │ compose net — content graph)│  Email providers / OpenRouter
   └──────────────────┴─────────────────────────────┘
```

- Runs as a **Docker Compose stack** (`docker-compose.prod.yml`, project `content-automation`): `postgres`, `unified`, `content-worker`, `mcp-worker`, `pricing-worker`, `falkordb`, `datadog-agent`, and `watchtower`. Env from `/root/content-automation/.env` (chmod 600). See `docs/deployment.md`.
- **Deploy**: push to GitHub main → CI (`.github/workflows/docker.yml`) tests, builds only the changed images, pushes them to `registry.vectornotion.com`; watchtower polls every 5 min and restarts the affected containers. Each container migrates its own Postgres schemas on boot. **Production deploys require owner review first.**
- **Graph backend**: FalkorDB is the sole runtime graph store (`docs/graph-backend.md`).
- **Observability**: every request, operation and durable worker attempt carries request/execution/parent IDs plus authoritative organization and actor attribution. Cloud telemetry is metadata-only; the raw tenant lookup remains in Postgres. See `docs/observability.md`.
- The legacy **Python Relay** container still runs in parallel (its channels are migrated; it winds down once the MCP shorts workflow has an equivalent).

## 6. The product loop the architecture serves

```
Content (make it) ──publish──► the world (YouTube/X/LinkedIn/IG/CMS)
     ▲                              │ audience responds
     │ performance                  ▼
  Nurture (organize people and copy) ◄──qualify── Outreach (capture leads)
     └── external n8n automation owns email delivery and outcomes
```

Each product owns one verb; the engines make the verbs run unattended; the unified app is the single pane of glass over all of it.

The dashboard is also the shared context plane: Outreach and Nurture consume
the same Contacts, while Content, Outreach, and Nurture consume the same
workspace Content library. Product packages may add projections or snapshots,
but may not become the canonical owner of shared people or content.
