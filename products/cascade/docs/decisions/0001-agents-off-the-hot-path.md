# ADR 0001 — Agents off the hot path

**Status:** Accepted (founding proposal, July 2026)

## Context

Cascade's value is AI-generated, self-optimizing email content. Agents are non-deterministic, slow, and expensive per call. Sending is bulk, time-sensitive, and must be auditable — "send 50,000 emails at 9am" cannot depend on a model call succeeding.

## Decision

Split the system into two strictly separated halves:

- A **deterministic engine** on the hot path: Postgres-backed state machine over enrollments, executing pre-produced artifacts. It never calls an agent to send.
- An **agent layer** offline: generates templates/content/variants and reads results, on schedules or triggers, never per-send. Hands finished artifacts to the engine through the `variants` tables.

## Consequences

- Authoring (human or agent) is orthogonal to the engine; the deterministic core is built once and trusted.
- The bandit allocator must be deterministic and fast because it lives on the hot path; generation does not.
- Agent failures degrade content freshness, never delivery.
- Everything the agents produce must be expressible as data (artifacts in Postgres), which forces clean interfaces: templates with typed slots, content records, variants with statuses.
