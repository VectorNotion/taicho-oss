# ADR 0002 — Custom Postgres state machine over a workflow engine

**Status:** Accepted (founding proposal, July 2026)

## Context

The engine needs durable scheduling, delays spanning weeks, branching, funnel-to-funnel routing, and concurrent workers. Workflow engines (Temporal, Inngest) provide durability but bring operational weight and their own programming model. The monorepo already runs Postgres (docker-compose) and has a Bree-based job scheduler in `packages/platform/jobs`.

## Decision

Build the engine as a custom state machine over an `enrollments` table in the existing Postgres. Workers claim due enrollments with `SELECT ... FOR UPDATE SKIP LOCKED`, execute one step per transaction, advance the cursor. Idempotency via unique `sends (enrollment_id, step_id)`. Scheduling: pg-boss or the platform Bree scheduler — decided at Phase 1 kickoff (lean pg-boss: the queue state belongs in the same Postgres transaction space as the engine).

## Consequences

- One database holds state and history; the runtime is auditable with SQL.
- Concurrency scales by adding workers; `SKIP LOCKED` prevents contention.
- We own retry semantics, timezone/quiet-hours handling, and the webhook wake-early path.
- **Revisit trigger:** reach for Temporal or Inngest when branches get deep, waits run to months, or replay/audit becomes a hard requirement.

---

**Status update (2026-07-19):** Implemented as decided, except the scheduling sub-question resolved to neither pg-boss nor Bree: the worker (`engine/worker.ts`) is a plain poll loop that wakes every `CASCADE_TICK_INTERVAL_MS` (default 1s) and claims due enrollments with `FOR UPDATE SKIP LOCKED`. The queue state is the `enrollments`/`sends` tables themselves — no job library involved.
