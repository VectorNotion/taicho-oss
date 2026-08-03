# ADR 0005 — Cascade lives in the content-automation monorepo as the third product

**Status:** Accepted (product owner decision, July 2026)

## Context

Cascade started as a standalone repo (`../cascade`). The wider system is a three-product family in this monorepo: content engine (`products/content-generator`), lead generation (`products/outreach`), and funnel optimisation (Cascade). Cascade consumes leads from outreach and content from the content engine; the products already compose via workspace dependencies (outreach imports content-generator).

## Decision

Cascade is `products/cascade`, following the product convention (`domain/`, `data/`, `agent/`, `ui/`, `index.ts`), with UI surfaces mounting in `apps/unified`. Two deviations from the pattern, both inherent to the product:

- An **engine worker** entry point — a long-running tick-loop process, which no other product has.
- **Postgres tables** for runtime state instead of Neo4j. Funnel execution is relational and transactional; Neo4j remains the content/context memory of the other products.

The earlier standalone `cascade` repo is superseded and can be deleted once this lands.

## Consequences

- Lead intake and content sync are workspace imports now, real APIs later if products deploy separately — both stay behind interfaces in `products/cascade/data`.
- Cascade inherits monorepo tooling: Turborepo tasks, shared `packages/platform`, `packages/auth`, `packages/ui`, existing Postgres service, Mastra agent stack.
- Cascade's docs live in `products/cascade/docs`; the founding proposal is preserved there.
- The Makerkit-based `editorial-automation` repo is no longer a target for reuse beyond ideas already absorbed (template-with-slots, mailer interface shape).
