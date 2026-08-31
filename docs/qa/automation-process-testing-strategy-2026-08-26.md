# Automation testing strategy

**Date:** 26 August 2026
**Branch:** `automation-testing`
**Status:** core durable-runtime checks and production-release browser rehearsal implemented

## Purpose

The automation test pyramid must prove two different things:

1. The product works from browser to authenticated API to PostgreSQL and back
   to the run inspector.
2. The execution architecture survives the failure windows that an ordinary
   browser test cannot create.

A green canvas test is not durability evidence. Dapr integration and
fault-injection tests are release gates alongside Playwright.

## Test layers

| Layer | Boundary proved | Command |
| --- | --- | --- |
| Flow unit/integration | Definitions, templates, state, tenant isolation, Dapr projection, schedules, events, artifacts, node behavior | `pnpm --filter @content-automation/flow test` |
| Dapr runtime | Timers, signals, retries, dead letters, cancellation, and commit/ack idempotency | `pnpm --filter @content-automation/flow test:dapr` |
| Worker replacement | Hard process loss during an expired durable timer and continuation by a fresh worker | `pnpm --filter @content-automation/flow test:dapr:restart` |
| Browser/API | Authenticated UI, capabilities, ten definitions/runs, UI approval, projection, and cleanup | `pnpm exec playwright test tests/e2e/automation-dapr.e2e.spec.ts` |

The deterministic lanes use `AUTOMATION_RUNTIME_MODE=stub`. PostgreSQL, Dapr,
Better Auth, API routes, workflow history, the dedicated worker, and Chromium
are real; AI, email, publishing, and other third-party effects are stubbed.

## Ten browser/API processes

The executable suite creates a unique fixture set, publishes each graph,
starts every run through the browser's authenticated API session, performs the
approval from the visible editor, verifies the Dapr identity fields and step
attempts, then deletes its fixtures.

| # | Process | Graph/behavior | Main assertion |
| ---: | --- | --- | --- |
| 1 | Set data | Manual → Set data → Run log | Typed JSON crosses durable activities. |
| 2 | Trigger templating | Manual payload → templated Set data → Run log | `{{trigger.customer}}` resolves after persistence. |
| 3 | Durable delay | Manual → Set data → Delay → Run log | Timer resumes without a held request/process. |
| 4 | Human approval | Manual → Set data → Approval → Run log | UI shows needs approval; clicking Approve raises the Dapr event and completes. |
| 5 | True branch | Data → matching branch → two outputs | True output succeeds; false output is skipped. |
| 6 | False branch | Data → non-matching branch → two outputs | False output succeeds; true output is skipped. |
| 7 | Filter list | JSON list → Filter → Run log | Only matching rows reach the result. |
| 8 | Query Brain | Deterministic Brain query → Filter → Run log | Multi-step persisted data flow succeeds. |
| 9 | Parallel merge | Trigger → two Set data nodes → one output | Multiple upstream results merge and each node executes once. |
| 10 | Hourly scheduled graph | Cron trigger → Set data → Run log | Publishing calculates a future `nextRunAt`; a manual smoke run uses the same immutable graph. |

Every final run must have:

- `status=succeeded`;
- `runtimeBackend=dapr`;
- `orchestrationInstanceId === run.id`;
- no failed step;
- attempt 1 for every non-skipped step.

The focused browser run currently passes in one Chromium worker in about seven
seconds on the local machine.

## Durability fault matrix

| Fault | Injection/probe | Required evidence |
| --- | --- | --- |
| Lost activity acknowledgement after DB commit | Throw after the operation ledger and step projection commit | Dapr retries, run succeeds, ledger attempt and `step.started` count remain 1. |
| Worker dies during durable timer | `SIGKILL` the directly owned worker, remain down past the deadline, start a replacement | Run remains waiting while down, resumes after replacement, no completed node reruns. |
| Retryable/permanent activity error | Invalid node with bounded attempts | Attempt budget is consumed, run fails, one dead letter exists. |
| Cancellation during timer | Signal cancel before timer fires | Dapr instance terminates; downstream attempt remains 0. |
| Human pause | Wait for `needs_approval`, raise external event | Same immutable run and instance resume to success. |
| Database transaction failure | Covered by repository transaction tests; extend with a targeted failpoint when adding a new transactional effect | Partial ledger/projection state is absent and the activity can retry. |
| Remote-provider accept then local crash | Provider-specific contract test for each live adapter | Stable operation key is reused and provider reports a replay, not a second effect. |

The final row cannot be satisfied generically by Dapr or any other workflow
engine. It becomes mandatory as each real side-effect adapter is enabled.

## Local execution

Prepare deterministic users and start the isolated app/runtime:

```bash
pnpm e2e:prepare
pnpm dev:automation-dapr
```

The app is served at `http://localhost:3010`. In another terminal:

```bash
set -a; . ./.env; set +a
POSTGRES_HOST=localhost \
E2E_BASE_URL=http://localhost:3010 \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
pnpm exec playwright test tests/e2e/automation-dapr.e2e.spec.ts
```

If a local database was previously used with a different
`BETTER_AUTH_SECRET`, Better Auth's encrypted JWKS record must be rotated before
auth-backed E2E can run. This is local credential state, not automation state.

## Execution policy

| Gate | Cadence | Scope |
| --- | --- | --- |
| Routine development | Every change | Focused unit, integration, type, and architecture checks appropriate to the change; no mandatory browser execution. |
| Staging deployment | Every `main` push | CI structural, security, contract, image, and deployment checks; no browser execution or provider-credit spend. |
| Production release preparation | Manual, owned by the release agent | Flow and Dapr suites, three consecutive ten-process browser passes against development, restart probe, visual review, and provider idempotency evidence. |
| Production release | Published release | Validate the fresh Browser QA records already committed to the release SHA; do not launch a browser in CI or production. |

The browser commands remain agent-executable local tools. The production
workflow checks their immutable records through the Browser QA integrity
validator, while pull-request and staging workflows only validate repository
structure.

## Pass criteria

- All four test layers pass against a migration-initialized database.
- A hard-killed worker is replaceable without rerunning completed operations.
- Commit/ack loss produces one logical operation and one side effect.
- All ten browser/API processes agree across API output, database projection,
  and visible runtime status.
- Test cleanup cancels non-terminal Dapr instances before deleting fixtures.
- No deterministic lane contacts a real third-party provider.
- Any newly enabled remote side effect adds a provider-idempotency failure test
  using `organizationId/runId/nodeId` as the stable logical key.
