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
│   └── cascade/             ← "Nurture": email funnel engine (Postgres)
└── packages/                ← shared foundations
    ├── auth/                ← Better Auth + org entitlements + role permissions
    ├── ui/                  ← the design system (shadcn/tokens, docs/design-language.md) + genui streaming kit
    ├── atlas/              ← the Brain knowledge explorer (/brain) over the graph
    ├── platform/            ← shared data access (workspace Contacts/Content, graph session, jobs)
    ├── observability/       ← execution attribution, ledger, privacy filters, Datadog + Langfuse exporters
    └── config/              ← shared configuration
```

**The rule that makes it hang together:** `products/*` packages contain
product engines, repositories, and agents. Workspace-owned context does not
live in a product package: canonical Contacts and Content are exposed through
`packages/platform/workspace/*`. `apps/unified` owns their dashboard pages and
APIs. The standalone apps remain product-development shells.

## 2. One app, three products, one gate

The unified app serves the sidebar shell and all pages. Its API routes do **not** call product services over HTTP — they import the product packages directly (`@content-automation/cascade`, `.../publishing/*`) and hit the databases through the same repositories the workers use. There is no internal service mesh, no RPC layer: the function call is the API.

Authorization is one funnel: every request passes through
`apps/unified/proxy.ts` → `packages/auth` — Better Auth session → organization
→ entitlements → role actions. Product routes use `permissionForRequest`.
Workspace routes combine the relevant product capabilities at the route
boundary because Contacts and Content serve more than one product.

The unified app also serves the **Brain** (`/brain`, package `packages/atlas`) — a force-directed knowledge explorer over the graph — and every AI action streams through the generative-UI kit (`packages/ui/components/genui`, kernel `packages/platform/agents/streaming.ts`) beside the authoritative `jobs` table.

`packages/resonance` is a platform service in the same shape as `packages/atlas` (the Brain) and `packages/intelligence` (the thin chat dispatcher): a package that owns domain logic, a client, and components, consumed through thin `apps/unified` route shells. It scores creative variants against a synthetic audience by reading next-token Yes/No probabilities from a small model instead of generating text. The actual GPU scoring runs in `services/resonance/`, a Python service deployed to Modal. The platform reaches it only through signed outbound HTTP (trigger, then poll-on-read for the result), never an inbound call.

## 3. The engines (where work actually happens)

The runtime processes use Postgres poll loops with `SELECT … FOR UPDATE SKIP LOCKED` as the queue — no Redis, no job library, safe for N concurrent workers:

| Worker | What it does | Surface |
|---|---|---|
| **unified** (Next.js, :3003) | UI + API routes | behind nginx at cloud.taicho.ai |
| **cascade worker** (:3010) | funnel tick loop (advance enrollments, pick bandit variants, enqueue sends) + send loop (compose MJML, suppression-check, resolve the workspace default, send via Resend/Mailchimp) | public: `/u` `/o` `/c` `/webhooks` (unsubscribe, open/click tracking, provider webhooks) routed to it by nginx |
| **publishing worker** | token-refresh heartbeat (never publish on a dead OAuth token) + publish loop through destination adapters (YouTube, X, LinkedIn, Instagram, CMS, signed webhook) | none public; writes results back onto drafts in-process |
| **MCP operation worker** | durable MCP tools and asynchronous AI operations | none public; MCP protocol traffic enters through `/api/mcp` |

Agents (content generation, template generation, funnel optimization — Mastra agents resolving through OpenRouter + Qwen; Cascade uses a plain OpenRouter fetch client) run **offline only**: scripts, cron, or explicit UI actions. Nothing on a send/publish path ever calls a model.

## 4. Data: two stores, one rule

- **FalkorDB** — the knowledge graph: workspace Contacts and Content plus
  product-specific roles, research, topics, and activity. A person has one
  `Contact` identity; `Lead` and `NurtureContact` are role projections.
- **Postgres** — the transactional runtime: one instance with product-owned schemas — `auth` tables (Better Auth + entitlements), `cascade` (funnels, enrollments, sends, events, variants), `publishing` (channels, posts), jobs, MCP operations, and the `observability.execution_event` support ledger. High-write, lock-based, idempotent. The "what we're doing" store.

The rule: **engines execute only from Postgres; the graph is never on a hot path.** Where the two must meet (a published post updating its draft; funnel content referencing assets), the engine bridges in-process or through an explicit sync boundary — the UI never sees the seam.

External stores/services: **Cloudflare R2** (media staging for publishing),
**Resend, Twilio SendGrid, or Mailchimp Transactional** (workspace-selected
email transport behind
a shared `Mailer` interface), the four **social platform APIs** (behind
destination adapters), **OpenRouter** (agents only), **Datadog Cloud**
(operational telemetry), and **Langfuse Cloud** (privacy-filtered AI
telemetry). Provider credentials are AES-256-GCM envelopes in the
organization-scoped Cascade schema; the versioned envelope key remains in the
deployment secret store.

## 5. Infrastructure (graph-server, 77.42.45.165)

```
Cloudflare DNS (cloud.taicho.ai → 77.42.45.165)
        │
   nginx (TLS via certbot)
   ├── /u /o /c /webhooks ─────────► nurture-worker :3010  (docker)
   └── everything else ────────────► unified next :3003    (docker)
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

- Runs as a **Docker Compose stack** (`docker-compose.prod.yml`, project `content-automation`): `postgres`, `unified`, `nurture-worker`, `content-worker`, `mcp-worker`, `pricing-worker`, `falkordb`, `datadog-agent`, and `watchtower`. Env from `/root/content-automation/.env` (chmod 600). See `docs/deployment.md`.
- **Deploy**: push to GitHub main → CI (`.github/workflows/docker.yml`) tests, builds only the changed images, pushes them to `registry.vectornotion.com`; watchtower polls every 5 min and restarts the affected containers. Each container migrates its own Postgres schemas on boot. **Production deploys require owner review first.**
- **Graph backend**: FalkorDB is the sole runtime graph store (`docs/graph-backend.md`).
- **Observability**: every request, operation and durable worker attempt carries request/execution/parent IDs plus authoritative organization and actor attribution. Cloud telemetry is metadata-only; the raw tenant lookup remains in Postgres. See `docs/observability.md`.
- The legacy **Python Relay** container still runs in parallel (its channels are migrated; it winds down once the MCP shorts workflow has an equivalent).

## 6. The product loop the architecture serves

```
Content (make it) ──publish──► the world (YouTube/X/LinkedIn/IG/CMS)
     ▲                              │ audience responds
     │ performance                  ▼
  Nurture (warm leads over weeks) ◄──qualify── Outreach (capture leads)
     │ interest click routes to deeper funnels
     └────────────────► conversion
```

Each product owns one verb; the engines make the verbs run unattended; the unified app is the single pane of glass over all of it.

The dashboard is also the shared context plane: Outreach and Nurture consume
the same Contacts, while Content, Outreach, and Nurture consume the same
workspace Content library. Product packages may add projections or snapshots,
but may not become the canonical owner of shared people or content.
