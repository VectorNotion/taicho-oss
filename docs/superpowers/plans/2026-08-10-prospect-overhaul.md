# Lead → Prospect / Account Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the icp-update-v2.md entity normalization: nothing named "lead" remains in the system. `Lead` → `Prospect` everywhere (domain, graph labels, Postgres, actions, events, routes, UI, external v1 API, Chrome extension), with `Account` already first-class from the scoring build.

**Architecture:** Phased mechanical rename with protection for the word "leadership", executed bottom-up (product domain → platform contracts → database → apps → extension → data migration), gated by typecheck + full test suite per phase, committed per phase.

**Decisions (confirmed by Rajesh 2026-08-10):** full overhaul incl. graph data migration; HARD rename of `POST /api/v1/outreach/leads` → `/api/v1/outreach/prospects` with the extension updated and rebuilt in the same pass.

## Global Constraints

- "leadership" must survive every substitution (`leadership_public_posts` dimension, "Leadership Public Posts"). Protect-substitute-restore: `s/Leadership/⟦LSHIP⟧/g; s/leadership/⟦lship⟧/g` → rename → restore.
- Historical data in append-only stores keeps its recorded strings (old `lead.qualified` event *names*, old audit action strings); columns/labels/schema get renamed, history is not falsified.
- openCypher 9 rules still apply to all migration Cypher.
- Every phase ends: `pnpm typecheck` green + relevant test suite green + commit.

## Canonical Rename Map

| Old | New |
|---|---|
| `Lead` type / `:Lead` label / `:Contact:Lead` | `Prospect` / `:Prospect` / `:Contact:Prospect` |
| `leadId` / `lead_id` | `prospectId` / `prospect_id` |
| `LeadStatus/Source/Priority`, `LEAD_*_CONFIG` | `ProspectStatus/...`, `PROSPECT_*_CONFIG` |
| `lead-repository.ts` + all `getLead*`/`createLead*`… | `prospect-repository.ts`, `getProspect*`… |
| `:LeadResearch/:LeadNote/:LeadActivity/:LeadKnowledgeChunk` | `:ProspectResearch/…` (+ recreate vector index on new label) |
| `:LeadQualification` (legacy flat score) | `:LegacyQualification` |
| actions `research_lead` / `qualify_lead` | `research_prospect` / `qualify_prospect` (contracts, catalog, registry, payloads, auth pricing, capabilities, MCP) |
| events `lead.created/.researched/.qualified/.replied/.meeting.scheduled/.transcript.updated/.insights.updated` | `prospect.*` |
| `ProductEventRefs.leadId` + `product_events.lead_id` | `prospectId` + column rename migration |
| `outreach_lead_evidence/_insight_snapshots/_meetings/_meeting_events` tables | `outreach_prospect_*` (drizzle schema + SQL migration) |
| routes `/api/outreach/leads/**`, `/api/v1/outreach/leads`, pages `/outreach/leads`, `/leads/[id]` | `…/prospects…` |
| UI components `Lead*` (`LeadHero`, `LeadNotes`, …), copy "lead(s)" | `Prospect*`, "prospect(s)" |
| capabilities `outreach.lead.*`, `outreach.leads.list`, MCP `vectornotion://outreach/leads` | `outreach.prospect.*`, `…/prospects` |
| extension: v1 endpoint, payload naming, README/CLAUDE.md copy | prospects naming; `npm run build` must pass |

Unchanged: `Persona`, `source: 'sales_navigator'`, `leadership_public_posts`, historical row contents, `Account` (already correct).

## Phases

### P1 — Outreach product (domain, data, services, agent, UI components, tests)
Rename files (`git mv`) and identifiers across `products/outreach/**`; update `package.json` subpath exports; platform `workspace/contacts.ts` outreach role label `Lead` → `Prospect`. Gate: `pnpm test:outreach` + typecheck of the package.

### P2 — Platform contracts, events, capabilities, MCP, auth
Action ids, payload types, registry handlers, action-catalog.json, `auth/commercial.ts` pricing keys, `capabilities/{catalog,catalog-outreach,operation-service}.ts`, `mcp/{operations,outreach}.ts`, events vocabulary + refs + `events/repository.ts` insert mapping + intelligence event-policy consumers. SQL migration: `ALTER TABLE product_events RENAME COLUMN lead_id TO prospect_id` (find the migrations dir and follow its convention). Gate: `pnpm test:platform` + `pnpm test:capabilities` + typecheck.

### P3 — Database package (outreach intelligence tables)
Drizzle schema rename of the four `outreach_lead_*` tables + column `lead_id`; SQL migration with `ALTER TABLE … RENAME`; `lead-intelligence-repository.ts` → `prospect-intelligence-repository.ts` and domain `lead-intelligence.ts` → `prospect-intelligence.ts`. Gate: outreach tests + typecheck; run migration against dev Postgres.

### P4 — Apps (routes, pages, UI wiring, cross-product references)
`apps/outreach` + `apps/unified` + `apps/content-generator`: `git mv` route/page dirs, update imports/fetch URLs/copy; v1 API route dir rename; chat/atlas/cascade references to leads. Gate: full `pnpm typecheck`, `pnpm test`.

### P5 — Chrome extension
`extension-react/`: endpoint `/api/v1/outreach/prospects`, payload/idempotency naming, README; run its tests and `npm run build`. Gate: extension build + tests green.

### P6 — Data migration + docs + final verify
Script (scratchpad, run against dev FalkorDB) over every `content__org_*` graph: relabel `:Lead`→`:Prospect`, `:LeadResearch`→`:ProspectResearch`, `:LeadNote`→`:ProspectNote`, `:LeadActivity`→`:ProspectActivity`, `:LeadQualification`→`:LegacyQualification`, `:LeadKnowledgeChunk`→`:ProspectKnowledgeChunk` (+ recreate vector index), property `leadId`→`prospectId` on all carriers. Verify label-set via FalkorDB `SET n:New REMOVE n:Old` support; fallback to node copy if unsupported. Update `CLAUDE.md` (extension section, dashboard section), `docs/graph-backend.md` if it names Lead. Re-seed/verify the demo prospect page renders. Full `pnpm test` + typecheck. Push.

## Verification checklist (end)
- `grep -ri '\blead' --include='*.ts' --include='*.tsx' apps packages products extension-react/src | grep -v leadership` → zero hits (allowing history/comments explicitly justified).
- Dev app: prospects page, prospect detail incl. qualification card, personas, touch list all load.
- Extension `npm run build` output loads (manifest valid).
