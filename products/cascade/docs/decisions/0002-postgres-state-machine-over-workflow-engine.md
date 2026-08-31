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

---

**Status update (2026-08): Superseded.** The engine was removed entirely by the 2026-08-03 simplification (`7f4cc031`, "Simplify Cascade to static funnel lists"); the `enrollments`/`sends` tables were dropped. Cascade is now a CRUD-only people-list and text-email store with no execution process — external automation (n8n) owns delivery. This ADR is retained as history.

---

**Status update (2026-08-24): Structure restored as data, not engine.** Funnel structure returned as a forward-only automation graph (`funnel_nodes`/`funnel_edges`, per-member cursor on `funnel_members`, append-only `funnel_events`) per the spec `docs/superpowers/specs/2026-08-23-cascade-funnel-steps-design.md`. Deliberately unlike the original engine: there is no worker, scheduler, or delivery state in Taicho — the graph is authored in the restored visual builder and executed externally (n8n reads it and writes progress back through the capability registry). Touch generation and reply routing by the brain are the next phase.

---

**Status update (2026-08-24, later): The brain phase landed — still no engine.** Touch generation, reply classification, and branch-predicate evaluation now run in `products/cascade/agent/` (Mastra over OpenRouter, `CASCADE_BRAIN_MODE=stub` for dev/e2e); `step_outputs`/`funnel_replies`/`funnel_decisions` store what the AI writes, hears, and rules. Progress remains executor-driven: the sender calls `touch.generate`, sends approved drafts, reports through `event.record`/`reply.ingest`, and Taicho walks the cursor (`domain/execution.ts`, applied transactionally by `data/execution-repository.ts`). Wait steps settle lazily on read/write paths — the "no scheduler" line still holds. The 1s-tick worker of the original design stays dead.

---

**Status update (2026-08-24, evening): The automations come home.** At Rajesh's direction the platform now executes enabled funnels itself: `runCascadeAutomationPass` (registered as a platform job reconciler from unified instrumentation, request-kicked plus a coarse interval) drafts due touches and sends approved drafts through a provider seam (Resend / stub), then records `attempt_sent` so the cursor walks. This is still not the 2026-07 engine: no 1s tick, no `enrollments`/`sends` queue tables, no per-step transactions racing workers — one guarded, best-effort pass over `automation_enabled` funnels, with the external-executor API unchanged for anyone who prefers n8n. The revisit trigger from the original decision stands.

---

**Status update (2026-08-24, night): renamed — funnels run, Automations are a different product.** The in-platform pass above is the *funnel runner* (`agent/runner.ts`, `run_enabled`, `cascade.funnel.run`, `CASCADE_RUNNER_*`); the earlier "automation" naming was retired because Automations are the restored dashboard-level workflow product (`packages/flow`, `/automations`), which is unrelated to funnel step-walking.
