# Data model

Cascade-owned tables in the shared Postgres instance, under the `cascade` schema (`CASCADE_SCHEMA` override). The authoritative DDL is `data/schema.ts` (`ensureCascadeSchema`, idempotent, applied by `pnpm cascade:migrate`); this document describes it.

## Content tables

| Table | Purpose | Key fields |
|---|---|---|
| `assets` | Local snapshot of content pulled from the content engine — the sync boundary. | `source_id` (content-engine id, unique), type (video/article/post), title, url, topics jsonb, `published_at`, `synced_at` |
| `templates` | Reusable layout: MJML with named slots, compiled to email-safe HTML on first use and cached. | name (unique), `mjml`, `compiled_html` (cache), optional Templatical design JSON (`design_json`) |
| `content` | Email-level copy: subject/preheader plus slot fills. Slot fills are Handlebars and may reference `assets` (`{{assets.[source-id].url}}`). | name (unique), subject, preheader, `slots` jsonb |
| `emails` | The composed message: template + content + from-identity, plus the designated interest link. | name (unique), `template_id`, `content_id`, `from_email`, `from_name`, `interest_url` |
| `offers` | Source of truth for offer claims — the validation gate rejects variants whose claims aren't backed here. | code (unique), claim, active |

The engine only ever renders from these tables — never from the content engine directly. Sync is a pull through the `ContentSource` interface; see [ADR 0006](decisions/0006-content-synced-from-content-engine.md).

Slot vocabulary in practice: `hero`, `body`, `cta` (subject and preheader are columns on `content`, not slots).
Human-designed templates carry the same markers: the designer's slot blocks derive to `{{{slots.hero}}}`/`{{{slots.body}}}`/`{{{slots.cta}}}` and the unsubscribe footer block to `{{{unsubscribeUrl}}}`, enforced by `validateTemplateSource` at save.

## Delivery configuration tables

| Table | Purpose | Key fields |
|---|---|---|
| `delivery_provider_connections` | One Resend, Twilio SendGrid, or Mailchimp Transactional connection per workspace and provider. Credential JSON is an AES-256-GCM envelope bound to the organization and connection ID; summaries expose configuration booleans, never secrets. The guided UI derives the related domain, sender, webhook, and preferred funnel connection. | `provider`, `credential_ciphertext`, `credential_key_version`, `health_status`, `webhook_status`, `webhook_last_received_at`, `is_default` |
| `delivery_domains` | Provider-owned sending domains and their current DNS verification state. | `provider_connection_id`, `name`, `provider_domain_id`, `status`, `last_checked_at` |
| `delivery_sender_identities` | Human-readable sender names and addresses. A sender inherits verification from its domain and may become the workspace default only after verification. | `provider_connection_id`, `domain_id`, `name`, `email`, `status`, `is_default` |

Provider and sender defaults are workspace-scoped partial unique indexes.
`sends.delivery_provider_id` and `sends.sender_identity_id` preserve the exact
configuration used by the funnel send. Credentials, domains, and senders live
outside the template/content tables by design.

## Flow tables

| Table | Purpose | Key fields |
|---|---|---|
| `funnels` | Flow definition. `open_ended` marks queue-style funnels (the newsletter) whose steps are appended over time. | name, version, `open_ended` |
| `funnel_steps` | Ordered nodes, unique on (`funnel_id`, `position`). | type ∈ {`email`, `delay`, `branch`, `goal`}; `config` jsonb (email: `emailId` ref or inline `subject`/`body`; delay: `seconds`; branch: `condition` + `thenPosition`/`elsePosition`; goal: `outcome`) |
| `funnel_routes` | Funnel-to-funnel routing: which signal promotes a contact where. Unique on (from, outcome). | `from_funnel_id` + outcome ∈ {`completed`, `interest`} → `to_funnel_id` |

Routing makes the lifecycle declarative: onboarding —completed→ newsletter queue; newsletter —interest→ discovery; discovery —interest→ next. A campaign/grouping concept can layer on later; the funnel graph is the core object.

## Audience tables

| Table | Purpose | Key fields |
|---|---|---|
| `contacts` | The people Cascade emails. | email (unique), `outreach_lead_id` (link to `products/outreach`), attributes jsonb, timezone, `subscription_status` ∈ {`subscribed`, `unsubscribed`, `suppressed`} |

There is no `segments` table: variants carry a `segment` column (currently always `'all'`), and rule-based segment membership remains future work — see [open-questions.md](open-questions.md).

## Runtime tables

| Table | Purpose | Key fields |
|---|---|---|
| `enrollments` | The runtime cursor: one row per contact per funnel run. A contact's journey is their chain of enrollments. Frontier parking on open-ended funnels = `current_step_id NULL` + `next_run_at = 'infinity'`. | `funnel_id`, `contact_id`, `current_step_id`, `state` ∈ {`active`, `completed`, `stopped`}, `next_run_at` |
| `sends` | One message instance. **Unique on (`enrollment_id`, `step_id`)** — a retry can't double-send. The email actually sent comes from the bandit-selected variant, or else the step's config. | `enrollment_id`, `step_id`, `variant_id` (bandit attribution), `delivery_provider_id`, `sender_identity_id`, `attempts` (transport retries, max 5), `provider_message_id`, `status` ∈ {`queued`, `sent`, `failed`, `skipped`} |
| `events` | Append-only log. | `contact_id`, `enrollment_id`, `send_id`, type ∈ {`queued`, `sent`, `delivered`, `open`, `click`, `bounce`, `complaint`, `unsub`, `interest`, `convert`}, value, `occurred_at` |

`interest` is the event that drives routing at this stage of the business (enterprise sale — the goal is promotion to the next funnel, not immediate purchase); concretely it is a click on the email's `interest_url`. `convert` with a value stays in the model for when revenue events exist.

Suppression derives from `events` (complaints, hard bounces, unsubs flip `contacts.subscription_status`) and is enforced by the mandatory gate before every send — at enqueue and again at transport time.

## Loop tables (bandit phases)

| Table | Purpose | Key fields |
|---|---|---|
| `variants` | A candidate email for a step (human- or agent-created). | `step_id`, `email_id`, `segment` (default `'all'`), generation, status ∈ {`draft`, `validated`, `active`, `retired`}, `created_by`, `validation_error` |
| `variant_stats` | Per-variant counters feeding the allocator (one row per variant; the segment dimension lives on `variants`). | sends, opens, clicks, interests, conversions, revenue |
| `cascade_settings` | Key/value settings — currently the autonomy dial (`autonomy`: `approve_all` \| `auto_activate`). | key, value jsonb |

`validated` is the hallucination gate: send-eligible only after asset references resolve, offer claims match the `offers` table, and the template compiles with an unsubscribe link. Activation (`validated` → `active`) is capped at 4 arms per (step, segment). See [closed-loop.md](closed-loop.md).

## Analytics

`stage_daily_stats` — re-runnable daily rollups per (day, funnel, step) for dashboards (`runDailyRollup`). Move `events` to ClickHouse past roughly tens of millions of rows.
