# Shared Knowledge Registry and Evidence Graph — Implementation Plan

**Status:** End-to-end module integration is implemented; extractor selection, organization backfill, production activation, and legacy deletion remain explicit operator gates

**Date:** 2026-08-19

**Design:** [`../specs/2026-08-19-shared-knowledge-registry-design.md`](../specs/2026-08-19-shared-knowledge-registry-design.md)

## Goal

Replace the current hard-coded, product-specific research records with one module-contributed registry and one evidence-backed knowledge API, then migrate ICP research, insights, outreach messages, topics, ideas, and drafts without an in-place production rewrite.

## Implementation record

| Phase | Repository state | Remaining gate |
| --- | --- | --- |
| 0. Brain boundary | Complete | Atlas remains a read-only human explorer; architecture tests prevent its accidental removal. |
| 1. Registry and manifests | Complete | A new mounted module must add a manifest or declare `knowledge: 'none'`. |
| 2. Canonical repository and APIs | Complete | Run the production policy matrix and bounded-query load test against backfilled tenant data. |
| 3. Extraction contract | Pipeline and benchmark harness complete | Label the representative corpus and select a production model only after it passes the evidence/relation precision gate. |
| 4. Outreach and ICP | Shared writes, reads, assessments, insights, opportunities, messages, and lineage complete in shadow mode | Backfill one organization, compare results, and observe legacy fallback counters before removing old records. |
| 5. Content | Shared research writes, topic discovery, ideas, drafts, and lineage complete in shadow mode | Backfill one organization and remove the temporary `ResearchItem` write only after its consumers have moved. |
| 6. External modules and lookup | Signed external manifest validation, coverage query, and durable lookup dispatch complete | Bind each real external module to its deployment trust and OAuth policy before activation. |
| 7. Migration | Legacy research plus operational module backfills, comparison, and cutover-report tools are dry-run by default | No production migration or deletion has been run by this change. |
| 8. Other module producers | Workspace Contacts, transcripts, Cascade, Intelligence, Support, Resonance, publishing, and metrics emit replay-safe knowledge events | Backfill historical operational rows before evaluating production coverage. |
| 9. Shared consumers | Taicho queries the shared projection before answering; Intelligence artifacts retain exact claim/evidence IDs; Brain reads only `knowledge.v1` | Measure production context quality and latency on one backfilled organization. |

The task lists below are the rollout runbook as well as the implementation specification. A checked implementation record does not authorize a production backfill, infrastructure change, or deletion.

## Architecture

- Add `@content-automation/knowledge` as the dashboard-owned contract, compiler, repository, ingestion, identity-resolution, and query package.
- Keep `@content-automation/capabilities` as the sole executable-operation registry. Module manifests reference capability IDs; they do not redefine execution.
- Each product exports one static knowledge manifest. `registerPlatformCapabilities()` remains the composition root and compiles the manifests after registering all capabilities.
- FalkorDB stores organization-scoped knowledge. Postgres continues to own jobs, schedules, retries, idempotency, delivery, and frozen runtime artifacts.
- Build `knowledge.v1` beside existing graph labels, compare outputs, then cut consumers over one workflow at a time.
- Use Postgres product events as the durable outbox between transactional module writes and FalkorDB projection; the worker records a projection receipt only after the graph adapter succeeds.

## Other modules — implemented end-to-end plan

```text
module transaction or approved source
  -> replay-safe internal knowledge event in Postgres
  -> module-owned adapter selected from the shared registry
  -> SourceRevision -> exact Evidence -> accepted Claim / Assessment / Artifact
  -> one authorized shared context query
  -> research, ICP, insight, message, content, support, and agent decisions
```

| Module | What enters shared knowledge | What changes downstream |
| --- | --- | --- |
| Outreach and call capture | Web research, account/prospect observations, Recall transcripts, and live/final attendee transcripts with exact utterance spans | Qualification, insights, opportunities, and outreach messages consume accepted claims and persist the claim/evidence IDs used. |
| Workspace Contacts | Canonical contact identity, product roles, company association, and restricted contact facts | Outreach, Nurture, Intelligence, and agents resolve the same person and organization instead of cloning module identities. |
| Cascade / Nurture | Funnel, membership, and plain-text email changes | Agents can discover operational relationships and copy as knowledge while sending and scheduling remain outside the graph. |
| Intelligence and Taicho | Completed artifacts and reported outcomes | Artifacts without shared lineage are rejected; outcomes become assessments; Taicho must query the relevant shared projection and disclose coverage gaps. |
| Resonance | Creative variants and completed audience evaluation | Scores become reusable assessments connected to the exact creative evidence instead of isolated job output. |
| Publishing | Scheduled, published, and failed posts plus metric snapshots | Publications connect to drafts and channels; performance becomes a reusable assessment for future content decisions. |
| Support | Only explicitly submitted feedback notes | Attributable issues and feature requests become restricted claims; private support conversations are not silently promoted. |
| External modules | Signed, tenant-scoped manifest overlays | An authorized remote module can add namespaced vocabulary and read the same registry without receiving graph credentials or mutating the process-global contract. |

The graph is not the execution queue: transactional modules commit their own records first, the durable outbox projects knowledge asynchronously, and failed projections remain retryable without repeating the business operation.

## Locked decisions

- Owners never create or reconcile graph types in the dashboard.
- The core vocabulary is small and fixed; module vocabulary is versioned and namespaced.
- Models emit candidates only. They cannot emit Cypher, register types, or mutate schemas.
- Accepted claims are the reusable unit of knowledge; the system does not create a claim node for every sentence.
- Direct product edges are optional derived projections and must retain the supporting claim ID.
- All shared reads are organization-, permission-, sensitivity-, freshness-, and allowed-use filtered.
- Brain remains a read-only human explorer; it does not own schema, extraction, or canonical knowledge writes.
- GLiNER2 is a benchmark candidate, not a committed production dependency until it passes the corpus evaluation gate.
- Do not run extraction benchmarks inside the 2 GiB Colima VM. Run the laptop experiment natively; size any production worker from measured throughput and memory.

## Current seams this plan replaces

| Current seam | Problem | Migration target |
| --- | --- | --- |
| `products/content-generator/agent/actions/project-graph.ts` | eight hard-coded entity types | Content module extraction profile |
| `products/content-generator/data/research-repository.ts` | URL-only dedupe and flattened `ResearchItem` | source revisions, evidence, and accepted claims |
| `products/content-generator/agent/actions/topics.ts` | topics originate from project entities | `content.topic_discovery` projection over claims |
| `products/outreach/domain/qualification.ts` | observations are useful but semantically isolated | assessments linked to canonical claim IDs |
| `products/outreach/domain/types.ts` | legacy `ProspectResearch` blob | shared account/prospect context bundle |
| `products/outreach/domain/prospect-intelligence.ts` | source-linked claims use a private snapshot vocabulary | shared Claim and Artifact lineage |
| `products/outreach/agent/generator.ts` | prompt context loses canonical claim lineage | `outreach.message_context` plus persisted used IDs |
| `packages/capabilities/registry.ts` | executable operations only | retained; referenced by module manifests |
| `packages/atlas` and `/brain` | legacy explorer reads graph projections directly | retain the UI and progressively point its read model at authorized shared knowledge |

## Phase 0 — Preserve Brain while freezing its knowledge boundary

**Purpose:** keep the existing human explorer while preventing Atlas from becoming a competing schema, extraction, or persistence layer.

**Files:**

- Retain `apps/unified/app/brain/{page,loading}.tsx`, the Brain navigation, and access-denied handling.
- Retain `brain.overview.get`, `brain.node.get`, and `brain.search` as authorized read capabilities.
- Retain `packages/atlas`, its dependencies, and `test:atlas`.
- Keep all canonical writes, schema compilation, extraction, policy, and lineage in `packages/knowledge` and the contributing modules.
- Extend architecture tests to require the Brain surface and its read-only integration.

**Tasks:**

- [x] Reconcile these edits with any existing uncommitted sidebar/layout work before touching the files.
- [x] Add assertions that prevent accidental removal of the Brain surface.
- [x] Preserve the UI, read capabilities, dependency declarations, package, and test script.
- [x] Run `pnpm test:architecture`, `pnpm test:capabilities`, and `pnpm typecheck`.

**Gate:** Brain remains available, read-only, and separate from shared knowledge ownership.

## Phase 1 — Module manifest contract and compiler

**Purpose:** make module-contributed vocabulary a compile-time/deployment invariant before changing graph writes.

**Create `packages/knowledge`:**

- `package.json`, `tsconfig.json`, `index.ts`
- `registry/types.ts` — manifest, type, predicate, projection, profile, alias, and migration types
- `registry/schema.ts` — Zod schemas for internal TypeScript and future JSON manifests
- `registry/compiler.ts` — normalization, collision detection, alias resolution, version checks, and capability-reference validation
- `registry/registry.ts` — immutable compiled-registry reader; no runtime schema mutation
- `registry/core-manifest.ts` — dashboard core primitives and predicates
- `tests/registry.test.ts`

**Create module manifests:**

- `products/content-generator/knowledge-manifest.ts`
- `products/outreach/knowledge-manifest.ts`
- `products/cascade/knowledge-manifest.ts` with either its contributed roles or explicit `knowledge: 'none'`
- Add package exports for each manifest.

**Modify composition:**

- `packages/capabilities/catalog.ts` — register all executable capabilities first, then compile core plus mounted module manifests and validate every `capabilityId` reference.
- `packages/capabilities/tests/registry.test.ts` — assert capability/knowledge cross-references.
- Web, standalone app, and worker entrypoints that do not already call `registerPlatformCapabilities()` must do so before accepting work.

**Compiler rules to test:**

- [x] Duplicate module key/version fails.
- [x] Unresolved normalized type, predicate, or alias collision fails.
- [x] An invalid domain/range or missing referenced type fails.
- [x] A missing capability ID fails after capability registration.
- [x] `reuse`, `extends`, `equivalentTo`, and `replacedBy` compile deterministically.
- [x] A mounted product without a manifest or explicit `knowledge: 'none'` fails the architecture test.
- [x] Compiled output ordering and hash are stable across runs.

**Architecture test:** create `tests/architecture/knowledge-module-registry.test.mjs` to enumerate mounted product packages and prove they are present in the composition root.

**Gate:** the complete mounted module set produces one stable registry hash with zero unresolved collisions.

## Phase 2 — Canonical knowledge repository and shared query API

**Purpose:** establish the evidence/claim/identity contract before migrating any product workflow.

**Create in `packages/knowledge`:**

- `domain.ts` — `KnowledgeSource`, `SourceRevision`, `EvidenceSpan`, `Claim`, `CanonicalEntity`, `Assessment`, `Artifact`, and `KnowledgeRun`
- `repository.ts` — FalkorDB persistence and reconciliation
- `identity.ts` — deterministic exact identifiers, aliases, normalized names, and scored candidate resolution
- `policy.ts` — sensitivity and allowed-use enforcement
- `query.ts` — projection-driven context bundles and explanation paths
- `service.ts` — organization-scoped public API
- `tests/{repository,identity,query,policy}.test.ts`

**Graph v1 labels and edges:**

```text
(:KnowledgeSource)-[:HAS_REVISION]->(:SourceRevision)
(:SourceRevision)-[:CONTAINS]->(:Evidence)
(:Claim)-[:SUPPORTED_BY]->(:Evidence)
(:Claim)-[:SUBJECT]->(:CanonicalEntity)
(:Claim)-[:OBJECT]->(:CanonicalEntity)       // or typed literal properties
(:Assessment)-[:BASED_ON]->(:Claim)
(:Assessment)-[:ASSESSES]->(:CanonicalEntity)
(:Artifact)-[:USES]->(:Claim)
(:KnowledgeRun)-[:PRODUCED]->(:Claim|:Assessment|:Artifact)
```

Every v1 node carries `schemaVersion: 'knowledge.v1'`; organization isolation remains enforced by the existing per-organization graph context.

**Repository operations:**

- [x] `upsertSource()` identifies the living logical source.
- [x] `putSourceRevision()` is idempotent on normalized source identity + content hash.
- [x] `putEvidenceSpans()` validates offsets/excerpts against the revision.
- [x] `resolveEntity()` returns a canonical ID or a review-required candidate; it never merges uncertain identities silently.
- [x] `reconcileClaims()` writes the desired extraction-owned set and supersedes stale claims idempotently; retry repairs an interrupted openCypher-compatible query sequence.
- [x] `recordAssessment()` and `recordArtifact()` reject claim IDs outside the authorized context.
- [x] `queryContext()` returns bounded accepted claims, contradictions, evidence references, freshness, and confidence for one registered projection.
- [x] `explain()` traverses an assessment/artifact back to exact evidence without a model call.

**Add capabilities in `packages/capabilities/catalog-knowledge.ts`:**

- `knowledge.registry.get` — discover authorized types, predicates, projections, and referenced capabilities
- `knowledge.context.query` — task-specific bounded context
- `knowledge.entity.get` — canonical identity and allowed neighborhood facts, not visualization coordinates
- `knowledge.explain.get` — provenance for one claim, assessment, or artifact

These capabilities project automatically to REST, OpenAPI, MCP, and the dashboard under the existing registry rules.

**Gate:** repository replay is idempotent, cross-organization reads fail, policy tests return no disallowed evidence, and every returned claim explains to an exact source revision and span.

## Phase 3 — Shared ingestion and bounded extraction

**Purpose:** feed all research sources through one contract and choose the extractor using measured local data.

**Create in `packages/knowledge`:**

- `ingestion/source-adapter.ts` — adapter contract for web, note, transcript, reply, manual, and product records
- `ingestion/normalize.ts` — canonical source identity, content cleaning, hash, language, and metadata
- `extraction/types.ts` — candidate entity/claim/relation contract
- `extraction/profile.ts` — compile the union of requested module profiles into a bounded schema slice
- `extraction/resolver.ts` — registry type/predicate validation plus identity resolution
- `extraction/pipeline.ts` — normalize → dedupe → chunk → retrieve → extract → resolve → reconcile
- `extraction/current-llm-adapter.ts` — temporary compatibility adapter behind the new contract
- `tests/extraction-pipeline.test.ts`

An unchanged source hash with the same registry hash, profile, and extractor version reuses the successful run and accepted claims without invoking the model again.

**Benchmark, not production deployment:**

- Create `packages/knowledge/scripts/benchmark-extractors.ts` and a redacted JSONL fixture format.
- Sample roughly 200 representative chunks across account research, prospect research, web pages, notes, transcripts, and content research.
- Manually label entity spans, accepted claims, evidence spans, and allowed relations.
- Compare EmbeddingGemma + GLiNER2 against NuExtract and the current large-model extraction.
- Measure entity F1, relation precision, claim/evidence precision, chunks/second, peak RAM, and fallback rate.

**Model acceptance gate:** choose the cheapest pipeline that reaches the agreed precision floor on real labels. Relation and evidence precision are hard gates; public benchmark rank is not. If GLiNER2 misses the gate, keep the contract and use the best tested adapter rather than redesigning the graph.

**Runtime gate:** no extraction service is added to Colima or production until the benchmark records measured memory and throughput. If production needs a dedicated worker/node, size it from those measurements and obtain owner approval as a separate infrastructure change.

## Phase 4 — Migrate Outreach and ICP flows

**Purpose:** prove that shared knowledge changes decisions and generation, not only storage.

**Account and prospect research:**

- Modify `products/outreach/agent/account-research.ts`, `prospect-research.ts`, `dimension-research.ts`, and `match-evaluator.ts` to ingest source revisions and produce claim IDs.
- Modify `products/outreach/domain/qualification.ts` so `ObservationRecord` and `DimensionMatch` retain supporting and contradicting `claimIds` while keeping their existing policy/scoring meaning.
- Modify `products/outreach/data/qualification-repository.ts` to persist assessments linked to claims.
- Keep ICP/persona dimensions as product-owned policies registered through the Outreach manifest.

**Prospect intelligence:**

- Modify `products/outreach/agent/prospect-insights.ts` to read `outreach.prospect_intelligence_context` instead of constructing a private evidence block from repositories.
- Modify `products/outreach/domain/prospect-intelligence.ts` and `data/prospect-intelligence-repository.ts` so snapshots are `Artifact` projections with shared claim/evidence lineage.
- Add note, activity, sent-message, reply, manual-update, and transcript source adapters.

**Message generation:**

- Modify `products/outreach/agent/generator.ts` to request `outreach.message_context` and return `usedClaimIds` plus `usedEvidenceIds` in its structured output.
- Modify `products/outreach/domain/types.ts` and `data/prospect-repository.ts` to persist those IDs on the message artifact.
- Validate that selected IDs came from the authorized context bundle before saving.
- Modify `packages/platform/intelligence/dispatcher.ts` to use artifact/claim source references instead of legacy `ProspectResearch.companyInsights`.

**Legacy removal after dual-read passes:**

- Remove production of `ProspectResearch`, `CompanyInsight`, and `Competitor` graph records.
- Keep a temporary adapter only for consumers not yet migrated; instrument every adapter read so zero use is measurable before deletion.

**Tests:**

- [x] Account/persona assessment contains the exact supporting/contradicting claims and policy version.
- [x] Qualification consumes evidence-backed observations and policy-filtered context.
- [x] Prospect insights cite only claims in their context bundle.
- [x] Outreach output rejects invented or out-of-bundle claim IDs.
- [x] Saved messages explain to evidence while private notes remain non-quotable by default.
- [x] `lead_intelligence` and `outreach_intelligence` artifacts expose the new source references.

**Gate:** 100% of new assessments, insights, and messages preserve used claim IDs; legacy blob reads are measured and falling.

## Phase 5 — Migrate Content research and creation

**Purpose:** make topics and content originate from research knowledge with end-to-end provenance.

**Module manifest:** describe Content roles (`Project`, `Topic`, `Idea`, `Draft`), the current project entity concepts, allowed predicates, and these projections:

- `content.project_extraction`
- `content.topic_discovery`
- `content.idea_context`
- `content.draft_context`

**Research:**

- During shadow mode, keep the existing `ResearchItem` write for the current list UI and also ingest every finding as an immutable source revision, evidence span, and accepted knowledge claim.
- Give each derived finding a stable source identity so two findings from one URL cannot supersede one another accidentally.
- Replace the remaining `ResearchItem` write, URL-only dedupe, and string-matched `COVERS_TOPIC` links only after production comparison and zero-fallback gates pass.

**Project extraction:**

- Replace the hard-coded label array and prompt vocabulary in `agent/actions/project-graph.ts` with the `content.project_extraction` profile.
- Resolve extracted entities to canonical IDs and reconcile stale extraction-owned claims/relations on every run.
- Retain project-specific roles without cloning shared Person, Organization, Technology, or Concept identities.

**Topics, ideas, and drafts:**

- Modify `agent/actions/topics.ts` and `topics-agent.ts` to cluster/retrieve accepted research claims; projects become optional context.
- Modify `agent/actions/ideas.ts` to select and persist `sourceClaimIds` and `sourceTopicIds`.
- Modify `agent/actions/draft.ts` to receive resolved evidence and persist claim-level citation IDs.
- Update topic, idea, draft, and research repositories to store or project the new lineage.

**Tests:**

- [x] Topics can be generated from research with zero projects.
- [x] Project rerun removes stale extraction-owned knowledge.
- [x] Same research revision produces zero graph delta and skips the extractor.
- [x] Ideas and drafts reject source IDs absent from their context bundle.
- [x] Every accepted draft claim resolves to exact source evidence.

**Gate:** topic discovery uses research claims, and 100% of generated ideas/drafts retain their selected claim lineage.

## Phase 6 — External module contract and automatic lookup

**Purpose:** prove the architecture is genuinely modular rather than only internally centralized.

**External manifest support:**

- Publish the Zod-derived JSON Schema for `KnowledgeModuleManifest` through the docs/OpenAPI build.
- Add a fixture module under `packages/knowledge/tests/fixtures/external-module.json`.
- Validate signature/trust, module key ownership, supported manifest version, referenced capability IDs, and collision resolution before activation.
- External modules receive registry/query capabilities only through normal OAuth scopes and role authorization; they never receive FalkorDB credentials.

**Automatic lookup:**

- Add a registered `knowledge.coverage.get` query returning missing, weak, contradictory, or stale profile coverage.
- Add a durable `knowledge.lookup.request` operation that schedules existing web/source adapters under budgets, rate limits, and source policy.
- Feed results back through the Phase 3 pipeline; do not create a separate web-research graph.

**Gate:** the fixture external module compiles and queries its authorized projection without custom graph code, and automatic lookup produces the same Source → Evidence → Claim lineage as manual research.

## Phase 7 — Shadow backfill, cutover, and cleanup

**Create:**

- `packages/knowledge/scripts/audit-current-graph.ts`
- `packages/knowledge/scripts/backfill-v1.ts`
- `packages/capabilities/scripts/backfill-module-knowledge.ts`
- `packages/knowledge/scripts/compare-legacy-v1.ts`
- `packages/knowledge/scripts/cutover-report.ts`

All scripts require an explicit organization, default to dry-run, and never delete legacy data. The backfill records a completion checkpoint; an interrupted run safely replays its idempotent writes. Any production deletion requires a separate owner-approved operation after rollback expiry.

The module backfill covers existing Workspace Contacts, Cascade funnels/members/emails, publishing posts, and metric snapshots, then projects each stable event directly and replay-safely. It refuses to invent missing history: old Support conversations are not feedback, old Intelligence artifacts without claim/evidence IDs are not grounded, and old Resonance results without retained creative inputs are not reconstructable.

The Brain read model is now deliberately `knowledge.v1`-only so legacy blobs, opaque evidence IDs, and unsupported product nodes cannot masquerade as clean knowledge. This makes backfill a visible rollout prerequisite rather than silently mixing the old and new graph models.

**Order:**

1. Inventory current labels, relationships, source records, duplicates, and orphan rates.
2. Backfill active/recent Outreach sources and compare assessments/messages.
3. Enable Outreach v1 reads, retain legacy fallback and monitor it.
4. Backfill active/recent Content sources and compare topic/idea/draft inputs.
5. Enable Content v1 reads.
6. Backfill older sources lazily when queried.
7. Remove fallbacks only after their read counters remain zero for one release.
8. Produce a separate, exact deletion plan for obsolete labels and relationships.

**Final cutover gates:**

- [x] 100% of mounted modules have a valid manifest or explicit no-knowledge declaration.
- [x] Zero unresolved type, predicate, alias, or capability-reference collisions.
- [x] 100% of authorized cross-module contract tests pass.
- [x] Zero unauthorized records returned by the in-memory policy matrix.
- [x] 100% of accepted claims require source revision and evidence span lineage.
- [x] New Intelligence, Outreach, Content, Resonance, publishing, and feedback projections retain or derive exact accepted claim/evidence lineage.
- [ ] Historical assessments and generated artifacts have been backfilled or explicitly excluded from production coverage.
- [x] Unchanged replay delta is zero and the extractor is not called.
- [x] Research-only topic generation passes.
- [x] External fixture module registration passes.
- [ ] Legacy read fallback counters remain zero for one release.
- [ ] Context-query latency and process RSS stay inside the measured production budget on a representative backfilled organization without increasing Colima resources.
- [x] Brain route, read capabilities, package, dependency, and test gate exist without owning canonical knowledge writes.

## Verification commands

Run the narrow suite at every phase and the full gate before cutover:

```bash
pnpm test:architecture
pnpm test:knowledge
pnpm test:capabilities
pnpm test:mcp
pnpm test:platform
pnpm test:outreach
pnpm test:content
pnpm test:atlas
pnpm test:resonance
pnpm test:cascade
pnpm db:check
pnpm typecheck
```

Do not raise Colima above 2 CPUs, 2 GiB RAM, or 15 GiB disk for tests or model work. Stop idle stacks or prune unused Docker build/image data if resources are tight.

## Recommended execution order

1. Phase 0 preserves the Brain and freezes its read-only knowledge boundary.
2. Phases 1–2 establish the registry and knowledge contracts.
3. Phase 3 benchmarks extraction while the repository contract is stabilized.
4. Phase 4 migrates Outreach/ICP as the first end-to-end product slice.
5. Phase 5 migrates Content.
6. Phase 6 proves external modularity and adds automatic lookup.
7. Connect the operational and feedback-producing modules through the durable outbox.
8. Move Taicho, Intelligence, and Brain to the shared read contract.
9. Backfill, compare, activate one organization, and prepare separately approved cleanup.
