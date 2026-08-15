# OTL: operational logging and execution history

OTL is Taicho's name for its operational telemetry layer; it is not an
OpenTelemetry standard or a separate vendor SDK. OTL answers operational
questions such as "did the worker fail?", "which tenant owned the operation?",
"what support code identifies it?", and "how long did it take?" through
privacy-safe JSON logs, metrics, and the Postgres execution ledger.

OTL does not own the AI workflow waterfall. That belongs to the
[OTEL/OpenInference layer](./otel-tracing.md).

## Runtime flow

```text
request / worker / connector
  -> execution context (request, execution, tenant, actor, job/run)
  -> observeOperation(...)
       -> started/succeeded/failed JSON log
       -> operation counter and duration histogram
       -> started/final execution_event ledger row
       -> ordinary protocol OTel span (not exported to the AI waterfall)
       -> optional semantic workflow (only when workflow: {...} is supplied)
```

The implementation lives in `packages/observability`:

| File | Responsibility |
|---|---|
| `context.ts` | Async execution attribution and deterministic cloud pseudonyms |
| `headers.ts` | W3C and Taicho correlation propagation at trusted boundaries |
| `logger.ts` | One-line structured JSON logs and the privacy-safe legacy console bridge |
| `operation.ts` | Operation lifecycle, metrics, ledger updates, and optional OTEL hand-off |
| `ledger.ts` | Durable tenant-authoritative `observability.execution_event` history |
| `privacy.ts` | Error normalization and safe business attributes |
| `otel-privacy.ts` | Final attribute/resource allowlist shared by exported telemetry |

## Structured logs

Create one component logger and use stable event names:

```ts
import { createLogger } from '@content-automation/observability';

const log = createLogger('publishing.worker');

log.info('publishing.post.claimed', {
  post_id: post.id,
  attempt: post.attempt,
  destination: post.destination,
});

log.error('publishing.post.failed', error, {
  post_id: post.id,
  attempt: post.attempt,
});
```

Each record includes the timestamp, level, service, component, event, active
trace/span IDs, execution/request IDs, actor type, and pseudonymous tenant and
actor references when available. Fields pass through the safe attribute
allowlist. Errors retain type, safe code, and fingerprint; arbitrary messages,
stacks, credentials, prompts, payloads, and personal identifiers do not become
log fields.

Use an event name shaped as `<domain>.<subject>.<outcome>` and put dimensions
in fields. Do not build event names from IDs or error text. Log a state change,
retry boundary, terminal result, or actionable anomaly; do not log every loop
iteration, getter, setter, or successful HTTP request.

`OBSERVABILITY_LOG_LEVEL` accepts `debug`, `info`, `warn`, `error`, or `silent`.
Logs go to stdout/stderr for the runtime's normal collector (Datadog/O2 in the
configured environment); Taicho does not use the OTel trace exporter as a
second log transport.

## Operations and the execution ledger

Use `observeOperation` around a meaningful unit with a stable identity, such as
a queued job attempt, capability execution, publishing attempt, connector
delivery, authentication provisioning action, or AI request:

```ts
return observeOperation('publishing.post.publish', {
  organizationId,
  jobId,
  attributes: {
    post_id: post.id,
    destination: post.destination,
    attempt: post.attempt,
  },
}, async () => publish(post));
```

This automatically emits operation lifecycle logs and metrics, writes one
replay-safe ledger record that moves from `started` to `succeeded` or `failed`,
normalizes errors, and carries the execution context through async work.
`OBSERVABILITY_LEDGER_ENABLED=true` enables the ledger and
`OBSERVABILITY_LEDGER_RETENTION_DAYS` controls retention.

The ledger deliberately stores raw organization and actor IDs because it is
the authoritative, tenant-scoped support lookup inside Postgres. Cloud logs and
traces receive deterministic HMAC references instead, and production startup
requires `OBSERVABILITY_ID_HASH_KEY` whenever cloud export is enabled.

## Correlation and durable work

Every operation uses:

- `request_id` for the originating interaction;
- `execution_id` for this operation or attempt;
- `parent_execution_id` for the operation that created it;
- `job_id` or `run_id` for the durable business execution;
- W3C `traceparent` for trace continuity;
- `organization_id`, `actor_id`, and `actor_type` for authoritative ownership;
- `support_code`, derived from the request ID, for customer support lookup.

Queue rows and worker payloads must persist the attribution and trace carrier,
then create a child execution when claimed. Public clients receive only the
request ID, execution ID, and support code; private tenant/actor headers are
accepted only from trusted internal boundaries and are replaced with
authenticated server context at public boundaries.

## What belongs in OTL

Use OTL for protocol and infrastructure facts:

- HTTP status, route class, retries, rate limits, and provider availability;
- worker claims, leases, requeues, timeouts, and terminal state changes;
- aggregate database or queue health;
- operation duration, counters, billing settlement, and support attribution;
- safe error type/code/fingerprint.

Do not use OTL as a transcript, prompt store, request/response dump, SQL query
log, or AI reasoning trace. If an operator needs to understand the chronological
business process and its inputs/outputs, add a semantic OTEL workflow instead.

## Adding or changing OTL safely

1. Choose a stable operation or event name that describes the business event.
2. Attach authenticated execution context before logging.
3. Add only bounded, filterable, non-content fields; use counts and IDs instead
   of raw records.
4. Preserve request/execution/parent IDs across durable boundaries.
5. Use `observeOperation` when the work has a real start and terminal outcome.
6. Add a targeted logger/operation test and confirm no prompt, token, email,
   request body, response body, SQL, or stack escapes the privacy filter.

## Local checks

```bash
pnpm --filter @content-automation/observability test
pnpm --filter @content-automation/observability typecheck
```

To inspect ledger history, query `observability.execution_event` by
`support_code`, `request_id`, `execution_id`, `job_id`, or `run_id`, always
confirming the organization before disclosing a result.
