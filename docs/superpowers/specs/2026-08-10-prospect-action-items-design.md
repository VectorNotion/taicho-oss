# Prospect Action Items & Touchpoint Tracking — Design

**Date:** 2026-08-10
**Status:** Approved (Rajesh, 2026-08-10)

## Problem

The outreach product has no forward-looking work management. Looking at a prospect
from the outside (e.g. from its account page), you cannot answer:

- When was this prospect last contacted?
- What is the next action item for it?
- When is that action due? Can I snooze it?

On the outreach overview page you cannot answer: what is due today, what was due
yesterday (or earlier), and what is coming up. The current "Your outreach queue"
card fakes a queue with hardcoded status counts.

Contributing gaps in the existing code:

- `Prospect.lastContactedAt` exists but nothing in the app ever sets it; the
  prospect list silently falls back to `createdAt`
  (`apps/outreach/app/outreach/prospects/page.tsx:386`).
- `ProspectActivity` is a retrospective log only — no due date, status, or task
  concept exists anywhere in the product.

## Decision summary

| Decision | Choice |
|---|---|
| Work model | First-class **action item** entity; multiple open items allowed per prospect, UI's "next action" = earliest-due open item |
| Storage | **Postgres table `action_items`** (workflow/operational state belongs in Postgres — like `jobs` and `product_events`; the graph stays knowledge-only). Entity-ref columns hold graph ids, same pattern as `product_events`. |
| Auto follow-up | Marking an outreach message Sent, or logging a contact-type activity, sets `lastContactedAt` on the graph prospect and auto-creates a "Follow up" action item due **+3 days** — only if no open item already references that prospect |
| Overdue scope | Dashboard shows **all** overdue items grouped by age; nothing drops off until done, dismissed, or snoozed |
| Snooze | Moves `due_at`; no separate snooze state |

## Architecture

### 1. Data: `action_items` (shared platform Postgres)

Drizzle schema alongside the existing platform tables, root migration, RLS by
`organization_id` following the `jobs` / `product_events` precedent.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `organization_id` | text, not null | RLS scope |
| `title` | text, not null | |
| `status` | text, not null | `open` \| `done` \| `dismissed`; default `open` |
| `due_at` | timestamptz, not null | snooze = update |
| `source` | text, not null | `manual` \| `auto_followup`; later: agent names |
| `prospect_id` | text, nullable | graph id (entity-ref column) |
| `account_id` | text, nullable | graph id (entity-ref column) |
| `payload` | jsonb, nullable | automation context |
| `created_at` / `updated_at` / `completed_at` | timestamptz | `completed_at` set on done/dismiss |

Index: `(organization_id, status, due_at)` — the dashboard is one ordered scan.

Future targets (content, posts, …) are added as further ref columns or a generic
`entity_type`/`entity_id` pair; not built now.

### 2. Repository: `products/outreach/data/action-item-repository.ts`

Drizzle-based. Functions:

- `createActionItem({ title, dueAt, source, prospectId?, accountId?, payload? })`
- `completeActionItem(id)` — status `done`, `completed_at`. The graph
  `ProspectActivity` of new type `next_action_completed` (item title as
  activity title) is written by the PATCH route after a prospect-referencing
  completion, keeping the repository single-store while the prospect timeline
  keeps history
- `snoozeActionItem(id, newDueAt)`
- `dismissActionItem(id)`
- `updateActionItem(id, { title?, dueAt? })`
- `listDueActionItems({ horizonDays })` — open items with `due_at` before
  `now + horizonDays`, ordered by `due_at`; caller hydrates prospect
  name/company/status from the graph by ids in one lookup
- `getOpenActionItemsForProspect(prospectId)` / `hasOpenActionItemForProspect`

All functions scope by the ambient organization (same resolution the event
spine uses).

### 3. Touchpoint capture (graph side)

- `updateOutreachMessage` marking Sent → set `lastContactedAt = sentAt` on the
  prospect (today it only creates the `outreach_sent` activity).
- `createProspectActivity` with a type in new domain set
  `CONTACT_ACTIVITY_TYPES` = { `outreach_sent`, `call`, `meeting`,
  `comment_sent`, `connection_request_sent`, `reaction_sent` } → set
  `lastContactedAt = activity.createdAt` if newer than current.
- Both hooks then call the action-item repo: if no open item references the
  prospect, insert `{ title: "Follow up with {name}", dueAt: now + 3 days,
  source: 'auto_followup', prospectId }`. Deliberately-set items are never
  overwritten. Cross-store choreography mirrors what `updateOutreachMessage`
  already does when emitting `outreach.sent` to Postgres.
- Failure isolation: the Postgres insert must never fail the graph operation
  (log + continue), same contract as `emitProductEvent`.

### 4. API (internal app routes, org-scoped)

All wrapped in `withProspectOrg`; the new tree is added to the architecture
test `ROOTS` in `tests/architecture/prospect-route-tenant-scope.test.mjs`.

- `GET  /api/outreach/action-items?horizonDays=7` — dashboard payload (hydrated)
- `POST /api/outreach/action-items` — create (title, dueAt, prospectId?)
- `PATCH /api/outreach/action-items/[id]` — edit / snooze / complete / dismiss
  (`{ action: 'complete' | 'dismiss' } | { title?, dueAt? }`)
- `DELETE /api/outreach/action-items/[id]`

Zod validation per the newer-route convention. No external `/api/v1` capability
in this iteration.

### 5. UI (dense, semantic tokens only, per `docs/design-language.md`)

- **Prospect detail** — new `NextActionCard` at the top of the right column
  (above `ActivityTimeline`): earliest-due open item with due badge
  (Overdue N days / Today / date), actions **Done**, **Snooze** (popover:
  Tomorrow, +3 days, Next week, pick date), **Edit**; shows "+N more" when
  multiple items are open. Empty state: "No next action" + set-one input.
- **Account detail** — each row in `AccountProspectsSection` gains
  "last contacted {relative}" (real `lastContactedAt`, em-dash when null),
  next-action title, and due badge — the outside-in account view.
- **Prospect list** — due badge on rows (overdue = destructive tint,
  today = primary tint); last-activity timestamp keeps its current fallback.
- **Overview page** — the hardcoded "Your outreach queue" `ListCard` is
  replaced by a real **"Due"** card with sections **Overdue** (rows labeled
  Yesterday / 2 days ago / date for older), **Due today**, **Upcoming (7
  days)**; each row: prospect name → action title → due label, inline
  Done/Snooze, row click navigates to the prospect. Terminal state:
  "All caught up". Skeletons mirror the final layout; mutations toast via
  sonner; errors leave the view usable.

Date grouping/labeling lives in a pure helper with unit tests.

### 6. Out of scope

- Event-vocabulary changes (v1 frozen; `outreach.sent` / `prospect.replied`
  already fire).
- Notifications/reminders, assignees (single-operator product).
- Agent-created action items (the table's `source`/`payload` columns are the
  seam; wiring agents is future work).
- The unused `getTouchList` qualification route stays untouched.

## Testing

- Repository unit tests: lifecycle (create → snooze → complete/dismiss),
  auto-follow-up guard (no duplicate when an open item exists),
  `completeActionItem` writing the graph activity, `listDueActionItems`
  ordering and horizon.
- Touchpoint tests: marking Sent and contact-type activities set
  `lastContactedAt`; non-contact types don't.
- Pure date-grouping helper tests (Overdue/Today/Upcoming labeling, age labels).
- Architecture test: new route tree added to `ROOTS`.
- Route tests following existing conventions for validation and org scoping.
