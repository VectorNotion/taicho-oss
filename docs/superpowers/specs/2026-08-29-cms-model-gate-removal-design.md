# CMS Model Gate Removal and Single AI Runtime — Design

**Date:** 2026-08-29
**Status:** Approved direction; implementation sequencing proposed

## Scope boundary

This is a platform cleanup, separate from the
[Content Base media redesign](./2026-08-29-content-base-media-design.md).

This design owns removal of the CMS-managed model catalog and the model
selection/gating machinery used by chat, MCP chat, external agents, and
creative generation. The Content Base media design owns media ownership,
Visual Briefs, media-led Posts, and the image/video provider adapter details.

## Problem

Taicho currently has two competing ways to decide which language model runs:

1. Most product agents use the code-owned `routerModel()` path, which resolves
   one OpenRouter model from the application runtime.
2. Main Chat, MCP Chat, hosted agents, and creative media first fetch a model
   catalog published from Payload CMS, filter it by surface and capabilities,
   resolve `auto` or an explicit key, translate that key into a provider
   deployment, and apply a per-model credit multiplier.

The second path was built for a future multi-model marketplace and workspace
policy system. The current product does not offer a meaningful model choice,
does not charge customers based on a visible model choice, and already hides
model selection from some of the relevant user interfaces.

Despite that, the CMS catalog sits on the critical execution path. A core AI
request can fail because:

- no CMS model is published;
- the record is disabled or marked unconfigured;
- its surface list is wrong;
- a capability flag is missing;
- catalog API/signing/webhook secrets differ between services;
- the CMS cannot be reached and no valid snapshot is available;
- staging and production contain different CMS documents;
- an `auto` default points to a key that is absent from that environment.

Those are control-plane failures for a product that has only one supported
language model. They do not represent a useful user decision.

## Current architecture

```text
Payload CMS PlatformModels collection
          │ publish/update/delete
          ▼
signed /api/platform/catalog ────────┐
          │                          │ signed change webhook
          ▼                          ▼
Taicho catalog fetch + schema + HMAC verification
          │
          ▼
Postgres platform_catalog_snapshots + process cache
          │
          ▼
surface/capability/allowlist/default resolver
          │
          ├── Main Chat
          ├── MCP Chat
          ├── Hosted Agents
          ├── Agent configuration API
          └── Creative media
```

The path requires model collection schemas and migrations in CMS, bootstrap
seeds, a protected endpoint, signatures, change notifications, an application
sync endpoint, four shared catalog credentials, a materialized database
snapshot, caching, public model projections, UI pickers, runtime resolution,
and degradation behavior. Across the two services it also requires three
shared secrets and two internal URLs solely for catalog delivery and refresh.

The model record currently carries key, name, family, description, execution
provider, deployment ID, kind, capabilities, surfaces, speed, credit
multiplier, status, recommendation, operational status, sort order, and an
opaque credential reference. Most of those fields have no current product
effect beyond permitting or preventing the one intended model from running.

## Decision

Remove CMS from model routing and authorization. Taicho will have one
release-owned primary language-model target, used by every language-generation
surface.

```text
User request
    │
    ▼
Taicho AI runtime
    ├── code-owned primary model identifier
    ├── server-only provider credential
    └── operation policy such as token limits and tools
    │
    ▼
Provider
```

There is no model catalog fetch, model key, `auto` resolver, surface gate,
capability gate, workspace model allowlist, model picker, or per-model billing
multiplier in this path.

The CMS remains the control plane for content that genuinely needs runtime
administration, such as billing plans, workspace administration, support, and
assistant knowledge. It is no longer the authority for application execution
code.

## Decision summary

| Decision | Choice |
|---|---|
| Language-model authority | Application release |
| Language-model count | One primary model |
| Provider path | One shared server-side adapter, initially direct OpenRouter |
| Model identifier | Code-owned constant; same artifact in local, staging, and production |
| Provider credential | Environment secret |
| User model choice | None |
| CMS `PlatformModels` collection | Remove |
| Signed platform model catalog | Remove |
| Runtime model resolver | Remove |
| Model-based credits | Remove; meter stable product operations if needed |
| Actual provider/model recording | Keep as execution provenance |
| Creative models | Fixed targets per supported media operation, owned by the media adapter |
| Embedding models | Internal subsystem configuration, not user-selectable and not CMS-gated |
| Import-provider CMS collection | Keep; it is unrelated to model routing |

## Runtime configuration

### One language-model source of truth

Consolidate language-model execution behind one small module, evolving the
existing `packages/platform/agents/model.ts` house pattern instead of retaining
the generic catalog/resolver package.

The module owns:

- the primary provider model slug as a reviewed code constant;
- construction of the Mastra/OpenRouter model reference;
- a provider execution descriptor used by raw HTTP callers;
- startup/runtime readiness validation for the provider credential;
- test injection without process-global mutation;
- safe execution metadata for traces and the usage ledger.

The model slug is not different by workspace or product surface. The released
artifact uses the same slug in local live mode, staging, and production.
Changing the primary model is a normal reviewed code change with tests and a
deployment, not a CMS edit and not an environment-specific mutation.

The only required runtime secret for language inference is the provider
credential. Simulation/stub modes remain explicit development/test modes and
must remain forbidden in production.

### Direct provider path

Use the existing direct OpenRouter path consistently for language generation.
Most product agents already use `routerModel()` and `OPENROUTER_API_KEY`, so
this removes rather than adds an execution path.

Retire the LiteLLM alias translation and fallback path after confirming no
production workload depends solely on it. Remove `LITELLM_BASE_URL` and
`LITELLM_API_KEY` from the supported runtime contract once all consumers use
the shared direct adapter.

This does not forbid introducing a gateway later. A gateway should be added
only when there is an operational requirement such as audited fallback,
provider quotas, or centralized rate limiting. It must remain invisible to the
product domain and must not reintroduce per-request CMS gating.

### Other modalities

One language model does not mean one provider deployment can perform every
kind of generation.

- Image generation has one server-owned image deployment.
- Video generation has one server-owned video deployment.
- Structured visuals use Taicho's deterministic renderer.
- Embeddings use the one model owned by the relevant search/knowledge
  subsystem.

These are operation implementations, not a catalog of choices. Their actual
execution identifiers are recorded as provenance but are not accepted from a
browser or workspace configuration.

## Product and API changes

### Main Chat

- Remove the Model picker from the Chat composer.
- Remove `model` from `ChatControls`, its default, validation schema, client
  state, and request payload.
- Remove page-level `loadChatModelOptions()` calls and model-option props.
- Resolve the shared language runtime directly inside the Chat execution path.
- Replace "catalog unavailable" and "no approved model" errors with one
  actionable readiness error: "Chat is unavailable because AI generation is
  not configured for this environment."
- Keep source, depth, permission, context, and contact controls; those are real
  user decisions.

Old browser payloads containing `model: "auto"` may be accepted and ignored for
one compatibility release, but the server must never route on the value.

### MCP Chat

- Remove the catalog fetch and `auto` selection.
- Construct the request context with the shared runtime execution descriptor,
  or let the intelligence agent obtain the shared runtime directly.
- Keep the same authorization and read-only mutation policy.

### Intelligence agent

- Stop requiring `AI_MODEL_EXECUTION_CONTEXT_KEY` to contain a resolved catalog
  selection.
- Use the shared runtime module as its model function.
- Request context may continue to carry an execution descriptor when useful
  for tracing, but it contains the actual fixed execution target rather than a
  requested/resolved selection policy.

### External/hosted agents

- Remove `modelKey` from agent create/update/domain schemas.
- Remove `models[]` from the agent list/configuration response.
- Remove agent-model validation from capabilities.
- Run every hosted agent through the shared language runtime.
- Existing stored agent definitions containing `modelKey: "auto"` or a legacy
  key are read compatibly, but the field is ignored and omitted on the next
  write.
- After all stored definitions have been normalized, remove the compatibility
  reader.

The OpenAI-compatible endpoint must retain its protocol-level `model` field.
In that API the value identifies the deployed Taicho agent slug; it does not
select an underlying provider model. The `/v1/models` response listing agent
deployments also remains valid for the same reason.

### Creative media

The companion Content Base media design removes `modelKey`, public model
options, catalog resolution, and model multipliers from creative-generation
requests. This platform cutover must not add a second implementation of that
work; it only removes the shared catalog machinery after creative media has
moved to fixed operation targets.

### Usage, billing, and observability

Keep recording the actual provider and model/deployment on completed execution
records, usage-ledger entries, and traces. Replace requested/resolved/source
metadata with stable operation information:

- operation or capability name;
- actual provider;
- actual model/deployment;
- token/media usage;
- runtime version;
- simulation state when applicable.

If credits remain, charge for stable product operations or measured usage.
Do not multiply the charge by a model entry that users cannot see or choose.

## CMS removal

### Remove model administration

- Remove `PlatformModels` from Payload configuration.
- Remove its admin collection, access rules, hooks, generated types, and
  collection-specific tests.
- Remove model documents from platform bootstrap/seeding scripts.
- Add a Payload migration that removes the `platform-models` collection tables,
  version tables, indexes, and relations after application consumers have cut
  over.
- Remove model-catalog browser QA flows and replace them with fixed-runtime
  readiness coverage in the application.
- Update CMS documentation so it no longer claims ownership of approved
  models.

The migration is destructive and therefore belongs in the final cleanup
release, after read-only verification proves there are no remaining consumers.
No generated media, agent history, or usage records are deleted; those store
their own execution provenance.

### Remove catalog delivery plumbing

- Remove `/api/platform/catalog` once no application consumer uses it.
- Remove the CMS catalog-change notification helper and model collection hooks.
- Remove `/api/internal/platform-catalog/sync` from the application.
- Remove catalog HMAC schema, fetch, cache, and snapshot repository code.
- Drop `platform_catalog_snapshots` in the final database cleanup migration.

The current catalog response also bundles `PlatformImportProviders`. Runtime
code does not consume that data from the parsed model snapshot. Do not preserve
the generic catalog merely for that collection.

Keep `PlatformImportProviders` as a CMS administrative collection if it remains
useful. Remove its platform-catalog notification hook. If the application later
needs a dynamic import-provider list, create a dedicated import-provider
contract with its own ownership and tests rather than reviving a generic model
catalog.

### Remove secrets and environment contracts

Remove these application/CMS trust-channel settings after the cutover:

- `PLATFORM_CATALOG_URL`
- `PLATFORM_CATALOG_API_KEY`
- `PLATFORM_CATALOG_SIGNING_SECRET`
- `PLATFORM_CATALOG_WEBHOOK_SECRET`
- `TAICHO_PLATFORM_CATALOG_SYNC_URL`

Update:

- root and CMS environment examples;
- production and CMS environment validators;
- Kubernetes/hosting secret templates;
- CI/CD secret wiring;
- the security secret inventory and rotation procedures;
- architecture tests that currently require the signed catalog client.

Do not remove `PAYLOAD_INTERNAL_URL`, `PAYLOAD_SECRET`, billing catalog secrets,
assistant gateway secrets, or other CMS integration settings. They support
separate control-plane capabilities.

## Application code removal

Delete or replace the following catalog-specific abstractions after all
consumers move to the shared runtime:

- `packages/platform/models/catalog.ts`
- `packages/platform/models/catalog-schema.ts`
- `packages/platform/models/catalog-service.ts`
- `packages/platform/models/catalog-repository.ts`
- the selection/policy portion of `packages/platform/models/resolver.ts`
- `packages/ui/components/ModelPicker.tsx`
- catalog and model-picker tests that assert user selection behavior
- chat model-option loaders and props
- model-selection public types and capability filters

Provider execution and provenance types should move into the small runtime
adapter or the owning media subsystem. Do not keep a generic "model catalog"
namespace solely to house those types.

Searches for the word `model` must be reviewed semantically. Do not remove:

- database/domain "data model" terminology;
- read models and projection models;
- embeddings owned by search subsystems;
- actual provider/model provenance in usage records;
- OpenAI protocol fields that identify an external Taicho agent;
- test model stubs used for dependency injection.

## Data compatibility

### Stored agent definitions

Agent definitions are stored as graph JSON and may contain `modelKey`. During
the transition:

1. Readers accept legacy definitions and strip `modelKey` from the returned
   domain value.
2. Writers omit the field.
3. A bounded migration rewrites existing definition JSON without `modelKey`
   while preserving identity, version, status, permissions, channels, and
   timestamps.
4. Verification counts definitions still containing the field.
5. Compatibility code is removed only when the count is zero in staging and
   production.

### Chat clients

For one release, request parsing may strip the legacy Chat `model` control.
It must not validate, resolve, log as requested selection, or affect cost.
Current clients stop sending it in the same release.

### Historical execution records

Do not rewrite historical run, usage, or trace metadata. Existing
`requestedModel`, `resolvedModel`, `modelSource`, and creative `model_key`
values remain valid historical provenance. New records write only actual
execution identity and operation metadata.

### Catalog database records

CMS model documents and application snapshots have no product ownership after
cutover. Export their keys/deployment IDs into the migration evidence artifact,
then remove the tables in the cleanup release. This export is for audit only,
not a runtime rollback source.

## Deployment sequence

The removal should be delivered as coordinated, independently verifiable
slices rather than one destructive deployment.

### Release A — introduce fixed runtime and cut over consumers

- Add the shared single-model runtime adapter.
- Move Main Chat, MCP Chat, intelligence, and hosted agents to it.
- Remove all model controls from current client requests.
- Accept-and-ignore legacy request/stored fields temporarily.
- Move creative media through its fixed operation adapters as described in the
  Content Base media spec.
- Stop all runtime catalog reads and writes.
- Keep the old CMS endpoint and snapshot table temporarily inert.

Verification: runtime telemetry shows zero `/api/platform/catalog` fetches,
zero platform-catalog sync calls, and successful representative generation on
every consumer.

### Release B — remove CMS and application catalog plumbing

- Remove CMS model administration and seeds.
- Remove catalog endpoint, notifications, and application sync endpoint.
- Remove catalog packages, model picker, resolver, and obsolete tests.
- Remove catalog environment variables from validators and deployment secrets.
- Normalize stored agent definitions.

Verification: local, staging, and production resolve the exact same code-owned
model identifier; all AI surfaces work while CMS is unavailable.

### Release C — drop obsolete storage

- Confirm no stored agent definitions contain `modelKey`.
- Export catalog metadata for audit evidence.
- Drop CMS model collection/version tables.
- Drop `platform_catalog_snapshots`.
- Remove temporary compatibility readers.

Verification: migrations run with the standard release-owned database role;
application and CMS startup probes pass with every retired catalog variable
absent.

## Rollback behavior

Release A is reversible by deploying the previous application artifact while
the inert CMS catalog and snapshot still exist. Release B should not be deployed
until Release A has been verified in staging and production. Release C occurs
only after the rollback window for the catalog-dependent artifact has closed.

Rollback is artifact-based. Operators do not edit CMS model rows to repair a
broken application release.

## Testing

### Runtime unit tests

- the shared runtime returns the one code-owned model;
- missing provider credentials produce a precise readiness failure;
- production rejects simulation mode;
- provider/model execution metadata contains the actual target;
- no workspace, request, or surface input can alter the target.

### Consumer tests

- Main Chat runs without CMS or catalog variables.
- MCP Chat runs without CMS or catalog variables.
- hosted agents run regardless of a legacy stored `modelKey`.
- agent create/update/list contracts contain no selectable model fields.
- creative generation contains no selectable model fields.
- old Chat payloads are ignored only during the compatibility window.
- credit reservation is independent of model choice.

### Architecture tests

- production no longer requires catalog URL/signing/webhook credentials;
- CMS no longer exposes or seeds `platform-models`;
- no production source imports the removed catalog service or resolver;
- browser bundles contain no provider deployment IDs or credentials;
- every language-generation consumer imports the shared runtime boundary;
- staging, production, and local live mode use the same code-owned model slug.

### Browser QA

- Chat has no Fast/Balanced/Reasoning/Auto/model control.
- agent creation/editing has no model field.
- AI surfaces remain available while CMS catalog routes are absent.
- readiness failures refer to AI generation configuration, not model approval,
  model catalogs, or capabilities.
- CMS Platform Control Plane has no Platform Models collection.

## Acceptance criteria

- Publishing, disabling, or deleting a CMS document cannot change or block the
  model used by an application request.
- Local live mode, staging, and production use the same released primary model
  identifier.
- No current product UI displays a model selector or `Auto` model option.
- No current browser/API request can select a provider model.
- Chat controls and agent definitions contain no active `model`/`modelKey`
  selection field.
- Main Chat, MCP Chat, hosted agents, and creative media make no platform model
  catalog request.
- The application works when the CMS is unavailable, subject only to features
  that genuinely use CMS data.
- `PlatformModels`, `/api/platform/catalog`, the sync endpoint, catalog
  snapshot storage, and their trust-channel secrets are removed after the
  staged cutover.
- Model-based credit multipliers no longer affect new usage.
- Actual provider and execution model remain recorded for observability and
  historical provenance.
- `PlatformImportProviders` remains independent and does not keep the model
  catalog alive.
- The OpenAI-compatible agent API retains its protocol-level agent-slug
  `model` field.

## Out of scope

- A user-facing model marketplace.
- Customer-supplied provider credentials.
- Per-workspace model policies, defaults, or allowlists.
- Dynamic provider failover or model evaluation routing.
- Removing CMS-owned billing, workspace, support, or assistant capabilities.
- Redesigning content-media ownership and Visual Briefs; that belongs to the
  companion Content Base media design.
