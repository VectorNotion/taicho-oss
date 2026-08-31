# Environment Parity Plan

**Status:** active
**Owner:** platform
**Decision date:** 2026-08-27

## Decision

Taicho has one runtime contract. Local development, pull-request verification,
staging, and production must use the same service topology, package closure,
database-role contract, migration mechanism, and health semantics. Only
credentials, hostnames, replica counts, resource limits, and observability
destinations may differ by environment.

The Dapr automation runtime is the only automation backend. The PostgreSQL
lease worker and the in-process Unified automation host are removed rather than
kept as fallback paths.

## Current gaps

| Contract | Local development | CI | Staging/production | Failure this permits |
| --- | --- | --- | --- | --- |
| Application source | Complete checkout | Complete checkout for tests; pruned image only built | Turbo-pruned image | Undeclared workspace imports pass locally and crash after deployment |
| Automation runtime | Unified in-process worker unless an opt-in Dapr command is used | Dapr tests are optional | Dedicated Dapr worker | The runtime tested is not the runtime deployed |
| Database | Fresh PostgreSQL with a local role bootstrap | Fresh PostgreSQL with a partial role fixture | Long-lived PostgreSQL with accumulated ownership and grants | Fresh migrations pass while upgrades or deployed roles fail |
| Migration execution | Developer command | One migration smoke path | Multiple application entrypoints run migrations during startup | Migration order and application rollout are coupled |
| Deployment health | Process output | Image build and static tests | Kubernetes default readiness for workers | A process can start briefly, crash, and still produce a green rollout |

## Target runtime contract

1. PostgreSQL 16, FalkorDB, Dapr placement, Dapr scheduler, Dapr sidecars,
   Unified, and the dedicated automation worker are the standard topology.
2. Runtime processes use restricted application roles. A separate migration
   identity is available only to the migration job.
3. Every deployable is a Turbo-pruned immutable image. CI runs the final image,
   not an equivalent command from the repository checkout.
4. Dapr is always the automation authority. There is no backend selector and
   Unified never executes automation work in-process.
5. A release is healthy only after migrations, workload readiness, and a
   real API-to-worker smoke complete successfully.

## Delivery plan

### Phase 1 — Remove the second automation system

- Remove `AUTOMATION_EXECUTION_BACKEND` and `AUTOMATION_WORKER_DISABLED`.
- Delete the PostgreSQL lease worker and Unified automation host.
- Make all new manual, webhook, event, and scheduled runs Dapr runs.
- Start local development with the same Dapr topology by default.
- Forward-convert historical runtime metadata and make unfinished legacy runs
  explicitly failed and retryable on Dapr; never execute them with old code.

Acceptance: repository search finds no selectable legacy automation backend;
all automation browser and integration flows report Dapr execution.

### Phase 2 — Enforce production package closure

- Declare every cross-workspace runtime dependency in the importing package.
- Add an architecture rule forbidding repository-root aliases across package
  boundaries unless the target is also a declared workspace dependency.
- Build every final image on pull requests and import its real startup module.
- Run worker images with their production entrypoint against the parity stack.

Acceptance: removing a workspace dependency causes CI to fail before an image
is published, and every published worker image has executed its startup module.

### Phase 3 — Make migrations a release stage

- Move automation schema DDL out of runtime `ensure*Schema` functions and into
  generated, reviewed migrations.
- Build one migration image from the same commit as the application images.
- Run one Kubernetes migration Job before any deployment is changed.
- Remove migration calls from web and worker entrypoints.
- Test both a clean database and an upgrade restored from the currently
  deployed schema snapshot.

Acceptance: application identities cannot perform DDL; a failed migration
prevents rollout; the previous production snapshot upgrades successfully in CI.

### Phase 4 — Use one database-role fixture

- Make the checked-in role contract the sole source for local bootstrap, CI,
  staging validation, and production validation.
- Use the same role names, ownership, `BYPASSRLS` settings, grants, and forced
  RLS checks everywhere.
- Replace CI's hand-written partial role list with the shared bootstrap and
  validation commands.
- Validate the deployed database contract before and after migration.

Acceptance: the same validation command passes unchanged in all four
environments, and CI exercises all runtime and migration identities.

### Phase 5 — Make health mean usable

- Give every worker a startup/readiness contract and a minimum stable period.
- After rollout, assert desired replicas equal available replicas and that no
  application container is restarting.
- Execute one authenticated automation through Unified, Dapr, the worker, and
  PostgreSQL; require a terminal successful run.
- Roll back the release artifact when any health or smoke gate fails. This is
  deployment rollback, not a second application backend.

Acceptance: a missing import, invalid role, failed migration, Dapr disconnect,
or crash loop makes the workflow red and blocks promotion.

### Phase 6 — Promote the same artifact

- Build commit-addressed images once on `main`.
- Deploy those exact digests to staging after all parity gates pass.
- Promote the already-tested digests to production without rebuilding.
- Record image digests, migration version, configuration contract version, and
  smoke evidence in the release record.

Acceptance: staging and production run byte-identical application and migration
images, with environment differences limited to the allowlist in this document.

## Required commands

The end state exposes three supported developer/release commands:

- `pnpm dev`: production-shaped local topology with source mounts and Dapr.
- `pnpm parity`: final immutable images, strict roles, migrations, and smoke.
- `pnpm release:verify`: the same parity checks against an already deployed
  namespace.

No direct or legacy command may silently select a different automation engine,
database identity model, or migration path.

## Completion criteria

This plan is complete only when one commit can be exercised locally, in CI, in
staging, and in production with the same topology and contracts; when migration
upgrade tests use a real prior-release snapshot; and when the release workflow
cannot succeed while any deployed application container is unready or
restarting.
