# Cascade contributor notes

Cascade (Nurture) owns the **funnel automation graph** as data: typed steps
(touch / wait / branch / goal / route), labeled forward-only edges, a
per-member cursor with status, and an append-only event log. Spec:
`docs/superpowers/specs/2026-08-23-cascade-funnel-steps-design.md`.

- The graph is forward-only — `validateGraph` (`domain/graph.ts`) rejects
  cycles, unreachable steps, and missing required edges; `putGraph` is a
  validated replace-all transaction that relocates stranded members.
- **Execution semantics are pure** (`domain/execution.ts`): send-window
  clamping in the member's timezone, due computation, and the cursor walk
  (attempt repeats, exhausted/responded arrows, branch evaluation, default
  reply routing, global rails). `data/execution-repository.ts` applies walks
  transactionally and owns drafts (`step_outputs`), replies
  (`funnel_replies`), and branch rulings (`funnel_decisions`).
- **The brain's three jobs live in `agent/`** (spec §2): `draftTouch` writes
  each touch fresh per person from the instruction + thread, `readReply`
  classifies inbound replies, `answerPredicate` rules yes/no branches — all
  behind the `CascadeBrain` interface. `mastraBrain()` (OpenRouter via
  `routerModel()`) is production; `CASCADE_BRAIN_MODE=stub` swaps in the
  deterministic keyword brain for dev/e2e (declared in turbo.json globalEnv).
  Orchestrators (`agent/execution.ts`) settle elapsed waits, resolve pending
  decisions, and never throw a model failure into a member's state (failed
  drafts store as `failed` for retry).
- **The platform runs funnels itself** (2026-08-24 direction, reversing
  the external-only stance): `agent/runner.ts` is one pass —
  settle waits, draft due touches, send due approved drafts through
  `delivery/sender.ts` (Resend over raw HTTP via `RESEND_API_KEY` +
  `CASCADE_FROM_EMAIL`; `CASCADE_DELIVERY_MODE=stub` for dev/e2e; no
  provider SDK dependencies), record `attempt_sent`, advance the cursor.
  The background pass registers as a platform job reconciler from
  `apps/unified/instrumentation.ts` (request-kicked plus a
  `CASCADE_RUNNER_INTERVAL_MS` interval, default 60s;
  `CASCADE_RUNNER_DISABLED=1` turns the runner off). Per-funnel
  `run_enabled` (default off) gates the background pass;
  `cascade.funnel.run` runs one pass on demand regardless. No sender
  configured → sends are skipped and reported, never faked.
  **Vocabulary is binding**: funnels *run* and have *steps*; the word
  "automation" belongs exclusively to the dashboard-level Automations
  product (`packages/flow`), which is unrelated to funnels.
- An external executor (n8n) remains fully supported through the same API:
  read the schedule from `funnel.get`, call `touch.generate`, send, and
  write back via `event.record` and `reply.ingest`. Wait steps settle
  lazily on every pass — there is still no per-second tick loop, no
  outbox, and no delivery state beyond `step_outputs.status`.
- Email `name`, `subject`, and `body` in the plain-text library remain
  literal stored text (source material, no longer part of the sequence).
- Starter funnel templates live in `domain/templates.ts` (blank, follow-up
  sequence, reply-driven branch, nurture drip); each build mints fresh node
  ids and must pass `validateGraph` (`tests/funnel-templates.test.ts`). The
  creation page at `/cascade/funnels/new` seeds the chosen template through
  the ordinary `cascade.graph.put` capability and lands in the builder.

Runtime data is Postgres under the `cascade` schema with organization RLS
(ten tables: `funnels`, `funnel_members`, `funnel_nodes`, `funnel_edges`,
`funnel_events`, `step_outputs`, `funnel_replies`, `funnel_decisions`,
`contacts`, `plain_text_emails`). Product UI lives in
`apps/unified/app/cascade`; the visual builder components live in
`products/cascade/components` (consumed via the `@/components/funnel/*`
alias by the unified app and the styleguide demo at `/funnel`). The API
surface is the capability registry (`packages/capabilities/catalog-cascade.ts`)
served through `/api/v1`, mirrored by MCP.

Run `pnpm --filter @content-automation/cascade typecheck` and
`pnpm test:cascade`. Database changes require generated Drizzle migrations and
must retain RLS plus actor/request/trace attribution.
