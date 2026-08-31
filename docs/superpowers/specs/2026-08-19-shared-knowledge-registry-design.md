# Shared Knowledge Registry and Evidence Graph — Design

**Status:** Implemented in code; organization backfill and production cutover remain operator-controlled

**Date:** 2026-08-19

**Implementation plan:** [`../plans/2026-08-19-shared-knowledge-registry.md`](../plans/2026-08-19-shared-knowledge-registry.md)

## 1. Decision

> Every mounted module contributes its knowledge types, relationships, extraction needs, read projections, and capability references to one dashboard-owned registry; every authorized module can inspect that registry and read the resulting canonical knowledge through one shared knowledge API.

The owner does not administer graph schema. Internal modules, future external modules, and agents all use the same contract. A module may add meaning, but it may not create a private semantic store that other authorized processes cannot discover.

```text
module manifests ──compile──> shared registry
                                 │
research sources ──extract──> evidence-backed knowledge
                                 │
            authorized modules and agents
              query, assess, and create
```

## 2. Why this is necessary

Before this change, the repository contained several useful but incompatible knowledge systems:

- Content research stored flattened `ResearchItem` records and later guessed topic links from strings.
- Project extraction hard-coded eight entity labels and their relationships in `project-graph.ts` and `project-repository.ts`.
- Account and prospect research stored dimension-specific observations and scores.
- Prospect intelligence had source-linked claims, but those claims belonged to its own snapshot format.
- Outreach generation serialized research, notes, activities, and insights into a prompt and persisted the message without the claim IDs that influenced it.
- The existing capability registry correctly describes executable operations, but it does not describe graph vocabulary or shared knowledge projections.

These are not merely different views of one graph. They are different contracts with no shared identity, claim, evidence, or schema-evolution layer. Adding more edges between the current records would preserve that fragmentation.

## 3. Non-negotiable invariants

1. **One registry:** every mounted module has one versioned manifest or an explicit `knowledge: none` declaration.
2. **One knowledge plane:** accepted evidence, claims, entities, and relationships are canonical and organization-scoped.
3. **Shared reads:** authorized modules query the same knowledge API; they do not read another module's private research blob.
4. **Evidence before use:** a decision-grade claim or relationship has an evidence path, confidence, validity window, and extraction version.
5. **Stable identity:** modules add roles to canonical entities; they do not clone a person or organization under product-specific labels.
6. **Controlled evolution:** models may propose candidates, but only registered types and predicates can enter accepted graph state.
7. **No owner schema work:** collisions and migrations are developer/module concerns surfaced at compile time or deployment, not dashboard settings.
8. **Authorization is central:** tenant, sensitivity, freshness, and allowed-use policy are enforced on every shared knowledge read.
9. **Brain is a view, not a second knowledge system:** `/brain` may visualize and inspect authorized graph knowledge, but Atlas does not define schema, own canonical data, or replace query, context, and explanation APIs.
10. **A committed operation never depends on a graph write:** modules append a replay-safe internal event after their transactional record is durable, and the shared worker retries graph projection until it can record a receipt.
11. **Feedback returns to the same plane:** outcomes, audience evaluations, publishing metrics, and approved support feedback become evidence-backed assessments or claims that future modules can query.

## 4. Three separate responsibilities

The design deliberately separates three things that are easy to conflate:

| Part | Answers | Contains |
| --- | --- | --- |
| Module registry | What concepts and workflows exist? | types, predicates, extraction profiles, projections, aliases, manifest versions |
| Knowledge graph | What does this workspace currently know? | entities, source revisions, evidence spans, claims, assessments, artifacts, lineage |
| Capability registry | What may this caller do? | the existing executable query/command/operation/stream definitions and authorization |

The module manifest references existing capability IDs. It does not duplicate their input schemas, execution code, pricing, idempotency, or authorization.

## 5. Dashboard-owned core

The dashboard owns a deliberately small stable vocabulary:

- `Entity` — one canonical identity; base kinds are `Person`, `Organization`, `Concept`, `Place`, `Event`, and `Thing`.
- `Source` — a logical origin such as a page, search result, note, transcript, reply, CRM record, or API response.
- `Evidence` — an immutable source revision or span with content hash and capture time.
- `Claim` — one proposition supported or contradicted by evidence.
- `Policy` — an ICP, persona, editorial, privacy, or other evaluation rule.
- `Assessment` — a policy-specific interpretation such as a dimension match, score, qualification, or risk.
- `Artifact` — a generated result such as an insight, message, brief, topic, idea, or draft.
- `Run` — ingestion, extraction, evaluation, or generation lineage.
- `TypeDefinition` and `PredicateDefinition` — compiled registry definitions, not user-created business data.

Modules extend these primitives with namespaced roles and predicates. For example, Outreach contributes `outreach.Account`, `outreach.Prospect`, and `outreach.Message`; Content contributes `content.Topic`, `content.Idea`, and `content.Draft`. Acme remains one core `Organization`, and Jane remains one core `Person`.

## 6. Module manifest contract

Each module exports static, version-controlled data that can be validated without importing its runtime services:

```ts
interface KnowledgeModuleManifest {
  moduleKey: string;
  version: number;
  knowledge: 'contributes' | 'none';
  entityTypes: EntityTypeDefinition[];
  predicates: PredicateDefinition[];
  extractionProfiles: ExtractionProfileDefinition[];
  readProjections: ReadProjectionDefinition[];
  capabilityIds: string[];
  aliases: AliasDefinition[];
  migrations: RegistryMigrationDefinition[];
}
```

Definitions use stable namespaced keys, plain-language descriptions, allowed subject/object kinds, sensitivity defaults, and allowed uses. Extraction profiles select a bounded slice of the registry for a particular job; they are not unrestricted prompts. Read projections describe what a workflow needs, such as `outreach.message_context` or `content.topic_discovery`.

The dashboard composition root collects the manifests of all mounted modules and compiles them before serving traffic or starting a worker.

## 7. Collision and evolution rules

Compilation fails when two active manifests introduce an unresolved normalized key, alias, or incompatible predicate signature.

The developer who owns the module resolves the overlap explicitly:

- **Reuse** a core or existing module concept.
- **Extend** an existing concept with a module role or additional metadata.
- **Equivalent** declares two historical keys as the same meaning.
- **Distinct** preserves two genuinely different concepts under namespaced keys.

When a useful module concept becomes universal, it is promoted to the dashboard core with `equivalentTo` or `replacedBy`. Existing entity and claim IDs remain valid. Registry evolution never requires destructive identity replacement.

## 8. Canonical knowledge shape

The logical path is:

```text
Source -> Evidence -> Claim -> Entity / Predicate -> Assessment / Artifact
```

Important details:

- A source URL identifies a living document; URL plus content hash identifies an immutable revision.
- A claim stores its statement, subject/object IDs or literal value, predicate key, evidence spans, confidence, validity interval, sensitivity, allowed uses, and extraction version.
- Competing values are reported as contradictions only when the registry declares that predicate single-valued; multi-valued predicates such as mentions never manufacture conflicts.
- Candidate claims are separate from accepted claims. Unsupported candidates cannot influence scores, messages, insights, or content.
- Direct product edges may be materialized for fast reads, but they are derived projections with claim IDs; they are never the sole record of truth.
- Re-running unchanged content produces no new graph state. Changed content reconciles the desired extraction-owned state and marks superseded claims rather than silently accumulating edges.

## 9. Research and extraction flow

```text
source adapter
  -> normalized source revision
  -> dedupe and useful chunks
  -> registry-selected extraction profile
  -> candidate entities / claims / relations
  -> identity and predicate resolution
  -> validation and policy checks
  -> accepted shared graph write
```

The extraction model receives only the type and predicate slice needed for the active profiles. It returns structured candidates and evidence spans; it never emits Cypher and never changes the registry.

The default model strategy remains a measured cascade:

1. Hash, deduplicate, clean, and chunk without a model.
2. Reuse a successful extraction when the source hash, registry hash, profile, extractor, and extractor version are unchanged.
3. Use a small embedding model for retrieval and topic similarity.
4. Benchmark GLiNER2 for bounded entity and relation extraction on representative corpus data.
5. Use a generative extractor only for low-confidence or high-value exceptions.

Claims are the reusable knowledge layer, but the system does not create a node for every sentence. It extracts claims requested by active module profiles and can enrich an existing source revision later when a new module adds a profile.

## 10. Shared read contract

A knowledge query supplies:

- the task or projection key;
- canonical subject IDs;
- optional time/freshness bounds;
- the authenticated organization and actor context.

It returns a bounded context bundle containing ranked claims, relevant relationships, reusable assessments and artifacts selected by the projection, evidence IDs, uncertainty, contradictions, and permitted citation text. Policy filtering happens before the bundle leaves the shared service.

Agents first inspect the compiled registry to discover available types, predicates, projections, and capability IDs. They then use authorized capability calls to query knowledge or perform work. Registry visibility never bypasses capability authorization.

## 11. Effect on product workflows

### ICP and persona research

Dimensions remain policies describing what to investigate and what a strong match looks like. Observations become assessments derived from canonical claims rather than isolated research truth. Scores retain the policy version plus supporting and contradicting claim IDs.

### Prospect and account intelligence

Account, prospect, notes, calls, transcripts, replies, and web research resolve to the same Organization and Person identities. Relationship insights become artifacts derived from shared claims and source evidence.

### Outreach generation

The generator requests `outreach.message_context`, chooses a permitted evidence-backed angle, and persists the claim/evidence IDs actually used. Private notes may influence a result only when policy allows and are not quoted by default.

### Content

Topics are discovered from accepted research claims rather than only project entities. Ideas and drafts persist their source claim and evidence IDs. Content-specific voice, format, editorial review, and publishing remain inside the Content workflow.

### Future web lookup and external modules

Automatic lookup is another source adapter triggered by missing, weak, or stale coverage. A remote module submits the same versioned manifest format and uses the same capability and knowledge APIs; it receives no special graph access.

## 12. Runtime boundary

FalkorDB remains the knowledge store. Postgres remains the durable execution store for jobs, schedules, idempotency, delivery, and transactional state.

An intelligence or generation workflow may query the graph to assemble context before producing an assessment or artifact. External delivery workers do not execute from graph state; they execute from committed Postgres work records and frozen artifact inputs.

The bridge between those stores is a tenant-scoped product-event outbox. Workspace Contacts, Outreach transcripts, Cascade records, Intelligence artifacts/outcomes, Resonance results, publishing state/metrics, and approved Support feedback append stable `knowledge.*` events. The worker discovers event IDs without reading tenant payloads through its control-plane role, reloads each payload through the tenant role, invokes the module adapter, and writes a policy-versioned projection receipt only after success. Replays therefore produce no duplicate business operation or graph delta.

Taicho and other agents do not infer which private repository to inspect. They discover registered projections, query the authorized shared context bundle, and disclose missing coverage. Brain uses the same canonical `knowledge.v1` facts as its human read model and renders evidence excerpts and source links rather than raw internal evidence identifiers.

## 13. Rollout policy

The new model is built beside the current labels and repositories in a versioned shadow namespace. Research and Outreach migrate first because they expose the largest correctness gap. Content migrates after the shared claim and context contracts are proven. Backfill is active/recent first and lazy for older sources.

Cutover requires all acceptance gates in the implementation plan. The Brain remains available as a read-only human explorer and is guarded against accidental removal by architecture tests. Legacy research blobs, string-matched topic links, and compatibility extraction paths remain only for the measured shadow migration; they are removed after their fallback counters are zero and the production comparison is accepted.

## 14. Definition of success

- All mounted modules compile into one registry.
- An external fixture module registers without custom graph code.
- Authorized cross-module queries return the same canonical identity and claims.
- Every accepted claim has exact evidence lineage.
- ICP assessments, insights, outreach messages, ideas, and drafts retain the claim IDs they used.
- Unchanged replay creates zero node or relationship delta.
- The Brain remains the human explorer and must consume authorized shared knowledge without becoming a private schema or persistence path.
