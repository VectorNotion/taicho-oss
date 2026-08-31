# ADR: Dapr durable execution for Automations

**Date:** 26 August 2026
**Status:** Implemented and locally validated
**Scope:** `packages/flow`, the unified app, and the local/self-hosted runtime

## Decision

Use self-hosted Dapr Workflows as the durable execution authority while Taicho
continues to own the product and control plane: the visual editor, immutable
workflow definitions, tenant authorization, API, schedules, run projections,
node handlers, and operation ledger.

Dapr and its JavaScript SDK are Apache-2.0 open source. The local topology runs
the Dapr sidecar, placement service, and scheduler in Docker and stores workflow
state in the existing PostgreSQL service through Dapr's PostgreSQL v2 state
component. No managed service is required.

Primary references:

- [Dapr Workflows overview](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-overview/)
- [Dapr JavaScript workflow SDK](https://docs.dapr.io/developing-applications/sdks/js/js-workflow/)
- [Dapr PostgreSQL v2 state store](https://docs.dapr.io/reference/components-reference/supported-state-stores/setup-postgresql-v2/)
- [Dapr source and Apache-2.0 license](https://github.com/dapr/dapr)

## What the UI graph becomes at runtime

The canvas still saves data, not executable user source code:

```text
AutomationDef
  nodes: [{ id, type, config, position }]
  edges: [{ source, target, sourceHandle? }]
  state: [{ key, source, valueType }]
```

Publishing creates an immutable definition version. Enqueueing a run copies
that version and definition into `workflow_runs`; the run UUID is also the Dapr
workflow instance ID. A single versioned orchestrator,
`taichoAutomationWorkflowV1`, deterministically interprets the graph in
topological order.

```text
Browser / API / webhook / schedule / product event
                         |
                 enqueue immutable run
                         |
          Dapr taichoAutomationWorkflowV1
             /       |       |       \
       activity    timer   signal   activity
          |                    |        |
      one UI node       approval UI   next node
          |
   PostgreSQL operation ledger + UI projection
```

“Line-by-line durability” therefore means one durable boundary per visual node,
not arbitrary JavaScript source lines. A node is the smallest supported unit of
replay, retry, inspection, cancellation, and idempotency. Splitting a business
operation into several independently resumable points means representing those
points as separate nodes or activities.

## Execution mechanism

For each node the orchestrator:

1. Calls a named Dapr activity with `organizationId`, `runId`, `nodeId`, and the
   resolved upstream input.
2. The activity acquires a PostgreSQL advisory lock for the stable operation
   key `organizationId/runId/nodeId`.
3. It checks `automation.operation_ledger`. A committed result is returned
   immediately; otherwise the step is marked running and its attempt begins.
4. The existing Taicho node handler executes in tenant context.
5. Its output, step projection, run projection, artifact idempotency record,
   and operation-ledger completion are persisted before Dapr receives the
   activity acknowledgement.
6. Dapr records the activity completion in its workflow history and schedules
   the next graph node.

Control nodes map directly to durable primitives:

| Canvas behavior | Durable mechanism |
| --- | --- |
| Normal node | Named Dapr activity |
| Delay | Durable Dapr timer; no worker process is held open |
| Approval | External `automation-control` event addressed to the run instance |
| Retry | Deterministic backoff timer followed by the same activity and operation key |
| Branch | Deterministic edge selection; inactive descendants are projected as skipped |
| Cancel | Projection moves to cancelled and the Dapr instance is terminated |
| Retry whole failed run | Dapr history is purged, projections are reset, and the same immutable definition is scheduled again |

The Dapr history is execution authority. Taicho tables remain the RLS-protected
read model used by the UI and APIs.

## The database-failure answer

The precise recovery behavior is:

| Failure point | Result after recovery |
| --- | --- |
| Before an activity starts | Dapr delivers it to an available worker. |
| During the Taicho database transaction | PostgreSQL rolls back; Dapr retries and the node starts again. |
| After the database commit but before Dapr receives the acknowledgement | Dapr retries; the operation ledger returns the committed output and the node body is not executed twice. |
| While a durable timer or approval is open | A replacement worker replays history and resumes from that timer/signal. Completed nodes are not rerun. |
| After a retryable node error | The error/attempt is projected, Dapr waits on a durable backoff timer, then invokes the node again. |
| After the attempt budget is exhausted | Run and step fail and one dead-letter record is written. |

There is still no magical exactly-once guarantee across an arbitrary external
provider boundary. If a remote provider accepts an email or publish request and
the process dies before Taicho can commit the receipt, any workflow engine can
retry that call. Every external adapter must therefore pass the same stable
operation key to a provider idempotency facility or use a transactional
outbox/inbox protocol. Taicho-owned artifacts and product actions now receive
stable idempotency keys; new external adapters must preserve this contract.

## Implemented components

- `packages/flow/engine/dapr/workflow.ts`: deterministic graph interpreter.
- `packages/flow/engine/dapr/activities.ts`: node activities and the durable
  operation boundary.
- `packages/flow/engine/dapr/worker.ts`: dedicated workflow/activity worker,
  schedule maintenance, and event fan-out.
- `packages/flow/engine/runtime.ts`: enqueue, dispatch, signal, cancel, retry,
  and client lifecycle adapter.
- `automation.operation_ledger`: one stable record per logical node operation.
- Artifact idempotency keys and unique index.
- Runtime/orchestration metadata on `workflow_runs`.
- A migration-owned `automation` schema and runtime-safe schema bootstrap.
- `docker-compose.automation-dapr.yml` and `deploy/dapr/components/*` for the
  self-hosted local services and PostgreSQL workflow store.
- `scripts/run-automation-dapr-dev.sh` for one-command local startup.

As of 2026-08-27, Dapr is the only automation execution backend. The previous
PostgreSQL lease worker and the in-process Unified host were removed so local,
CI, staging, and production cannot silently exercise different runtimes.

## Validation evidence

The following tests pass locally against real PostgreSQL and real self-hosted
Dapr services:

- Durable timer followed by approval and external-event resume.
- Database commit followed by an injected lost Dapr acknowledgement; operation
  attempt remains 1.
- Retry exhaustion and dead-letter creation.
- Cancellation during a durable timer with downstream attempt remaining 0.
- Hard `SIGKILL` of the worker during a timer, downtime beyond the timer
  deadline, replacement-worker startup, and successful continuation with every
  completed node still at attempt 1.
- Ten browser/API processes, including UI approval and schedule metadata, all
  succeeding with `runtimeBackend=dapr` and
  `orchestrationInstanceId=run.id`.

Commands:

```bash
pnpm --filter @content-automation/flow test
pnpm --filter @content-automation/flow test:dapr
pnpm --filter @content-automation/flow test:dapr:restart

E2E_BASE_URL=http://localhost:3010 \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
pnpm exec playwright test tests/e2e/automation-dapr.e2e.spec.ts
```

## Local operation

```bash
pnpm dev:automation-dapr
```

This prepares the local database, starts the self-hosted Dapr services, starts
the dedicated worker, and serves the isolated worktree app at
`http://localhost:3010`. The base repository's PostgreSQL and FalkorDB
containers are shared because the existing base compose file uses fixed
container names; the code checkout, Next.js process, Dapr services, ports, and
worker are isolated to the `automation-testing` worktree.

Health checks:

```bash
curl --fail http://127.0.0.1:3501/v1.0/healthz/outbound
docker compose -f docker-compose.automation-dapr.yml ps
```

Required app/worker settings are documented in `.env.example`.

## Known boundaries and next hardening

- `taichoAutomationWorkflowV1` pins the current orchestration contract. Any
  non-deterministic orchestration change needs a new registered version; old
  versions must remain available while runs are open.
- Dapr JavaScript 3.18's runtime consumes an async generator while its public
  `TWorkflow` declaration still describes a synchronous generator. The code
  contains one documented type cast at that SDK boundary.
- Provider idempotency is mandatory for remote effects; the operation ledger
  alone cannot close a failure window outside PostgreSQL.
- Schedule catch-up/overlap/backfill policy remains a Taicho product decision;
  current presets enqueue one due occurrence and calculate the next one.
- Production needs ordinary operational work: workflow-history retention,
  metrics/alerts, backup/restore drills, worker-version rollout policy, and
  capacity testing.

These are explicit operating constraints, not reasons to revert to DBOS,
Temporal Cloud, or a closed control plane.
