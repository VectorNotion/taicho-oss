# Roadmap

Six phases, **all shipped**. The system became a usable funnel platform at the end of Phase 3; phases 4–6 are the differentiation. Exit criteria are preserved below as the acceptance record; the test suite (`pnpm test:cascade`) exercises them.

## Phase 1 — Engine core ✅

**Shipped:** `enrollments` state machine, tick loop with `SKIP LOCKED` (`engine/tick.ts`), `delay` and `email` steps, idempotent schema (`data/schema.ts`).

Cascade schema in the shared Postgres, enrollment state machine, tick loop with `SKIP LOCKED`, `delay` and `email` steps. One funnel, one hardcoded email, no AI, no content sync.

**Exit criterion:** a contact enters a funnel and receives a scheduled send; a retried tick cannot double-send; two workers run concurrently without conflict.

## Phase 2 — Sending pipeline and deliverability ✅

**Shipped:** `Mailer` interface with `ResendMailer`/`LogMailer`, MJML + Handlebars compose with cached compiles, suppression gate at enqueue and transport, RFC 8058 one-click unsubscribe, transactional send loop with bounded retries. DNS/Postmaster/FBL remain operational steps — see the [deliverability runbook](deliverability-runbook.md).

Provider interface with Resend, MJML compile-and-merge, suppression gate, dedicated subdomain with SPF/DKIM/DMARC, RFC 8058 one-click unsubscribe, Postmaster Tools and Yahoo FBL wiring.

**Exit criterion:** a real templated email delivers from the authenticated subdomain; a suppressed contact is provably never sent to; unsubscribe round-trips within the compliance window.

## Phase 3 — Tracking, routing, and the lifecycle ✅

**Shipped:** signed open/click tracking and webhook ingestion into `events`, auto-suppression on bounce/complaint, `branch`/`goal` steps, `funnel_routes` with interest routing (`routeOnInterest`), open-ended funnels with frontier parking and wake-on-append, asset sync (`syncAssets`), outreach lead intake (`importOutreachLead`), and rollups (`runDailyRollup`, `funnelMetrics`).

Open/click/webhook ingestion into `events`, suppression automation, rollups, basic dashboard metrics in `apps/unified`. `branch` and `goal`/`exit` steps, **funnel-to-funnel routing** (`funnel_routes`, `interest` events), **open-ended funnels** (the newsletter queue), **content sync** (`assets` pulled from the content engine), and lead intake from outreach.

**Exit criterion:** a lead from outreach enters the onboarding funnel, an interest click routes them to a second funnel, a completed funnel routes them to the newsletter queue, and a newly appended newsletter step sends to waiting enrollments. **The lifecycle runs end to end here.**

## Phase 4 — Static variants and bandit ✅

**Shipped:** `variants`/`variant_stats`, Thompson sampling over interest-per-send (`engine/bandit.ts`), arm selection stamped on `sends.variant_id` at enqueue, per-variant attribution of opens/clicks/interests, 4-arm cap per step/segment.

`variants` and `variant_stats`, Thompson sampling allocator, interest attribution. A human writes the 2–4 variants per step.

**Exit criterion:** the bandit demonstrably shifts traffic toward the variant with the higher interest rate on a live funnel — proof the loop lifts progression before any AI is involved.

## Phase 5 — Agent generation ✅

**Shipped:** content agent (`agent/content-agent.ts`) grounded in synced assets and the `offers` table, template agent (`agent/template-agent.ts`) with required slot markers and strict compile, the validation gate (`agent/validate.ts`: asset refs, offer claims, compile + unsubscribe link), and human approval via the Variants page or `approveVariant`.

Content agent fills slots from the asset library, template agent produces layouts, validation gate against a source of truth. Human approves before variants go active.

**Exit criterion:** an agent-generated variant passes validation, is approved, sends, and its stats flow back — with the gate demonstrably rejecting an invalid offer and a dangling asset reference in testing.

## Phase 6 — Closed loop ✅

**Shipped:** the optimizer (`agent/optimizer.ts`, run via `pnpm cascade:optimize`): retires arms below half the winner's interest rate (minimum 50 sends), breeds the next generation from the winner's angle, and obeys the autonomy dial (`cascade_settings.autonomy`: `approve_all` default, `auto_activate` to let it activate validated variants itself, still capped at 4 arms).

Optimizer agent reads results, retires losers, generates the next generation. Dial approval from "approve everything" toward "approve limits, let it run."

**Exit criterion:** one full generate → allocate → measure → regenerate cycle completes without human copywriting, under human-set limits.

## Post-roadmap additions

Built after the six phases, outside the original plan:

- **Management UI** in `apps/unified` (`/cascade` + `/api/cascade/*` routes calling the package directly): funnels CRUD, people-per-funnel view, routing editor, contact enrollment, Emails page, Variants page with approve/retire and the autonomy dial.
- **Template Studio** (`/cascade/templates`): AI MJML generation from a briefing with validation (required slot markers, strict compile), plus a live preview that recompiles as you type.
- **Operator dashboard** served by the worker at `:3010/dashboard` — read-only, server-rendered, auto-refreshing.
- **Step editing and deletion** (`updateFunnelStep`, `deleteFunnelStep`): config edits in place; deletion refuses steps with send history or attached variants, migrates enrollments to the following step (or completes/frontier-parks them), renumbers positions, and warns when branch steps may need their jump targets reviewed.
- **Funnel deletion** for never-used funnels (no enrollment history, no variants).
