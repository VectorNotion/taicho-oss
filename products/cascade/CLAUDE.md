# Cascade (products/cascade)

Funnel optimisation — the third product. Leads (from `products/outreach`) chain through email funnels (onboarding → newsletter queue ⇄ discovery → deeper); content comes from `products/content-generator` via a sync boundary; a bandit + optimizer-agent loop improves conversion. Full context: `README.md`, `docs/`.

## Current state

All six roadmap phases are implemented, plus a management UI. What exists:

- **Engine** (`engine/`): tick loop (`tick.ts`) executing `email`/`delay`/`branch`/`goal` steps over `enrollments` with `SKIP LOCKED`; transactional send loop (`send-loop.ts`, retries up to 5 attempts); MJML + Handlebars compose with tracking-link rewrites and the open pixel (`compose.ts`); workspace delivery runtime resolving Resend, Twilio SendGrid, or Mailchimp Transactional plus the verified default sender; Thompson-sampling bandit (`bandit.ts`); funnel-to-funnel routing (`routing.ts`); event ingestion and auto-suppression (`ingest.ts`); HMAC-signed tokens (`tokens.ts`); the engine-owned HTTP surface (`http.ts`: RFC 8058 unsubscribe, open/click tracking, signed workspace provider webhooks, `/healthz`, and the read-only operator dashboard at `/dashboard`).
- **Data** (`data/`): idempotent DDL (`schema.ts`, applied by `scripts/migrate.ts`); repositories for funnels/steps/routes (including step edit/delete with enrollment migration), contacts, enrollments, templates/content/emails, encrypted provider connections/domains/sender identities, variants + `cascade_settings`, asset sync (`StaticContentSource`), outreach lead intake, and rollups. Provider credentials are AES-256-GCM envelopes bound to organization + connection and are never returned through settings summaries. Templates carry an optional `design_json` (Templatical editor document; source of truth when present — raw-MJML edits detach it, and MJML is always re-derived server-side on save via `domain/design-render.ts`). Runtime state is Postgres only (schema `cascade`, `CASCADE_SCHEMA` override) — never the graph store.
- **Agents** (`agent/`): content agent (slot-filling variants grounded in synced assets and the offers table), template agent (MJML layouts with required slot markers), validation gate (`validate.ts`), and the optimizer (`optimizer.ts`: retire losers, breed the next generation, autonomy dial). The LLM boundary is `OpenRouterLlm` in `llm.ts` — a plain-fetch OpenRouter client (`OPENROUTER_API_KEY`; model `CASCADE_MODEL` ?? `MODEL_NAME` ?? `qwen/qwen3.7-plus`), no model SDK, not Mastra. Agents run offline only (scripts, UI routes), never inside the engine.
- **UI**: there is no `ui/` directory here — the product UI lives in `apps/unified/app/cascade` (Funnels + funnel detail, Template Studio, and a separate `/cascade/settings` provider catalog and guided email-service connection flow). Domain, sender, webhook, and funnel-default records are derived behind that flow rather than exposed as separate settings systems. Experiment APIs remain available, but no standalone Experiments page is exposed. API routes in `apps/unified/app/api/cascade/*` import this package directly (workspace dependency `@content-automation/cascade`).

## Invariants — never violate these

- **Agents never on the hot path.** Nothing in the tick/send path calls a model API or reads the graph store / the content engine. The engine renders only from Cascade's own Postgres tables; agents produce artifacts offline.
- **Suppression gate before every send.** Unsubscribes, complaints, hard bounces — checked at enqueue (`tick.ts`) and rechecked at transport time (`send-loop.ts`), no exceptions.
- **No double-send.** `sends` unique on (`enrollment_id`, `step_id`); retries must be idempotent (`ON CONFLICT DO NOTHING`).
- **Generated content is validated, never trusted.** Variants become send-eligible only via the validation gate (asset refs must resolve; offer claims checked against `offers`; template must compile with an unsubscribe link). `activateVariant` refuses anything not `validated` and enforces the 4-arm cap.
- **Providers receive finished HTML only.** No provider-side templating; no provider features leaking through the `Mailer` interface.
- **Deliverability limits are hard constraints** (`docs/deliverability.md`): complaint rate < 0.1%, RFC 8058 one-click unsub, SPF/DKIM/DMARC on a dedicated subdomain.

## Key entry points

- Worker: `engine/worker.ts` — plain poll loop (`CASCADE_TICK_INTERVAL_MS`, default 1s) running tick + send loop, plus the HTTP server on `CASCADE_HTTP_PORT` (default 3010). Root script: `pnpm cascade:worker`.
- Schema: `pnpm cascade:migrate`; demo seeds: `pnpm cascade:seed` (`scripts/seed-demo.ts`) and `scripts/seed-cadence-demo.ts`; `scripts/interest-link.ts` prints an interest-click URL for manual routing tests.
- Agents (offline): `scripts/generate.ts` (`pnpm --filter @content-automation/cascade agent:generate`), `scripts/optimize.ts` (`pnpm cascade:optimize`).
- UI/API: `apps/unified/app/cascade/*` pages, `apps/unified/app/api/cascade/*` routes.
- Package surface: `index.ts` re-exports everything the unified app consumes.

## Tests

`tests/*.test.ts` (node test runner via tsx, serial). Run `pnpm test:cascade` from the repo root, or `pnpm --filter @content-automation/cascade test`. Requires local Postgres; each test drops and recreates a scratch `cascade_test` schema (`tests/helpers.ts`), so it never touches the real `cascade` schema.

## Conventions

Follows the product pattern (`domain/`, `data/`, `agent/`) plus `engine/`, `scripts/`, and `tests/`, with the engine worker as a long-running entry point no other product has. Runtime state in Postgres (Cascade-owned tables), not Neo4j. UI mounts in `apps/unified`.
