# Observability and execution attribution

The production system uses **Datadog Cloud** for operational telemetry and
**Langfuse Cloud** for AI traces. A small Datadog Agent runs beside the
containers only as a collector; neither cloud platform is self-hosted.

Every meaningful operation has one correlation chain:

```mermaid
flowchart TD
    A["Browser, webhook, MCP client"]
    B["Request ID + support code"]
    C["Authenticated organization + actor"]
    D["Operation execution ID"]
    E["Durable queue row"]
    F["Worker child execution"]
    G["Datadog trace, metric, log"]
    H["Langfuse AI trace"]
    I["Postgres execution ledger"]

    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    D --> G
    F --> G
    D --> H
    F --> H
    D --> I
    F --> I
```

## What each system owns

| System | Purpose | Identity stored | Content policy |
|---|---|---|---|
| Datadog Cloud | HTTP, DB, worker, tool, queue and provider health; logs; metrics; traces | request/execution/job/run IDs plus keyed pseudonyms for organization, actor, session and business entities | prompts, messages, payloads, email addresses, raw error messages, stack traces, URL queries and SQL text are rejected at the exporter |
| Langfuse Cloud | model latency, model/provider, token usage, tool timing, failures and evaluations | request/execution IDs plus keyed pseudonyms for organization, user, session and agent | prompts, completions, instructions, tool payloads and arbitrary metadata are always redacted |
| Postgres `observability.execution_event` | authoritative support lookup and execution history | raw organization and actor IDs, request/execution/parent IDs, trace/span IDs | allowlisted metadata and error type/code/fingerprint only |
| Product databases | the business record and durable queues | raw tenant and actor attribution where needed to execute work | unchanged; remains inside Vector Notion's application data boundary |

The cloud pseudonyms are deterministic HMAC references. They allow grouping
without revealing the source organization, user or session ID. Production
startup fails if `OBSERVABILITY_ID_HASH_KEY` is absent.

## Identity contract

| Field | Meaning | Crosses a durable queue? | Sent to cloud? |
|---|---|---:|---:|
| `request_id` | one originating interaction | yes | yes |
| `execution_id` | one operation or worker attempt | yes | yes |
| `parent_execution_id` | the operation that created this work | yes | yes |
| `traceparent` | W3C parent trace context | yes | yes |
| `organization_id` | authoritative tenant | yes | pseudonym only |
| `actor_id` | user or service principal responsible | yes | pseudonym only |
| `actor_type` | `user`, `service`, or `system` | yes | yes |
| `session_id` | authenticated or chat session | when relevant | pseudonym only |
| `run_id` / `job_id` | durable business execution | yes | yes |
| `support_code` | human-safe lookup code, for example `TX-82K5M-3Q7CV` | derived from request ID | response header and ledger |

The browser receives only:

- `x-vector-notion-request-id`
- `x-vector-notion-execution-id`
- `x-vector-notion-support-code`

Raw organization and actor headers are internal request headers and are never
copied to the public response.

Every public HTTP boundary discards caller-supplied Vector Notion identity and
correlation headers before creating its server-owned context. Authentication
then supplies the authoritative organization and actor, so a client cannot
spoof another tenant's telemetry or ledger attribution.

## Durable propagation

```mermaid
sequenceDiagram
    participant R as Request
    participant A as App operation
    participant Q as Postgres queue
    participant W as Worker
    participant O as Cloud telemetry
    participant L as Execution ledger

    R->>A: request + authenticated actor
    A->>L: started
    A->>Q: work + actor + request + parent + traceparent
    A->>L: succeeded
    A->>O: span, metric, safe log
    W->>Q: claim work
    Q-->>W: persisted attribution
    W->>L: child execution started
    W->>O: child span under original trace
    W->>L: succeeded or failed
```

Attribution is persisted for:

- automation workflow runs;
- MCP asynchronous operations and one-time media uploads;
- platform background jobs;
- CRM imports, inbound events, mutations, outbox commands and sync cycles;
- Cascade enrollments and email sends;
- scheduled publishing posts.

This is what keeps the user and trace association intact after a process
restart or a delayed retry.

## Runtime coverage

| Service | Datadog service name | Explicit operations |
|---|---|---|
| unified Next.js app | `taicho-unified` | authorization, chat, MCP protocol/tools, AI streams and automatically instrumented HTTP/DB calls |
| standalone outreach app | `taicho-outreach` | HTTP/DB, research, qualification and outreach AI |
| standalone content app | `taicho-content` | HTTP/DB, chat and content AI |
| Cascade worker | `taicho-cascade-worker` | each enrollment step, send and public tracking request |
| publishing worker | `taicho-publishing-worker` | token refresh, post publish and result sink |
| MCP operation worker | `taicho-mcp-worker` | each durable MCP operation |

The Node HTTP instrumentation activates execution context before route code,
so legacy routes receive the same correlation even if they do not create a
custom span. A privacy-safe console bridge converts remaining server-side
`console.*` calls into metadata-only structured records. A final OpenTelemetry
export filter also removes URL queries, SQL statements, error messages, stacks,
and non-allowlisted attributes from automatically generated spans before they
can reach the Datadog Agent.

## Production configuration

Place these secrets in `/root/content-automation/.env`:

```dotenv
# Datadog Cloud
DD_API_KEY=...
DD_SITE=us5.datadoghq.com
DD_ENV=production

# Langfuse Cloud
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_BASE_URL=https://cloud.langfuse.com

# Independent application secret
OBSERVABILITY_ID_HASH_KEY=...
```

Operational settings:

```dotenv
OBSERVABILITY_LOG_LEVEL=info
OBSERVABILITY_LEDGER_RETENTION_DAYS=180
```

Generate the identity key independently:

```bash
openssl rand -base64 32
```

`docker-compose.prod.yml` enables telemetry and the execution ledger for every
app and worker, sends OTLP/HTTP to `datadog-agent:4318`, and explicitly labels
only the privacy-bridged Node containers for log collection. PostgreSQL,
FalkorDB, Watchtower, docs and Agent logs are not bulk-exported.

## Local debugging

Use the same cloud projects with a distinct local identity-hash key and an
explicit development environment:

```dotenv
OBSERVABILITY_ENABLED=true
# Generate with: openssl rand -base64 32
OBSERVABILITY_ID_HASH_KEY=...
OBSERVABILITY_LEDGER_ENABLED=true
OBSERVABILITY_LOG_LEVEL=debug
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
DD_API_KEY=...
DD_SITE=us5.datadoghq.com
DD_ENV=development
DD_VERSION=development
LANGFUSE_REALTIME=true
```

Start the profile-scoped local Datadog collector only when operational tracing
is needed:

```bash
docker compose --profile observability up -d datadog-agent
docker compose --profile observability exec datadog-agent agent health
```

The local collector is capped at 384 MiB. Containerized workers override the
OTLP endpoint to `http://datadog-agent:4318`; applications running directly on
the Mac use the loopback endpoint shown above. Langfuse receives `DD_ENV` as
its first-class environment and `DD_VERSION` as its release, so shared project
keys do not mix development and production traces.

## Support lookup

Ask the user for the support code from the error surface or
`x-vector-notion-support-code` response header, then query the
tenant-authoritative ledger:

```sql
SELECT
  support_code,
  started_at,
  service_name,
  operation,
  status,
  execution_id,
  parent_execution_id,
  request_id,
  organization_id,
  actor_id,
  actor_type,
  trace_id,
  job_id,
  run_id,
  duration_ms,
  error_type,
  error_code,
  error_fingerprint,
  safe_attributes
FROM observability.execution_event
WHERE support_code = $1
ORDER BY started_at;
```

Always confirm the organization before disclosing findings. Datadog can then
be filtered by `taicho.request.id`, `taicho.execution.id`, `trace_id`, or the
pseudonymous organization reference. Langfuse can be filtered by the same
request/execution metadata for AI work.

## First production checks

```bash
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.prod.yml up -d datadog-agent
docker compose -f docker-compose.prod.yml exec datadog-agent agent health
docker compose -f docker-compose.prod.yml logs --tail=100 datadog-agent
```

Then make one authenticated request and one queued worker operation:

1. Confirm the response contains the three public correlation headers.
2. Confirm one request trace and its worker child appear in Datadog.
3. Confirm the ledger has the same request, parent execution and actor.
4. Run one AI action and confirm Langfuse shows model/usage metadata but
   `[CONTENT REDACTED]` for input and output.
5. Search both cloud systems for a real email address or prompt used in the
   check; the search must return nothing.

## Cloud controls

Configure these in the Datadog and Langfuse organizations before production:

- SSO and least-privilege support/engineering roles;
- EU or US region selected to match the customer contract;
- 30-day cloud retention unless a customer contract requires less;
- audit logs enabled;
- secret rotation ownership and an incident revocation procedure;
- monitors for elevated failed-operation rate, worker silence, queue age,
  ledger write failures, model error rate and model cost anomalies.

The Postgres ledger defaults to 180 days and deletes expired rows at service
startup. Raw prompt, completion and tool-payload capture is deliberately not
supported by the shared exporter; incident debugging uses correlation,
metadata, error fingerprints and the tenant-authoritative business records.
