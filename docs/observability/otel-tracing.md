# OTEL: semantic workflow tracing with OpenInference

Taicho uses the OpenTelemetry Node SDK for trace transport and context,
OpenInference semantic conventions for AI-native span meaning, and any
OTLP-compatible backend (Phoenix locally) to render a chronological waterfall.
The default export is a reviewed business narrative, not automatic HTTP, SQL,
Redis, filesystem, framework, or process instrumentation.

Operational logs, metrics, and support history remain in the separate
[OTL layer](./otl-logging.md).

## Design contract

A useful trace answers, in order:

1. What business workflow ran, for whom, and why?
2. What high-level data was loaded and how many records were materialized?
3. Which search, tool, model, embedding, scoring, and decision steps ran?
4. What deliberate input entered each step and what output came back?
5. What was persisted, scheduled, published, settled, or discarded?
6. Where did it fail and how long did each meaningful step take?

It should not answer which HTTP verb a library used, which SQL statement an
ORM emitted, how many sockets opened, or which runtime arguments started Node;
those facts belong in operational diagnostics and obscure the product flow.

## Architecture

```text
meaningful function / observeOperation workflow option
  -> packages/observability/workflow.ts
       -> AsyncLocalStorage semantic parent context
       -> OpenInference span kind + input.value + output.value
       -> bounded serialization and content redaction
  -> packages/observability/otel-privacy.ts
       -> workflow-only span filter
       -> exact resource and attribute allowlist
  -> OTLP/HTTP Protobuf exporter
  -> Phoenix locally / configured OTLP backend in production
```

`packages/observability/node.ts` initializes the SDK once per process with
resource auto-detection disabled. The exported resource is rebuilt from this
exact set: service name, service namespace, service version, deployment
environment, and OpenInference project name. Process command/arguments,
executable paths, source code, usernames, host IDs, PIDs, runtime details, and
CPU architecture are excluded even if another package creates them upstream.

## Instrumentation APIs

### 1. Opt a business operation into a waterfall

Add `workflow` only to a high-level operation whose chronology is useful:

```ts
return observeOperation('ai.outreach.generate', {
  organizationId,
  attributes: { medium, prompt_version: promptVersion },
  workflow: {
    name: 'outreach.message.generate',
    input: { prospectId, medium, targetContent, promptVersion },
    processOutput: (output) => ({
      draft: output.draft,
      usage: output.usage,
      finishReason: output.finishReason,
    }),
  },
}, async () => generateMessage());
```

Without `workflow`, `observeOperation` still performs all OTL duties but does
not enter the default AI waterfall. This is the main noise-control boundary.

### 2. Decorate a meaningful function

Use the OpenInference-backed `traceable` wrapper for model, search, grouped
retrieval, embedding, scoring, decision, and persistence functions:

```ts
const loadContext = traceable(loadContextInternal, {
  name: 'content.ideas.load_context',
  kind: 'data',
  processInputs: ([input]) => ({ windowDays: input.windowDays }),
  processOutputs: (output) => ({
    researchItemCount: output.researchItems.length,
    topicCount: output.topics.length,
  }),
});
```

The wrapper records duration, error, async parent/child relationship, reviewed
input, and reviewed output automatically; use `processInputs` and
`processOutputs` as the presentation and privacy boundary rather than emitting
function arguments blindly.

### 3. Add an inline semantic step

Use `observeWorkflowStep` when the meaningful boundary is inside an existing
orchestrator:

```ts
const records = await observeWorkflowStep('research.account.load_context', {
  kind: 'data',
  input: { accountId },
  processOutput: (rows) => ({ recordCount: rows.length, records: rows }),
}, () => repository.loadAccountContext(accountId));
```

Use `observeWorkflow` only when a workflow root is not already supplied by a
parent operation, and `runDetachedWorkflow` for fire-and-forget work that must
not remain an unfinished child of the caller.

## Span taxonomy

| Taicho kind | OpenInference kind | Use for |
|---|---|---|
| `workflow` | `CHAIN` | One user-meaningful end-to-end flow or sub-flow |
| `data` | `RETRIEVER` | Grouped business reads and context assembly |
| `tool` | `TOOL` | Search, provider, MCP, or other external capability |
| `generation` | `LLM` | Model prompts and completions, including consumed streams |
| `embedding` | `EMBEDDING` | Text-to-vector requests and vector batch summaries |
| `scoring` | `EVALUATOR` | Fit, quality, resonance, or qualification evaluation |
| `decision` | `CHAIN` | Refresh, routing, dedup, eligibility, and branching decisions |
| `persistence` | `TOOL` | One grouped durable write with a business outcome summary |

Never create one span per row, Cypher query, SQL statement, ORM call, stream
chunk, polling no-op, getter, or setter. Aggregate those actions into one node
that reports counts, bytes, identifiers, and the business result.

## Current workflow coverage

| Area | Semantic roots and important children |
|---|---|
| Outreach | account/person research, refresh planning, dimension search, synthesis, scoring, qualification, insights, message generation |
| Content | research context/source loading, Tavily search, extraction, topic embedding/dedup, ideas, refinement, drafts/variations, project-graph extraction, grouped persistence |
| Intelligence | MCP chat generation and unified chat streaming |
| Capabilities/platform | capability execution, durable operation execution, and streaming product jobs |
| Publishing | channel refresh, publish attempt, and result persistence |
| Authentication | current-user workspace onboarding |
| Resonance | Modal run spawn and terminal completion; routine running polls remain operational-only |

This table describes intentional workflow boundaries, not a promise that every
repository method is traced. New product workflows must opt in at their
business root and add only the children required to explain the result.

## Inputs, outputs, and privacy

`OBSERVABILITY_WORKFLOW_CONTENT` controls content display:

- `full`: send sanitized `input.value` and `output.value` JSON;
- `metadata`: send byte count, SHA-256 digest, and truncation state only;
- `off`: suppress values while preserving the workflow shape and timing.

The serializer always redacts credential-shaped keys, bearer values, inline
secrets, and email addresses; limits string length, array size, object keys,
depth, and total serialized bytes; and adds hashes/truncation metadata.
`processInputs` and `processOutputs` must still be treated as a required design
review: pass the prompt and model response when they explain the AI behavior,
but summarize unrelated records, enormous vectors, binary media, and internal
objects.

Tenant, actor, session, and non-correlation business IDs become deterministic
HMAC references in cloud attributes. `OBSERVABILITY_ID_HASH_KEY` is mandatory
when cloud telemetry is enabled. Raw tenant lookup remains in the Postgres OTL
ledger.

## Local Phoenix

Use the lightweight local backend with the machine-safe limits already chosen
for this repository:

```bash
docker run -d --name taicho-phoenix-local \
  --memory=512m --cpus=1 \
  -p 127.0.0.1:6006:6006 \
  -e PHOENIX_ALLOW_EXTERNAL_RESOURCES=false \
  -e PHOENIX_DEFAULT_RETENTION_POLICY_DAYS=1 \
  arizephoenix/phoenix:latest
```

Do not raise the Colima VM beyond 2 GiB/2 CPUs or its disk beyond 15 GiB; stop
idle stacks or prune unused Docker builders/images if resources are exhausted.

Configure the application process:

```dotenv
OBSERVABILITY_ENABLED=true
OBSERVABILITY_ID_HASH_KEY=<local-random-secret>
OBSERVABILITY_INCLUDE_INFRASTRUCTURE_SPANS=false
OBSERVABILITY_WORKFLOW_ONLY=true
OBSERVABILITY_WORKFLOW_CONTENT=full
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006
OTEL_PROJECT_NAME=taicho-local
DD_ENV=development
DD_VERSION=development
```

Open `http://localhost:6006`, run one business action, and verify one coherent
root with chronological children, visible input/output on each meaningful
node, grouped database counts, and no GET/POST, SQL, Redis, process, host, or
framework-rendering spans.

Set `OBSERVABILITY_INCLUDE_INFRASTRUCTURE_SPANS=true` only for a temporary,
explicit low-level diagnostic session. It enables Node auto-instrumentation and
will intentionally mix infrastructure spans into OTLP, so it is not the normal
Phoenix view.

## Progressive extension checklist

When adding a workflow:

1. Name the end-to-end business outcome, not its route or implementation.
2. Put one `workflow` root on the high-level operation or decorate the exported
   orchestrator with `traceable`.
3. Add grouped `data` nodes that report what was loaded and record counts.
4. Add `tool`, `generation`, `embedding`, `scoring`, and `decision` nodes only
   where their input/output explains the outcome.
5. Add one grouped `persistence` node for the durable result.
6. Review `processInputs`/`processOutputs` for secrets, personal data, size, and
   operator usefulness.
7. Exercise one success and one failure locally, then inspect the waterfall by
   eye before adding more spans.
8. Add a focused test that proves the hierarchy, span kinds, input/output, and
   privacy boundary; do not assert vendor UI layout.

## Focused verification

```bash
pnpm --filter @content-automation/observability test
pnpm --filter @content-automation/observability typecheck
pnpm --filter @content-automation/content-generator-app typecheck
pnpm --filter @content-automation/resonance typecheck
```

The OTLP backend is a presentation layer; the contract is the exported span
data. If a Phoenix panel omits a value, inspect the span attributes through its
API before changing instrumentation, because UI versions can render the same
valid OpenInference payload differently.
