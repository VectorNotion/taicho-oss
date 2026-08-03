# Architecture

## Where Cascade sits

Cascade is `products/cascade` in the content-automation monorepo, following the product convention (`domain/`, `data/`, `agent/`), plus one thing no other product has: a long-running **engine worker** (`engine/worker.ts`) that ticks funnels and sends email. UI surfaces mount in `apps/unified` like the other products.

Cascade's runtime state lives in **Postgres** (already in `docker-compose.yml`), in Cascade-owned tables under the `cascade` schema (`CASCADE_SCHEMA` override; tests use `cascade_test`). It does not use the graph store (FalkorDB): funnel execution is relational, transactional, high-write — the graph database stays the content/context memory of the other products.

Two inbound boundaries connect Cascade to the rest of the system:

- **Content sync** — the content engine remains the source of content. Cascade pulls published assets through the `ContentSource` interface (`data/asset-repository.ts`; `StaticContentSource` today, a live content-generator adapter later) and snapshots them into its own `assets` table. The hot path never reads a foreign system. See [ADR 0006](decisions/0006-content-synced-from-content-engine.md).
- **Lead intake** — leads originate in `products/outreach`. `importOutreachLead` (`data/intake.ts`) upserts a Cascade `contacts` row by email (with `outreach_lead_id` back-reference) without ever resurrecting an unsubscribed/suppressed contact; enrolling creates an `enrollments` row in the entry funnel.

## The governing principle: agents off the hot path

Agents are non-deterministic, slow, and expensive per call. They must never sit in the path of "send 50,000 emails at 9am."

**Deterministic engine — runtime, hot path.** A Postgres-backed state machine: enrollments, funnel steps, sends, events, suppression, tracking. It executes artifacts the agents already produced. It never calls a model, and never reads another product's store mid-send.

**Agent layer — offline, decision-time.** Generates templates and content variants (grounded in the synced asset library and the `offers` source of truth) and reads results to decide what to generate next. Runs via scripts/cron or on explicit operator action from the UI, never per-send. The model boundary is `agent/llm.ts` (`LlmClient`), implemented as `OpenRouterLlm` — a plain-fetch OpenRouter client (`OPENROUTER_API_KEY`; model from `CASCADE_MODEL` ?? `MODEL_NAME` ?? `qwen/qwen3.7-plus`), no model SDK; a `StubLlm` serves tests.

Whether authoring is human or agent is orthogonal to the engine. The deterministic core is built once and trusted; agents sit at the edges producing artifacts. See [ADR 0001](decisions/0001-agents-off-the-hot-path.md).

## Execution engine

A state machine over `enrollments` (see [data-model.md](data-model.md)), driven by a plain poll loop — no job library. The worker wakes every `CASCADE_TICK_INTERVAL_MS` (default 1s) and runs one tick plus one send-loop pass.

**The tick loop** (`engine/tick.ts`). Each tick claims up to `CASCADE_BATCH_SIZE` due enrollments, one transaction each:

```sql
SELECT ... FROM enrollments e
JOIN funnel_steps s ON s.id = e.current_step_id
WHERE e.state = 'active' AND e.next_run_at <= now()
ORDER BY e.next_run_at
FOR UPDATE OF e SKIP LOCKED
LIMIT 1;
```

It executes the current step, advances the cursor, and commits. `SKIP LOCKED` lets N workers run concurrently against the same Postgres.

**Step types (actual semantics):**

- `email` — enqueue only: reserve a `sends` row (`ON CONFLICT DO NOTHING` — the retry path can never enqueue twice) and advance the cursor immediately. If the step has active variants, Thompson sampling picks the arm and stamps `sends.variant_id` for attribution. The suppression gate runs first: a non-subscribed contact gets a `skipped` send row, never a real one. Composition and transport belong to the send loop, not the tick.
- `delay` — **the wait gates the NEXT step**: the cursor advances past the delay immediately and `next_run_at` is pushed out by `config.seconds`. A trailing delay therefore completes the funnel instantly — end funnels with `goal` or `email` steps. Fixed seconds only; contact timezone / quiet hours are not implemented.
- `branch` — evaluate a condition (a past event of a given type on this enrollment's sends, or a contact-attribute equality) and jump to an absolute `thenPosition`/`elsePosition`.
- `goal` — terminal for this funnel: complete the enrollment and follow the funnel's route for the configured outcome (`completed` by default, or `interest`).

**Funnel-to-funnel routing is first-class** (`engine/routing.ts`, `funnel_routes` table). Completing a funnel follows its `completed` route; an interest hand-raise (see tracking below) stops the current enrollment and follows the `interest` route, atomically. Routing skips contacts already active in the target funnel. A contact's journey is the chain of their enrollments.

**Open-ended funnels.** The newsletter queue is a funnel with `open_ended = true`: enrollments that run past the last step **park at the frontier** (`current_step_id NULL`, `next_run_at = 'infinity'`) instead of completing. `appendFunnelStep` adds the next step at the end and wakes every parked enrollment. Routing into an empty open-ended funnel frontier-parks the new enrollment directly. Same engine, same tables — the only difference is that the step list grows.

**Idempotency.** `sends` is unique on (`enrollment_id`, `step_id`) — a retry can never double-send.

## Sending pipeline

The tick enqueues; the **send loop** (`engine/send-loop.ts`) transports. It claims queued sends one at a time with `SKIP LOCKED` and, per send:

1. **Suppression recheck** — status may have changed since enqueue; non-subscribed → `skipped`. No exceptions.
2. **Compose** (`engine/compose.ts`) — resolve the email bundle (a bandit-selected variant's email overrides the step's own), compile MJML to HTML (cached per template), render Handlebars slots and subject against contact attributes + synced assets, rewrite external links to signed click-redirects, append the open pixel, generate text/plain, and attach RFC 8058 headers (`List-Unsubscribe`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`).
3. **Resolve delivery settings** — load the current organization-scoped default
   provider and verified sender at execution time. This makes settings changes
   effective without a worker restart. Production fails closed when no healthy
   default is ready; local development may still use `LogMailer`.
4. **Send** — through the `Mailer` interface using `ResendMailer`,
   `SendGridMailer`, or `MailchimpTransactionalMailer`
   ([ADR 0003](decisions/0003-resend-behind-a-provider-interface.md)).
   The provider only ever receives finished HTML. Transport failures leave the
   send queued with `attempts + 1`, up to 5 attempts, then `failed`. The send
   records the provider connection and sender identity used.

## Tracking and events

All tracking runs through HMAC-signed tokens (`engine/tokens.ts`,
`CASCADE_SECRET`) on the engine's HTTP surface: the open pixel
(`GET /o/:token`), the click redirect (`GET /c/:token`), one-click unsubscribe
(`GET`/`POST /u/:token`), and workspace provider webhooks
(`POST /webhooks/delivery/:providerConnectionId`). Resend uses Svix signatures,
Twilio SendGrid uses its timestamped ECDSA signature, and Mailchimp
Transactional uses its exact-URL HMAC signature. Durable receipts deduplicate
provider retries before events normalize to `delivered`, `bounce`, `complaint`,
`open`, or `click`. The legacy deployment-wide
`POST /webhooks/resend` endpoint remains for compatibility.

**The interest signal is a click on the email's designated `interest_url`**: compose flags that one link in the token, ingestion records `click` + `interest`, and `routeOnInterest` immediately stops the enrollment and promotes the contact along the funnel's `interest` route. Complaints and hard bounces auto-suppress the contact and stop their active enrollments.

Dashboard metrics are aggregations over `events` (`funnelMetrics`), with re-runnable daily rollups into `stage_daily_stats` (`runDailyRollup`); ClickHouse remains the escape hatch past tens of millions of rows.

## Operator surfaces

Two, deliberately different:

- **Engine-owned HTTP server** (`engine/http.ts`), started by the worker on `CASCADE_HTTP_PORT` (default 3010). Serves the public endpoints (tracking, unsubscribe, webhooks, `/healthz`) plus a read-only, server-rendered **operator dashboard** at `/` or `/dashboard` — funnels with enrollment states, variants with live interest rates, recent sends, event counts, and the autonomy dial, auto-refreshing every 5s. No product UI lives here.
- **Product UI** in `apps/unified` under `/cascade`: Funnels and per-funnel
  detail; Template Studio; and the separate `/cascade/settings` provider
  catalog and guided email-service connection. The connection flow asks for an
  API key plus the visible sender, then derives the domain and automates provider
  health, signed webhook setup, and the preferred funnel sender. Its
  `/api/cascade/*` route handlers import
  `@content-automation/cascade` directly as a workspace dependency and call the
  same repositories against the same Postgres pool — there is no HTTP hop
  between the UI and the engine.

## Stack

Node/TypeScript · Postgres (existing compose service) · plain poll-loop worker
with `SKIP LOCKED` claims (no pg-boss/Bree — see the status note on
[ADR 0002](decisions/0002-postgres-state-machine-over-workflow-engine.md)) ·
Resend, Twilio SendGrid, and Mailchimp Transactional behind a provider
interface · AES-256-GCM credential envelopes · MJML + Handlebars · OpenRouter
(plain fetch,
`OpenRouterLlm`) for the agent layer · Next.js UI in `apps/unified`.
