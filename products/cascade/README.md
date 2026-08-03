# Cascade — funnel optimisation

*Working name. The third product in the content-automation system.*

Cascade moves leads through email funnels end to end. A lead enters the system (from the outreach product), is enrolled in an onboarding funnel the moment they arrive, and progresses over weeks of touchpoints. Expressing interest routes them to the next, deeper funnel; finishing a funnel without converting routes them to the newsletter queue — a funnel that runs forever. Email content is drawn from the content engine and optimized by a closed AI loop: agents generate variants, a bandit allocates sends, results feed back, an optimizer breeds the next generation.

## The three-product system

| Product | Role | Cascade's relationship |
|---|---|---|
| `products/content-generator` | Content engine — ideas, drafts, published assets | Cascade **pulls content** through a sync boundary; emails and newsletters are composed from it |
| `products/outreach` | Lead generation — lead research, personas | Cascade **receives leads** and enrolls them into funnels |
| `products/cascade` | Funnel optimisation (this product) | Owns funnels, enrollments, sending, tracking, and the optimization loop |

## The lifecycle

```
lead arrives ──▶ onboarding funnel (4–8 weeks, qualification)
                      │
                      ├─ interest signal ──▶ discovery funnel ──▶ … deeper funnels
                      │                            │
                      └─ funnel ends ──▶ newsletter queue (forever funnel) ──┐
                                               ▲      │ interest signal      │
                                               └──────┴──────────────────────┘
```

Everything is a funnel — including the newsletter, which is an open-ended funnel whose steps are appended over time from the content stream. "Conversion" at this stage of the business is an **interest signal** that promotes a lead to the next funnel (enterprise sales: many touchpoints, long journey). Funnel-to-funnel routing is the core motion.

## Status

**All six phases implemented.** Engine core (Phase 1); sending pipeline with MJML/Handlebars compose, provider-neutral transport, RFC 8058 one-click unsubscribe, and a transactional send loop (Phase 2); tracking ingestion, `branch`/`goal` steps, funnel-to-funnel routing, the open-ended newsletter queue, content-asset sync, lead intake, and rollups (Phase 3); Thompson-sampling variant allocation with per-variant attribution (Phase 4); content/template generation agents behind the validation gate with human approval (Phase 5); and the optimizer that retires losers and breeds the next generation under the autonomy dial (Phase 6). Going live additionally requires the [deliverability runbook](docs/deliverability-runbook.md) (DNS, Postmaster, FBL — operational steps) and an `OPENROUTER_API_KEY` for the agent layer.

## Operator surfaces

- **Product UI** — the Cascade section of `apps/unified`, mounted at `/cascade`. Funnels list and per-funnel detail with workflow-style step add/**edit/delete**, all event and contact-attribute branch conditions, a **people-per-funnel** view (state, current step, next engine action, emails received, last subject), the **funnel-to-funnel routing editor**, and one-click **contact enrollment**. **Template Studio** (`/cascade/templates`) remains the authoring surface. **Email Delivery** (`/cascade/settings`) follows the Outreach connection pattern: a provider catalog and one guided flow for Resend, Twilio SendGrid, or Mailchimp Transactional. The service derives the domain from the sender address, configures signed delivery webhooks, verifies health, and selects the funnel sender behind the flow. Secrets are encrypted at rest and never returned by the API. Experiment APIs and engine behavior remain available for automation and compatibility, but the standalone Experiments UI is not exposed. The UI's `/api/cascade/*` routes import `@content-automation/cascade` directly (workspace dependency) and hit the same Postgres — no HTTP hop to the engine.
- **Operator dashboard** — a read-only, server-rendered snapshot at `http://localhost:3010/dashboard` (auto-refreshes every 5s: funnels, variants, recent sends, event counts, autonomy), served by the worker's own HTTP server alongside unsubscribe, tracking, and webhooks.

## Quickstart

All commands run from the repo root (verified against `package.json`):

```
pnpm cascade:migrate     # apply the idempotent schema (scripts/migrate.ts)
pnpm cascade:seed        # demo funnels, contacts, routes (scripts/seed-demo.ts)
pnpm cascade:worker      # tick + send loops + HTTP on :3010 (dashboard, unsub, tracking, webhooks)
pnpm dev                 # unified app — UI at http://localhost:3000/cascade
pnpm test:cascade        # test suite (needs local Postgres; uses a scratch cascade_test schema)
pnpm test:e2e -- tests/e2e/funnel-business-critical.spec.ts
                         # browser + API + actual-worker funnel release matrix
```

The full funnel matrix and its explicit denominator are recorded in
[`docs/qa/business-critical-e2e-coverage-2026-07-26.md`](../../docs/qa/business-critical-e2e-coverage-2026-07-26.md).
The E2E lane uses deterministic, delivery-free template/model and mail
boundaries while retaining real authentication, authorization, API routes,
queues, workers, PostgreSQL state, tracking, signatures, retries, routing, and
analytics. Production startup rejects those deterministic modes.

Agents run offline, per [ADR 0001](docs/decisions/0001-agents-off-the-hot-path.md): `pnpm --filter @content-automation/cascade agent:generate -- --step <id> --template <id> --from <email> --briefing "..."` generates and validates variants; approve them on the Variants page (or via `approveVariant`), then run `pnpm cascade:optimize` on a schedule to close the loop. The autonomy dial lives in `cascade_settings.autonomy` (`approve_all` default, `auto_activate` to let the optimizer activate validated variants itself) and is settable from the Variants page.

## Documentation map

The founding proposal (written before Cascade moved into this monorepo) is preserved at [docs/proposal.md](docs/proposal.md). The docs below supersede it where they differ — the proposal assumed content authored inside Cascade and purchase-revenue conversion; both changed.

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Two-halves split, execution model, sending pipeline, tracking, operator surfaces |
| [docs/data-model.md](docs/data-model.md) | Postgres schema for the engine |
| [docs/closed-loop.md](docs/closed-loop.md) | Generate → allocate → measure → regenerate; risks |
| [docs/deliverability.md](docs/deliverability.md) | Hard sending rules |
| [docs/deliverability-runbook.md](docs/deliverability-runbook.md) | Operational go-live checklist (DNS, Postmaster, FBL) |
| [docs/roadmap.md](docs/roadmap.md) | The six build phases (all shipped) and post-roadmap additions |
| [docs/decisions/](docs/decisions/) | ADRs, including why Cascade lives in this monorepo |
| [docs/open-questions.md](docs/open-questions.md) | Settled answers and what's still open |
