# Cascade — Project Proposal

*Working name. Naming is open.*

## Summary

Cascade is an email funnel platform where contacts self-onboard into a funnel and move through it automatically over time, driven by events and delays. Each step sends one email. The content of those emails is generated and optimized by AI agents that read conversion results and regenerate the next batch — a closed loop that improves conversion without a human rewriting copy each cycle.

The system has two halves that stay strictly separated: a deterministic execution engine on the hot path, and an AI agent layer that runs offline. The engine sends email and never calls an agent to do it. The agents generate and select content ahead of time and hand finished artifacts to the engine.

This document is the plan to start building. It covers the architecture, data model, the closed loop, known risks, deliverability rules, the stack, what we reuse from the old `editorial-automation` project, and a build order.

## The core idea

Most funnel tools put a human at the center: the human writes the template, writes the copy, fills the slots, picks the segment. Cascade moves the human to the guardrail level. Agents generate templates and content. A feedback loop decides what works and what to generate next. The human approves and sets limits.

What makes this different from a normal drip tool is the loop, not the sending. The sending is a solved problem. The value is: generate variants, send them, measure conversion, kill losers, breed the next generation from winners, repeat.

## Architecture principle: agents off the hot path

This is the decision that everything else depends on.

Agents are non-deterministic, slow, and expensive per call. They must never sit in the path of "send 50,000 emails at 9am." So the system splits in two:

**Deterministic engine — runtime, hot path.** A Postgres-backed state machine: enrollments, funnel steps, sends, events, suppression, tracking. It executes artifacts the agents already produced. Fast, predictable, auditable. It never calls an agent to send.

**Agent layer — offline, decision-time.** Generates templates, generates and selects content, writes subject/hook/CTA variants, proposes segment strategy, and reads results to decide what to generate next. Runs on a schedule or on triggers. Never per-send.

The payoff: whether authoring is human or agent is orthogonal to the engine. We build the deterministic core once and trust it. The agents sit at the edges producing artifacts and proposals. We are not betting the sending infrastructure on agents behaving.

## Deterministic engine

### Data model

Core tables:

- `templates` — reusable layout (MJML compiled to email-safe HTML) with typed, named slots. One template, many emails.
- `content` — reusable copy: subject, preheader, body, offer, merge variables. One content record, many emails.
- `emails` — the composed message: `template_id` + `content_id` + from-identity binding.
- `campaigns` — goal, status, owner, default audience.
- `funnels` — versioned flow definition, belongs to a campaign, has an entry trigger.
- `funnel_steps` — ordered nodes; type is one of `email`, `delay`, `branch`, `goal`/`exit`; config in jsonb; `email_id` set when type is `email`.
- `contacts` — email, attributes jsonb, timezone, subscription status.
- `segments` — rule jsonb, dynamic membership.
- `enrollments` — the runtime cursor. One row per contact per funnel run: `funnel_id`, `contact_id`, `current_step_id`, `state`, `next_run_at`.
- `sends` — one message instance: `enrollment_id`, `step_id`, `email_id`, `provider_message_id`, `status`. Unique on (`enrollment_id`, `step_id`) so a retry can't double-send.
- `events` — append-only: `queued`, `sent`, `delivered`, `open`, `click`, `bounce`, `complaint`, `unsub`, `convert`, plus value and timestamp.

Variant tables for the loop (see the closed loop section):

- `variants` — a generated candidate for a step: which `email_id`, which segment, generation number, status (`draft`, `validated`, `active`, `retired`).
- `variant_stats` — per-variant, per-segment counters: sends, clicks, conversions, revenue. Feeds the allocator.

### Execution

The engine is a state machine over `enrollments`, driven by a durable scheduler.

The tick loop: a worker claims due rows with `SELECT ... WHERE state='active' AND next_run_at <= now() FOR UPDATE SKIP LOCKED LIMIT n`, executes the current step in one transaction, advances the cursor, commits. `SKIP LOCKED` lets N workers run concurrently on the same Postgres without stepping on each other.

Step types:

- `email` — render, send, write `sends` and `events`, advance.
- `delay` — set `next_run_at`, respecting contact timezone and quiet hours.
- `branch` — evaluate a condition on attributes or past events, pick the next step.
- `goal`/`exit` — terminal. Global exit rules (converted, unsubscribed) are checked before every step.

The engine is both time-driven and event-driven. The scheduler polls for due work. Inbound opens and clicks arrive by webhook and can wake an enrollment early or short-circuit a wait; the scheduler still enforces the deadline.

## Sending pipeline

1. Compose: bind `content` to `template`, resolve merge variables, render MJML to HTML, inline CSS, generate a text/plain part.
2. Suppression gate — mandatory before every send. Check unsubscribes, complaints, hard bounces. No exceptions.
3. Send through a provider abstraction so transport is swappable.

Templates are authored in MJML and compiled in our pipeline, then cached. Per-contact variables are merged at send time with Handlebars. The provider only ever receives finished HTML. It never renders anything, which is what keeps templates portable across providers.

## Tracking and events

Open pixel, signed click-redirect, and provider webhooks all normalize into the `events` table. Complaints and hard bounces automatically write suppressions, wake affected enrollments, and feed analytics.

Dashboard metrics are aggregations over `events` joined to enrollments and steps. At current scale, scheduled rollups into a `stage_daily_stats` table. Move `events` to ClickHouse past roughly tens of millions of rows.

Revenue attribution: the `convert` event carries a value, attributed last-touch within the funnel.

## The closed loop

This is the part that earns the project. Four stages, running continuously.

**1. Generate.** For a given step and segment, an agent generates a small set of variants — subject, hook, CTA, layout. Generated at the segment level, not per individual. (Reasons under Risks.)

**2. Allocate.** The engine sends variants under a Thompson sampling bandit. It explores evenly at first, then shifts traffic toward whatever converts. This is deterministic and fast — it lives on the hot path, the generation does not.

**3. Measure.** Events flow back — open, click, convert with value — and update the bandit's arm weights. Winners get more traffic with no human action.

**4. Regenerate.** An optimizer agent runs nightly or weekly. It reads per-variant, per-segment performance, retires losers, and generates the next generation informed by what won — breeding from winning angles, dropping dead ones.

Generate, allocate, measure, regenerate. The bandit is the inner loop (fast, within a generation). The optimizer agent is the outer loop (slow, across generations), and it's where conversion gains compound. Segments are the unit of learning.

## Risks and design constraints

Four failure modes. Each has a design response, and each response is part of the build, not a later patch.

**Optimizing on the wrong signal.** Conversion is sparse and delayed — a purchase can land three days after the email. Opens and clicks are fast but weak proxies. If the loop optimizes on open rate, it breeds clickbait subjects that tank real conversion. Response: optimize on a leading indicator (click-through, reply) but validate against the lagging true objective (conversion, revenue), and weight the loop toward the money event even though it's noisier.

**Not enough volume to learn.** At a few thousand sends a day, there is not enough sample to resolve 20 variants per step — nothing reaches significance and the loop thrashes. Response: hard cap of 2–4 arms per step per segment. The bandit needs concentration, not breadth, at this scale.

**Hallucinated offers.** An agent inventing a "40% off" that doesn't exist is a liability, not a typo. Response: every generated artifact passes a validation gate before it is send-eligible. Offers and prices are checked against a source of truth, never the model's imagination. Non-negotiable, and cheap to build.

**Deliverability under high content variance.** Wildly different content per send erodes the template-reputation consistency that inbox placement depends on, and pushes toward complaint-rate limits. Response: generate at the segment level to bound variance, and keep the send inside the deliverability rules below.

## Deliverability requirements

These are current rules, not general advice. Build them in from day one.

- Bulk-sender threshold: 5,000+ emails per day to Gmail or Yahoo consumer addresses triggers bulk-sender rules; the classification is permanent once hit. Microsoft added parallel rules for Outlook/Hotmail/Live in May 2025 at the same 5,000/day threshold.
- Required: SPF, DKIM, and DMARC alignment; RFC 8058 one-click unsubscribe (POST, processed within 48 hours; marketing mail only, not transactional).
- Spam complaint rate: keep under 0.1%. Never hit 0.3% — exceeding it loses mitigation support until 7 straight days back under.
- Send from a dedicated subdomain. Enforce the suppression gate hard. Wire up Google Postmaster Tools and the Yahoo Complaint Feedback Loop from day one. Postmaster Tools v2 (since October 2025) reports a binary pass/fail compliance status rather than reputation scores.

## Provider and stack

**Transport: Resend, behind a provider interface.** Resend runs on AWS SES, so DKIM/SPF point at amazonses.com and deliverability is inherited from SES. Used as pure transport — we own contacts, suppression, and event history in Postgres, not in Resend — lock-in is shallow. The send call is thin and wrappable. Exit path if cost matters later: Resend is about $0.40 per 1,000, SES about $0.10 per 1,000; at 500k/month that's roughly $300 vs $50. Switching is a DNS change plus an SDK swap, with the same underlying SES deliverability profile.

**Templates: MJML, compiled in our pipeline.** Resend does not ingest MJML; it takes HTML. We author `.mjml`, compile to HTML, and pass HTML to whatever transport is behind the interface. Templates outlive the provider. MJML has the strongest cross-client compatibility record, including all Outlook versions.

**Stack:**

- Postgres — relational core and events at current scale.
- Redis + pg-boss or BullMQ — scheduler and queue.
- Node/TypeScript worker for the engine.
- Resend for transport, SES as the fallback implementation behind the same interface.
- MJML for templates, Handlebars for merge.
- Agent layer: separate offline service calling the model API, writing `variants` and reading `variant_stats`.

Build vs. buy on the engine: custom Postgres plus pg-boss/BullMQ is right at current scale. Reach for Temporal or Inngest only when branches get deep, waits run to weeks, or replay/audit becomes a hard requirement.

## What we reuse from editorial-automation

The old project is a Makerkit (Next.js + Supabase + Turborepo) newsletter composer. Most of it is boilerplate, and the sending/automation was never built. Two things carry over:

- **The template-with-slots model.** A template is a layout with typed, named slots; content fills the slots. That is exactly the interface between a template agent and a content agent — the template agent produces the layout, the content agent fills the slots. This is the reusable idea.
- **The SaaS shell and mailer abstraction.** Auth, multi-tenant accounts, billing, storage, and a mailer interface with Resend and Nodemailer implementations already exist. The mailer interface matches the provider abstraction above.

What does not carry over: the human-driven composition UI, the flat `frequency` scheduler (newsletter cadence, not a funnel), and the absence of any contacts, events, suppression, or execution engine. Note: the Makerkit base is licensed commercial source — keep the repo private.

## Build order

Phase 1 — Engine core. Data model, enrollment state machine, tick loop with `SKIP LOCKED`, delay and email steps. One funnel, one hardcoded email, no AI. Prove a contact can enter a funnel and receive a scheduled send.

Phase 2 — Sending pipeline and deliverability. Provider interface with Resend, MJML compile-and-merge, suppression gate, subdomain and auth (SPF/DKIM/DMARC), one-click unsubscribe, Postmaster and FBL wiring.

Phase 3 — Tracking and analytics. Open/click/webhook ingestion into `events`, suppression automation, rollups, basic dashboard metrics. Branch and goal/exit step types.

Phase 4 — Static variants and bandit. `variants` and `variant_stats` tables, Thompson sampling allocator, revenue attribution. Human writes 2–4 variants per step. Prove the inner loop lifts conversion.

Phase 5 — Agent generation. Content agent fills slots, template agent produces layouts, validation gate against a source of truth. Human approves before variants go active.

Phase 6 — Closed loop. Optimizer agent reads results, retires losers, generates the next generation. Dial human approval from "approve everything" down to "approve limits, let it run."

The system is useful and sellable at the end of Phase 3 — a real funnel platform. Phases 4–6 are the differentiation.

## Open questions

- One campaign to one funnel, or one campaign holding several funnels. Changes navigation and the switcher.
- Exact definition of `content`: subject + copy + offer, or full block-level content (hero, CTA, footer).
- Primary user: the operator configuring funnels, or a client watching results. Changes the UI emphasis.
- How much autonomy the optimizer gets at launch, and where the human approval gate sits by default.
