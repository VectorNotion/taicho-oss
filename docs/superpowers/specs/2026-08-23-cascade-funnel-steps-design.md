# Cascade Funnel Automation — Design

**Date:** 2026-08-23 (rev 4: the funnel is an automation graph — branches,
do-until loops, goals — reviving the pre-simplification visual builder with
brain-generated touches)
**Status:** Direction approved by Rajesh; spec pending review

## Problem

The 2026-08-03 simplification (`7f4cc031`) deleted Cascade's automation: the
visual workflow builder (`FunnelVisualBuilder` on `@xyflow/react`), typed
steps (email / delay / branch / goal), branch conditions, funnel-to-funnel
routes, and the per-member enrollment cursor. What remains is two flat lists.

A funnel is an **automation graph**: do this touch, wait, *do until they
respond*, **if** they replied positively go here **else** go there, reach a
goal or route into another funnel. The old UI had this shape and it was good;
it must come back — upgraded, because Taicho is now the brain: every touch is
an instruction to a model generated per person from workspace knowledge, and
replies (and even branch conditions) can be read and evaluated by the model.

Delivery stays external (n8n today; executor placement deliberately
deferred). Taicho owns the graph, generation, evaluation, member progress,
and audit — it does not schedule or send.

## The automation model

A funnel is a directed graph of typed nodes with labeled edges, executed per
member as a cursor walk. Node types:

- **Touch** — an instruction to a model; the artifact is generated per
  person when due. Carries a **repeat**: "up to N attempts, every D days,
  until they respond" (rendered as a do-until loop on the node). Bumps are
  fresh generations aware of attempt number and the unanswered thread.
- **Wait** — D days; all due times clamp into the funnel's send window in
  the member's timezone.
- **Branch (if/else)** — a condition with `yes` / `no` edges:
  - *event*: replied, reply classified positive/neutral/negative, clicked,
    opened (clicked/opened only when the executor reports them; the UI marks
    these "needs tracking signals from your sender")
  - *attribute*: contact/account field comparison (title contains, company
    size ≥ …)
  - *brain predicate*: a natural-language condition ("they look
    enterprise", "their reply mentions budget") evaluated by the model
    against the member's knowledge-graph context and funnel thread; the
    evaluation is stored with a rationale and is human-overridable.
- **Goal** — conversion endpoint (this funnel's success); records
  `converted` with the goal outcome.
- **Route** — hand the member to another funnel (enters at its start node),
  reviving the old funnel-to-funnel routing.

Edges carry labels: `next` (default), `yes`/`no` (branch), `responded`/
`exhausted` (touch repeat outcomes). Every node's outgoing edges are total —
the builder refuses to publish a graph with a dangling required edge, a
cycle that contains no wait/touch, or an unreachable node (validation, not
runtime surprise).

**Global safety rails** run before any graph logic, always: unsubscribe
request → unsubscribed (contact-level suppression); bounce → exited
("bounced"); manual moves always win. A reply always interrupts a touch's
repeat loop and follows the `responded` edge (or the default routing below
when no branch consumes it).

**Default reply routing** (when the graph doesn't branch on the reply): the
brain classifies every inbound reply — positive → goal if the funnel's goal
is reply-shaped, else paused for a human with a notification; neutral →
paused with the classifier's note; negative → exited; out-of-office →
snoozed until the parsed return date. Explicit branches downstream consume
classifications instead. Every classification shows its rationale and can be
re-routed by a human.

## 1. Domain model (Postgres `cascade` schema, org RLS like existing tables)

### `funnels` — new columns

goal_type (`reply` / `positive_reply` / `meeting_booked` / `manual`),
goal_description, send_window jsonb (`{days, start_hour, end_hour}`, member
timezone, workspace fallback), auto_approve boolean default false,
reentry_days integer nullable, builder_layout jsonb (node x/y positions —
same shape the old builder persisted).

### New table `funnel_nodes`

| column | type | notes |
| --- | --- | --- |
| id / organization_id / funnel_id | | RLS |
| type | enum: `touch` / `wait` / `branch` / `goal` / `route` | |
| name | text | user-facing label ("Personalized ROI report", "Replied?") |
| config | jsonb | per-type, zod-validated at the capability boundary: touch `{instruction, model?, repeat?: {max_attempts, interval_days}}`; wait `{days}`; branch `{condition}` (discriminated union: event / attribute / brain predicate); goal `{outcome?}`; route `{toFunnelId}` |
| created_at / updated_at | | |

One `entry` node pointer on the funnel (first node members enter).

### New table `funnel_edges`

| column | type | notes |
| --- | --- | --- |
| id / organization_id / funnel_id | | RLS |
| from_node_id / to_node_id | fks | |
| label | enum: `next` / `yes` / `no` / `responded` / `exhausted` | unique (from_node_id, label) |

### `funnel_members` — new columns

current_node_id (fk nullable), attempt integer default 0, status
(`active` / `paused` / `converted` / `exhausted` / `exited` /
`unsubscribed`), status_reason text, entered_node_at timestamptz,
snoozed_until timestamptz nullable. Backfill: existing members → the
funnel's entry node when one exists, else null/unassigned.

### New table `step_outputs`

One row per (member, touch node, attempt): subject/body text, status
(`generated` / `approved` / `sent` / `failed`), generated_at/updated_at,
metadata jsonb (model, credits ref, error). Unchanged from rev 3 except the
node reference.

### New table `funnel_replies`

body, classification (`positive` / `neutral` / `negative` / `ooo` /
`unsubscribe`), classifier_note, routed outcome, node/attempt refs,
received_at. Human reclassification re-runs routing.

### New table `funnel_decisions`

Branch evaluations are auditable: member_id, node_id, condition snapshot,
result boolean, rationale text (brain predicates), decided_at. The people
table's "why is this person here" trace reads from this + events.

### New table `funnel_events` (append-only)

Types: `entered`, `advanced` (edge label in metadata), `generated`,
`approved`, `attempt_sent`, `reply_received`, `reply_classified`,
`branch_evaluated`, `converted`, `routed_to_funnel`, `paused`, `resumed`,
`snoozed`, `exhausted`, `exited`, `unsubscribed`. Powers the activity feed
and all metrics (per-node sends/replies, node→node flow counts, funnel
conversion).

### Graph edits on live members

Edits apply immediately (no versioning in v1 — the old `version` column's
copy-on-write machinery stays out): deleting a node relocates its members
along its `next`-most edge to the nearest surviving node, recorded as
`advanced` with reason. The builder warns with the affected member count
before destructive edits. Versioned drafts are v2.

## 2. The brain's three jobs

New `products/cascade/agent/` (Mastra via `routerModel()`, zod outputs;
credits settle in-request; failures store `failed` + retry in UI):

1. **Touch generation** — `generate_step_touch`: context = workspace
   contact, outreach intelligence when linked, knowledge-API evidence, goal
   description, node instruction, attempt number, and the member's full
   funnel thread (outputs + replies) so the sequence reads as one
   conversation. Regeneration allowed until `sent`.
2. **Reply reading** — `route_reply`: classify + route per the default table
   or hand to a waiting branch; store rationale.
3. **Branch predicate evaluation** — `evaluate_condition`: for brain
   predicates, answer yes/no with a one-line rationale from the member's
   context; recorded in `funnel_decisions`. Event/attribute conditions are
   evaluated in code, never by the model.

## 3. API / MCP surface

All in `packages/capabilities/catalog-cascade.ts` (single-registry rule),
mirrored to `/api/v1` and MCP:

- `cascade.funnel.configure` — goal, send window, auto_approve, reentry
- `cascade.graph.get` / `cascade.graph.put` — read/replace nodes + edges +
  layout as one validated document (the builder saves atomically; server
  validates totality/reachability and returns structured violations)
- `cascade.touch.generate` (memberId? else all due) · `cascade.touch.review`
  (edit/approve) — as rev 3
- `cascade.reply.ingest` (reply|bounce) · `cascade.reply.reroute` — as rev 3
- `cascade.member.move` — set node and/or status/reason; resets attempt
- `cascade.event.record` — executor write-back (`attempt_sent`, clicks/opens
  when available)
- `cascade.funnel.get` — funnel + graph + per-node metrics + members (node,
  attempt, status, computed nextTouch within send window) + recent events +
  unrouted replies

Due computation is one shared helper exposed through `funnel.get` (UI and
executor read the same numbers): member `active`, not snoozed, cursor on a
touch node, next attempt at `entered_node_at + 0` / `last attempt +
interval_days`, clamped into the send window.

## 4. Executor contract (n8n today)

1. Read `funnel.get`; send members whose `nextTouch` is due and `approved`
   (calling `touch.generate` first when no draft exists; `auto_approve`
   makes that one pass).
2. After sending: `event.record` (`attempt_sent`, touch id) — Taicho
   advances the cursor per the graph (repeat loop or `exhausted` edge).
3. Inbound reply/bounce: `reply.ingest`; Taicho classifies, evaluates any
   waiting branch, moves the cursor.
4. Optional: report opens/clicks via `event.record` to power event branches.
No schedulers or delivery state in Taicho; registry idempotency keys apply.

## 5. The page (`/cascade/funnels/[id]`) — builder-first

Dark shadcn design language; §8 checklist. UI language stays human: "If they
replied", "Do until they respond", "what the AI writes" — never "node",
"predicate", or "classifier".

1. **Header** — name; goal, send window, review-mode chips (editable).
2. **Canvas (centerpiece)** — the revived visual builder:
   `products/cascade/components/FunnelVisualBuilder.tsx` +
   `VisualWorkflowBuilder.tsx` restored from `7f4cc031~1`, restyled to
   current tokens, node palette updated to Touch / Wait / If-else / Goal /
   Route. Nodes show live counts (members here now) and per-touch metrics
   (sent, replies); touch nodes wear their repeat badge ("🔁 until they
   respond · max 3 · every 3d"); branch nodes show the condition in plain
   language with labeled yes/no edges. Layout persists to `builder_layout`.
   Publish runs server validation; violations highlight on-canvas.
3. **People** — node ("Waiting at: Case study · attempt 1 of 2"), status
   badge with reason, next-touch column (due + draft state), per-person
   trace drawer (the decision/event history answering "why is this person
   here"), actions: Generate, Review draft, Move, set status.
4. **Replies** — the brain's readings; unrouted/neutral queue for one-click
   human decisions; reclassify anywhere.
5. **Activity** — events feed including branch evaluations with rationales.

The funnel *list* page gains per-funnel conversion and active counts.
Plain-text email library: unchanged CRUD, reachable as source material.
Styleguide composition added as visual proof, per standing practice.

## 6. Consequences and cleanups

- **Dependency:** `@xyflow/react` returns to `apps/unified` (it was removed
  with the old builder).
- **Migrations:** Drizzle migrations for all new tables/columns; RLS +
  forced-RLS parity, actor/request/trace attribution; backfills
  in-migration.
- **Knowledge events:** step/touch adapters as rev 3; replies,
  classifications, and brain-predicate decisions flow into the graph so the
  brain remembers what it said and decided, to whom, and why.
- **Product events:** emit `prospect.replied` on `reply.ingest` at the
  vocabulary's choke-point rules.
- **Docs:** rewrite `products/cascade/CLAUDE.md` (Cascade owns the
  automation graph, generation, evaluation, progress, audit; delivery stays
  external); status notes on ADR 0002 and pending-tasks (this deliberately
  reverses the relevant part of the 2026-08-03 simplification).
- **Tests:** graph validation matrix (totality, reachability, cycle rules),
  cursor-walk repository tests (repeat loops, branch edges, route-to-funnel,
  relocation on node delete), due computation (windows, snooze), routing
  matrix, orchestrator tests with stubbed models (generation,
  classification, predicate), capability tests, e2e (build graph with a
  branch → member walks it → reply converts → metrics update).

## Out of scope (deliberate)

- In-Taicho sending/scheduling; delivery state beyond executor reports.
- Graph versioning / drafts (v2); A/B split nodes (v2).
- Meeting-booked auto-detection (goal exists; marking manual until a
  calendar signal lands).
- Non-email channels (schema doesn't preclude; v1 generates email only).
- Auto-enrollment from the outreach touch list — fast-follow.
