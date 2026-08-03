# Cascade Phases 2+3: Sending Pipeline and Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Authoring note:** written for same-session inline execution by the plan author; pattern-following code (row mappers, repo boilerplate) is specified as exact deltas against the named Phase 1 files rather than repeated verbatim. All novel logic appears in full.

**Goal:** Real sending pipeline (MJML/Handlebars compose, provider interface with Resend, RFC 8058 one-click unsubscribe, transactional send loop) plus the Phase 3 lifecycle: open/click/webhook event ingestion, suppression automation, `branch`/`goal` steps, funnel-to-funnel routing, open-ended newsletter queue, content-asset sync boundary, lead intake, and daily rollups — proven by an end-to-end lifecycle test.

**Architecture:** The tick loop stays deterministic and never touches transport: email steps *enqueue* a `sends` row and advance. A separate send loop claims queued sends with `SKIP LOCKED`, composes (MJML compiled+cached, Handlebars merge, links rewritten to signed tracking URLs, open pixel appended), rechecks suppression, and calls the `Mailer`. A `node:http` server owned by the engine serves unsubscribe, open-pixel, click-redirect, and provider-webhook endpoints; all normalize into `events`. Routing moves contacts between funnels on `completed`/`interest` outcomes; open-ended funnels hold enrollments at a frontier that `appendFunnelStep` wakes.

**Tech Stack:** existing stack + `mjml@^4`, `handlebars@^4` (only new deps). Resend via `fetch` (no SDK). HMAC tokens via `node:crypto`.

## Global Constraints

- All Phase 1 global constraints continue to apply (schema namespace, env config pattern, `node:test`, commit style, invariants).
- New deps allowed: `mjml@^4.15.3`, `handlebars@^4.7.8`. Resend is called with global `fetch`; no `resend` package.
- **Suppression is checked twice**: at enqueue (tick) and again at transport time (send loop) — a contact who unsubscribes between the two must not receive mail.
- Transport is never called inside a tick transaction. The send loop owns transport; a failed transport leaves the send `queued` (attempts+1) up to 5 attempts, then `failed`.
- Tokens: HMAC-SHA256 over base64url JSON payload, secret from `CASCADE_SECRET` (default `"cascade-dev-secret"`). Format `<payloadB64url>.<sigB64url>`.
- Public URL for links from `CASCADE_PUBLIC_URL` (default `http://localhost:3010`); HTTP port `CASCADE_HTTP_PORT` (default `3010`).
- Env vars added: `CASCADE_SECRET`, `CASCADE_PUBLIC_URL`, `CASCADE_HTTP_PORT`, `RESEND_API_KEY` (optional), `CASCADE_FROM_EMAIL` (default `cascade@example.com`).

---

### Task 1: Schema v2 — composition, routing, assets

**Files:**
- Modify: `products/cascade/data/schema.ts` (append DDL inside `ensureCascadeSchema`)
- Modify: `products/cascade/domain/types.ts`
- Create: `products/cascade/data/email-repository.ts`
- Test: `products/cascade/tests/schema.test.ts` (extend table-list assertion)

New DDL (idempotent, appended in `ensureCascadeSchema` after existing statements):

```sql
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  mjml TEXT NOT NULL,
  compiled_html TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  preheader TEXT,
  slots JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  template_id UUID NOT NULL REFERENCES templates(id),
  content_id UUID NOT NULL REFERENCES content(id),
  from_email TEXT NOT NULL,
  from_name TEXT,
  interest_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS funnel_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_funnel_id UUID NOT NULL REFERENCES funnels(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'interest')),
  to_funnel_id UUID NOT NULL REFERENCES funnels(id),
  UNIQUE (from_funnel_id, outcome)
);
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  topics JSONB NOT NULL DEFAULT '[]',
  published_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stage_daily_stats (
  day DATE NOT NULL,
  funnel_id UUID NOT NULL,
  step_id UUID NOT NULL,
  sends INT NOT NULL DEFAULT 0,
  opens INT NOT NULL DEFAULT 0,
  clicks INT NOT NULL DEFAULT 0,
  interests INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, funnel_id, step_id)
);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS outreach_lead_id TEXT;
ALTER TABLE sends ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
```

**Types added** (`domain/types.ts`): `EmailRecord { id; name; templateId; contentId; fromEmail; fromName: string | null; interestUrl: string | null }`, `AssetInput { sourceId; type; title; url; topics: string[]; publishedAt?: Date }`, `RouteOutcome = "completed" | "interest"`. Email step config union gains `{ emailId: string }`.

**`data/email-repository.ts` produces:**
- `createTemplate(pool, { name, mjml }): Promise<{ id: string }>`
- `createContent(pool, { name, subject, preheader?, slots }): Promise<{ id: string }>` (slots: `Record<string, string>`)
- `createEmail(pool, { name, templateId, contentId, fromEmail, fromName?, interestUrl? }): Promise<EmailRecord>`
- `getEmailBundle(pool, emailId): Promise<{ email: EmailRecord; templateMjml: string; compiledHtml: string | null; subject: string; preheader: string | null; slots: Record<string, string> } | null>` (single JOIN query)
- `cacheCompiledTemplate(pool, templateId, html): Promise<void>`

Steps: extend schema test table list to `["assets","contacts","content","emails","enrollments","events","funnel_routes","funnels","sends","stage_daily_stats","templates"]` → fail → DDL + repo → pass → commit `"Add cascade composition, routing, and asset schema"`.

---

### Task 2: Tokens and compose pipeline

**Files:**
- Create: `products/cascade/engine/tokens.ts`
- Create: `products/cascade/engine/compose.ts`
- Modify: `products/cascade/package.json` (add `mjml`, `handlebars`)
- Test: `products/cascade/tests/tokens.test.ts`, `products/cascade/tests/compose.test.ts`

**`tokens.ts` (full):**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  return process.env.CASCADE_SECRET ?? "cascade-dev-secret";
}

export function signToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string): Record<string, unknown> | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
```

Token payloads used across tasks: unsub `{ t: "unsub", c: contactId }`, open `{ t: "open", s: sendId }`, click `{ t: "click", s: sendId, u: url, i?: 1 }`.

**`compose.ts` produces:**
- `interface ComposedEmail { subject: string; html: string; text: string; from: string; headers: Record<string, string> }`
- `composeSend(pool, args: { sendId: string; emailId?: string; inline?: { subject: string; body: string }; contact: Contact }): Promise<ComposedEmail>`

Semantics (implement exactly):
1. `emailId` path: `getEmailBundle`; compile `templateMjml` with `mjml` (import default `mjml2html`) if `compiledHtml` null, then `cacheCompiledTemplate`. `inline` path: wrap body in a static minimal HTML shell (`<html><body><p>{{body}}</p><p><a href="{{{unsubscribeUrl}}}">Unsubscribe</a></p></body></html>` compiled per-call with Handlebars, no MJML).
2. Handlebars-compile the (cached) HTML and the subject; context: `{ contact: { email, attributes }, slots, preheader, assets, unsubscribeUrl }` where `assets` is a map of `source_id → { title, url }` from the assets table (single `SELECT source_id, title, url FROM assets`), and `unsubscribeUrl = `${publicUrl()}/u/${signToken({ t: "unsub", c: contact.id })}``. Template slot convention: template MJML references `{{{slots.hero}}}` etc.; slot strings themselves are Handlebars-rendered first with the same context (so slots can use `{{assets.x.url}}`).
3. Rewrite every `href="http…"` in the rendered HTML to `${publicUrl()}/c/${signToken({ t: "click", s: sendId, u: originalUrl, ...(originalUrl === interestUrl ? { i: 1 } : {}) })}` — except unsubscribe links (any href already pointing at `/u/`). Regex-based rewrite is acceptable: `/href="(https?:\/\/[^"]+)"/g`.
4. Append open pixel before `</body>`: `<img src="${publicUrl()}/o/${signToken({ t: "open", s: sendId })}" width="1" height="1" alt="" />`.
5. `text`: strip tags from rendered HTML (`html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()`).
6. `headers`: `{ "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }`.
7. `from`: `fromName ? `${fromName} <${fromEmail}>` : fromEmail`; inline path uses `CASCADE_FROM_EMAIL`.
8. Export `publicUrl(): string` (env `CASCADE_PUBLIC_URL` ?? `http://localhost:3010`).

Tests (compose.test.ts, against `freshSchema`): (a) sign/verify roundtrip + tamper returns null (tokens.test.ts); (b) MJML template with `{{{slots.hero}}}` + content slots renders slot text, subject renders contact attribute, links rewritten to `/c/`, pixel `/o/` present, unsub URL in header and html; (c) interest link carries `i:1` in its decoded token, non-interest link doesn't; (d) inline path renders body + unsub link. Commit `"Add cascade token signing and compose pipeline"`.

---

### Task 3: Mailer v2 and Resend transport

**Files:**
- Modify: `products/cascade/engine/mailer.ts` (new `OutgoingEmail` shape, `LogMailer`, add `ResendMailer`, `selectMailer`)
- Modify: `products/cascade/tests/mailer.test.ts`
- Modify: `products/cascade/engine/tick.ts` + `products/cascade/tests/tick.test.ts` only where the old `{ to, subject, body }` shape appears (Task 4 rewrites the email path anyway)

New shapes (full):

```ts
export interface OutgoingEmail {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

export class LogMailer implements Mailer { /* as Phase 1, sent: OutgoingEmail[] */ }

export class ResendMailer implements Mailer {
  constructor(private readonly opts: { apiKey: string; fetchImpl?: typeof fetch }) {}
  async send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: email.from, to: [email.to], subject: email.subject,
        html: email.html, text: email.text, headers: email.headers,
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { id: string };
    return { providerMessageId: data.id };
  }
}

export function selectMailer(): Mailer {
  const key = process.env.RESEND_API_KEY;
  return key ? new ResendMailer({ apiKey: key }) : new LogMailer();
}
```

Tests: LogMailer capture (updated shape); ResendMailer success + non-ok throw via injected `fetchImpl` stub; `selectMailer` returns LogMailer without key. Commit `"Add Resend transport behind the cascade mailer interface"`.

---

### Task 4: Send loop; tick enqueues only

**Files:**
- Create: `products/cascade/engine/send-loop.ts`
- Modify: `products/cascade/engine/tick.ts` (email step: reserve `sends` row `queued`, advance; NO transport, no `sent` event; `TickResult.sent` renamed `queued`)
- Modify: `products/cascade/tests/tick.test.ts` (expectations for queued; walk test asserts sends rows exist with status `queued`)
- Test: `products/cascade/tests/send-loop.test.ts`

**`send-loop.ts` produces** `runSendLoop(pool: Pool, mailer: Mailer, opts?: { batchSize?: number }): Promise<{ sent: number; failed: number; skipped: number }>`. Per iteration (own client+txn):

```sql
SELECT snd.id, snd.enrollment_id, snd.step_id, snd.attempts,
       s.config AS step_config,
       c.id AS contact_id, c.email AS contact_email, c.attributes, c.subscription_status,
       e.funnel_id
FROM sends snd
JOIN enrollments e ON e.id = snd.enrollment_id
JOIN contacts c ON c.id = e.contact_id
JOIN funnel_steps s ON s.id = snd.step_id
WHERE snd.status = 'queued' AND snd.attempts < 5
ORDER BY snd.created_at
FOR UPDATE OF snd SKIP LOCKED
LIMIT 1
```

- Suppression recheck: if `subscription_status !== 'subscribed'` → status `skipped`, count skipped, commit, continue.
- Compose via `composeSend` (emailId from step config if present, else inline subject/body). Compose errors: attempts+1, and if attempts+1 >= 5 → status `failed`; commit; continue.
- Transport OUTSIDE the row transaction is not needed for correctness here (the row is locked, not the enrollment); still, call `mailer.send` inside the claim txn but treat throw as: `UPDATE sends SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'queued' END WHERE id=$1`, commit. On success: status `sent`, `provider_message_id`, insert event `sent`.
- Loop `batchSize` (default 20) times or until no row.

Tick change: email path inserts `sends (enrollment_id, step_id, status) VALUES (..., 'queued') ON CONFLICT DO NOTHING` and advances (idempotency preserved); suppression gate at enqueue keeps writing `skipped` rows.

Tests: (a) queued send + subscribed contact → sent, provider id, `sent` event, LogMailer captured with rewritten links; (b) contact unsubscribed after enqueue → skipped, no mailer call; (c) mailer that always throws → after 5 loop runs status `failed`, attempts 5, no `sent` event; (d) tick walk test updated: emails end `queued`, then `runSendLoop` flushes both. Commit `"Add cascade send loop and make ticks enqueue-only"`.

---

### Task 5: HTTP server with RFC 8058 unsubscribe

**Files:**
- Create: `products/cascade/engine/http.ts`
- Test: `products/cascade/tests/http.test.ts`

**Produces** `createCascadeHttpServer(pool: Pool): http.Server` (node:http). Routes (path prefix matching, 404 otherwise):
- `POST /u/:token` and `GET /u/:token` — verify token `{t:'unsub',c}`; idempotently `UPDATE contacts SET subscription_status='unsubscribed' WHERE id=$1 AND subscription_status='subscribed'`; if a row changed, insert event `unsub` and `UPDATE enrollments SET state='stopped', updated_at=now() WHERE contact_id=$1 AND state='active'`. Respond 200 `"You are unsubscribed."` (GET returns a minimal HTML page, POST returns plain text — RFC 8058 requires POST success).
- `GET /healthz` — 200 `ok`.
- Invalid/tampered token → 400.

Test with `server.listen(0)` + `fetch` against the ephemeral port: unsub POST flips contact, stops active enrollment, writes `unsub` event, is idempotent (second POST → no second event); tampered token → 400. Commit `"Add cascade http server with one-click unsubscribe"`.

---

### Task 6: Tracking ingestion and webhook suppression

**Files:**
- Modify: `products/cascade/engine/http.ts`
- Create: `products/cascade/engine/ingest.ts`
- Test: `products/cascade/tests/tracking.test.ts`

**`ingest.ts` produces:**
- `recordOpen(pool, sendId): Promise<void>` — insert `open` event (contact/enrollment resolved from the send row; missing send → no-op).
- `recordClick(pool, sendId, url, interest: boolean): Promise<{ routed: boolean }>` — insert `click` event; if `interest`, insert `interest` event and call `routeOnInterest` (Task 8; until then a stub export `routeOnInterest = async () => ({ routed: false })` lives in `ingest.ts` and Task 8 replaces it).
- `ingestProviderEvent(pool, evt: { type: string; providerMessageId: string }): Promise<void>` — map `email.delivered→delivered`, `email.bounced→bounce`, `email.complained→complaint`; find send by `provider_message_id`; insert event; for `bounce`/`complaint` run `suppressContact(pool, contactId)`:

```ts
export async function suppressContact(pool: Pool, contactId: string): Promise<void> {
  await pool.query(
    `UPDATE contacts SET subscription_status = 'suppressed' WHERE id = $1 AND subscription_status <> 'suppressed'`,
    [contactId],
  );
  await pool.query(
    `UPDATE enrollments SET state = 'stopped', updated_at = now() WHERE contact_id = $1 AND state = 'active'`,
    [contactId],
  );
}
```

HTTP routes added: `GET /o/:token` → 200 image/gif (1x1 transparent GIF buffer, hardcoded base64 `R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7`) after `recordOpen`; `GET /c/:token` → `recordClick` then 302 `Location: u`; `POST /webhooks/resend` → parse JSON body `{ type, data: { email_id } }` → `ingestProviderEvent(pool, { type, providerMessageId: data.email_id })`, 200.

Tests: open pixel writes `open` event and returns gif content-type; click writes `click` + redirects to original URL; interest click also writes `interest`; webhook bounce suppresses contact + stops enrollment + writes `bounce` event; unknown provider id → 200 no-op. Commit `"Add cascade tracking ingestion and webhook suppression"`.

---

### Task 7: branch and goal steps

**Files:**
- Modify: `products/cascade/domain/types.ts` (StepType union += `"branch" | "goal"`; configs below)
- Modify: `products/cascade/data/schema.ts` (`funnel_steps.type` CHECK += `'branch','goal'` — use `ALTER TABLE funnel_steps DROP CONSTRAINT IF EXISTS funnel_steps_type_check; ALTER TABLE funnel_steps ADD CONSTRAINT funnel_steps_type_check CHECK (type IN ('email','delay','branch','goal'))`)
- Modify: `products/cascade/engine/tick.ts` (execute both types)
- Modify: `products/cascade/data/funnel-repository.ts` (StepInput accepts new types)
- Test: `products/cascade/tests/steps.test.ts`

Configs: `BranchStepConfig { condition: { kind: "event"; type: "open" | "click" | "interest" } | { kind: "attribute"; key: string; equals: string }; thenPosition: number; elsePosition: number }`; `GoalStepConfig { outcome?: "completed" | "interest" }`.

Execution in `executeStep`:
- `branch`: evaluate — event kind: `SELECT 1 FROM events ev JOIN sends snd ON snd.id = ev.send_id WHERE snd.enrollment_id = $1 AND ev.type = $2 LIMIT 1` (enrollment-scoped); attribute kind: compare `contact.attributes[key] === equals` (attributes already claimable — extend `ClaimedRow` with `attributes`). Jump: `UPDATE enrollments SET current_step_id = (SELECT id FROM funnel_steps WHERE funnel_id=$2 AND position=$3), next_run_at = now() ...`; missing target position → treat as completion path via `advance`-style completion.
- `goal`: mark enrollment `completed` (state, cursor NULL) and call `routeEnrollment(client, { contactId, funnelId }, outcome ?? "completed")` (Task 8; until then goal only completes — the test for routing lands in Task 8).

Tests: branch takes then-path when a click event exists for the enrollment, else-path otherwise; attribute branch on `attributes.plan = "pro"`; goal completes the enrollment. Commit `"Add cascade branch and goal steps"`.

---

### Task 8: Routing and the open-ended newsletter queue

**Files:**
- Create: `products/cascade/engine/routing.ts`
- Modify: `products/cascade/engine/tick.ts` (`advance`: completion path calls `routeEnrollment(..., "completed")`; open-ended frontier parking; `ClaimedRow` gains `openEnded` via JOIN funnels)
- Modify: `products/cascade/data/enrollment-repository.ts` (frontier enrollment for empty open-ended funnels)
- Modify: `products/cascade/data/funnel-repository.ts` (add `setFunnelRoute`, `appendFunnelStep`)
- Modify: `products/cascade/engine/ingest.ts` (replace `routeOnInterest` stub)
- Test: `products/cascade/tests/routing.test.ts`

**`routing.ts` produces:**

```ts
export async function routeEnrollment(
  client: PoolClient,
  args: { contactId: string; funnelId: string },
  outcome: "completed" | "interest",
): Promise<{ routed: boolean; toFunnelId?: string }>
```

Looks up `funnel_routes (from_funnel_id, outcome)`; if found, enrolls contact into target (first step due now; if target open-ended with no steps → frontier). Skips if an active enrollment for that contact+target funnel already exists (no duplicate concurrent enrollment).

`routeOnInterest(pool, sendId)`: resolve the send's enrollment (contact, funnel); if a route `(funnel,'interest')` exists: stop that enrollment (`state='stopped'`) and enroll the contact in the target. Runs in one transaction.

**Open-ended semantics:**
- `advance()` when no next step: JOIN told us `openEnded`; if true → `UPDATE enrollments SET current_step_id = NULL, next_run_at = 'infinity', updated_at = now()` (state stays `active`), return `completed: false`; else complete + `routeEnrollment(..., 'completed')`.
- `appendFunnelStep(pool, funnelId, step: StepInput): Promise<FunnelStep>` — insert at `COALESCE(MAX(position),0)+1`, then wake: `UPDATE enrollments SET current_step_id = $stepId, next_run_at = now(), updated_at = now() WHERE funnel_id = $1 AND state = 'active' AND current_step_id IS NULL`.
- `enrollContact`: if funnel has no steps AND `open_ended` → insert frontier enrollment (`current_step_id NULL, next_run_at 'infinity'`); non-open-ended keeps throwing.
- `setFunnelRoute(pool, fromFunnelId, outcome, toFunnelId)` — upsert on the unique pair.

Tests: completed funnel routes contact into next funnel automatically; interest click stops current enrollment and enrolls into interest target; enrollment parks at frontier of exhausted open-ended funnel and `appendFunnelStep` wakes it (tick then queues the new email); no duplicate enrollment when routed twice. Commit `"Add cascade funnel routing and open-ended queues"`.

---

### Task 9: Assets, lead intake, rollups

**Files:**
- Create: `products/cascade/data/asset-repository.ts` (`syncAssets(pool, source: ContentSource)`, `interface ContentSource { listPublished(): Promise<AssetInput[]> }`, `class StaticContentSource implements ContentSource` taking `AssetInput[]`)
- Create: `products/cascade/data/intake.ts` (`importOutreachLead(pool, { email, outreachLeadId, attributes? }): Promise<Contact>` — upsert by email, sets `outreach_lead_id`)
- Create: `products/cascade/data/rollups.ts` (`runDailyRollup(pool, day: string): Promise<void>` and `funnelMetrics(pool, funnelId): Promise<Array<{ stepId: string; position: number; sends: number; opens: number; clicks: number; interests: number }>>`)
- Test: `products/cascade/tests/analytics.test.ts`

`syncAssets`: upsert each `AssetInput` on `source_id` (`INSERT ... ON CONFLICT (source_id) DO UPDATE SET title/url/type/topics/published_at/synced_at`).

`runDailyRollup(pool, day)` (single INSERT..SELECT, re-runnable):

```sql
INSERT INTO stage_daily_stats (day, funnel_id, step_id, sends, opens, clicks, interests)
SELECT $1::date, e.funnel_id, snd.step_id,
       count(*) FILTER (WHERE ev.type = 'sent'),
       count(*) FILTER (WHERE ev.type = 'open'),
       count(*) FILTER (WHERE ev.type = 'click'),
       count(*) FILTER (WHERE ev.type = 'interest')
FROM events ev
JOIN sends snd ON snd.id = ev.send_id
JOIN enrollments e ON e.id = snd.enrollment_id
WHERE ev.occurred_at >= $1::date AND ev.occurred_at < $1::date + 1
GROUP BY e.funnel_id, snd.step_id
ON CONFLICT (day, funnel_id, step_id) DO UPDATE SET
  sends = EXCLUDED.sends, opens = EXCLUDED.opens,
  clicks = EXCLUDED.clicks, interests = EXCLUDED.interests
```

`funnelMetrics`: live aggregation of the same joins for one funnel grouped by step, ordered by position.

Tests: sync upserts (second run updates title, no duplicate); intake upserts contact by email with lead id; rollup after a sent+open+click day matches counts and re-run doesn't duplicate; funnelMetrics returns per-step counters. Commit `"Add cascade assets, lead intake, and rollups"`.

---

### Task 10: Worker wiring, lifecycle e2e, demo v2, docs

**Files:**
- Modify: `products/cascade/engine/worker.ts` (also run `runSendLoop` each iteration with `selectMailer()`; start HTTP server on `CASCADE_HTTP_PORT`)
- Modify: `products/cascade/index.ts` (export new API: compose, tokens, send loop, http, ingest, routing, assets, intake, rollups, email repository)
- Modify: `products/cascade/scripts/seed-demo.ts` (Phase 2/3 demo: template+content+email, onboarding funnel with interest link, newsletter queue + route, discovery funnel + interest route)
- Create: `products/cascade/docs/deliverability-runbook.md` (operational checklist: subdomain choice, SPF/DKIM/DMARC records from Resend dashboard, RFC 8058 verification, Postmaster Tools v2 + Yahoo CFL signup, complaint-rate monitoring thresholds 0.1%/0.3%, 5k/day bulk-sender note)
- Modify: `products/cascade/README.md` (status → Phases 1–3)
- Test: `products/cascade/tests/lifecycle.test.ts`

**Lifecycle e2e test (the Phase 3 exit criterion, in-process — no live worker needed):**
1. Seed: onboarding funnel (email A with `interestUrl` link → goal), discovery funnel (email B), newsletter queue (`open_ended`, empty), routes: onboarding—completed→newsletter, onboarding—interest→discovery. Template+content+email records for A and B; contact imported via `importOutreachLead`.
2. `runTick` → A queued; `runSendLoop(LogMailer)` → A sent; extract the interest link token from LogMailer html; `recordClick(pool, sendId, url, true)` → interest event → contact stopped in onboarding, enrolled in discovery; `runTick`+`runSendLoop` → B sent.
3. Second contact: enroll in onboarding, tick through goal without interest → routed to newsletter queue (frontier, since queue empty).
4. `appendFunnelStep(newsletter, email step)` → frontier wakes; tick+send → newsletter email sent to contact 2.
5. Assert the full event trail and enrollment states; `runDailyRollup` for today and assert `stage_daily_stats` rows.

Worker/demo verification: run `pnpm cascade:seed && pnpm cascade:worker` in background, curl the click-redirect URL for the interest link, observe routing to discovery live; document commands in README quickstart.

Commit `"Wire cascade worker for phases 2-3 and prove the lifecycle end to end"`.

---

## Exit criteria → proof map

| Criterion | Proof |
|---|---|
| Real templated email with merge + unsub headers | Task 2 compose tests + Task 4 send-loop capture |
| Suppressed contact provably never sent to | Task 4 recheck test + Task 6 webhook suppression test |
| Unsubscribe round-trips (RFC 8058 POST) | Task 5 http test |
| Opens/clicks/bounces/complaints normalized into `events` | Task 6 tests |
| Hard bounce auto-suppresses | Task 6 webhook test |
| Interest click routes lead to a second funnel | Task 8 + Task 10 lifecycle test |
| Completed funnel routes to newsletter queue; appended step sends to waiting enrollments | Task 8 + Task 10 lifecycle test |
| Rollups/dashboard metrics | Task 9 tests (UI deferred; metrics API exists) |
| SPF/DKIM/DMARC, Postmaster, FBL | Task 10 runbook (operational, needs domain + accounts — cannot be automated from code) |
