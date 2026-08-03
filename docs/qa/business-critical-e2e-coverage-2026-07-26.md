# Business-critical E2E coverage report

**Project:** Taicho / content-automation

**Assessment date:** 26 July 2026

**Status:** Green for the deterministic workflow gate, the live OpenRouter
workflow-provider gate, and the complete business-critical funnel gate

## Executive answer

The business-critical workflow and funnel surfaces are now covered end to end
across the real browser, authentication and authorization, API routes, durable
queues and workers, PostgreSQL state, tenant boundaries, tracking, compliance,
analytics, credit accounting, and execution history.

The percentages below use explicit product-behaviour denominators. They are
scenario coverage, not source-code line coverage or a claim that every possible
input combination has been enumerated.

| Feature named | Tested | Basis |
|---|---:|---|
| Workflow triggering | **100%** | 4/4 supported trigger mechanisms: manual, signed webhook, product event, and schedule |
| Workflow creation and saving | **100%** | 8/8 critical lifecycle behaviours: browser creation, naming/configuration, adding/removing steps, connecting steps, saving, reloading, publishing, and running/inspecting |
| Workflow step coverage | **100%** | 13/13 built-in workflow node types execute; additionally, 7/7 Product Action choices exposed by the workflow editor execute |
| Durable execution lifecycle | **100%** | Success, approval/resume, delay/resume, retry scheduling, terminal failure/dead letter, cancellation, and rerun are covered |
| Agent/provider technical path | **100% of the release gate** | Deterministic agent orchestration is covered and the configured live OpenRouter gate passed 1/1 |
| Model-output quality breadth | **Not represented by an E2E percentage** | One live route proves integration; semantic quality across models and prompts requires a separate evaluation matrix |
| Funnels / Nurture overall | **100%** | 77/77 explicitly enumerated business-critical funnel behaviours across authoring, execution, variants, optimization, routing, tracking, compliance, analytics, and access boundaries |
| Funnel step configurations | **100%** | 9/9 supported configuration families: composed email, inline email, delay, attribute branch, open/click/interest event branches, completed goal, and interest goal |
| Funnel tracking and provider events | **100%** | 21/21 defined routing, public tracking, unsubscribe, signed webhook, live metric, rollup, and dashboard behaviours |

## The important yes/no answer

**No — the LLM is not the only blocker to testing the agent.**

The live provider run actually found an organization-context defect in the workflow worker *before* the request reached the model. Other independent failure points include authentication and tenant fixtures, entitlements, credit reservation and settlement, queue/worker availability, PostgreSQL and graph services, secrets, provider rate limits, and nondeterministic model behaviour.

The LLM is the main source of nondeterminism for semantic output quality. It is not the main blocker for testing the surrounding E2E orchestration.

## What is real, and what is substituted

| Boundary | Default deterministic E2E lane |
|---|---|
| Browser UI and navigation | Real |
| Authentication, RBAC, entitlements, tenant isolation | Real |
| API requests and webhook signature verification | Real |
| Durable queue, worker claim, retries, cancellation, approval and resume | Real |
| PostgreSQL persistence and execution history | Real |
| Graph organization boundary | Real |
| Credit reservation, settlement and release | Real |
| Publishing receiver and HMAC verification | Real |
| Outreach-to-Nurture and other cross-product handoffs | Real |
| Funnel email orchestration, suppression, retries and history | Real |
| Third-party funnel email delivery | Deterministic delivery-free substitute |
| LLM text/tool computation | Deterministic non-production substitute |

The separate provider gate disables the workflow substitute and sends a real request through OpenRouter. It passed using the official `openrouter/free` router, completed the workflow, persisted the model output, and settled the 30-credit agent charge. The current model catalog and free router are discoverable from [OpenRouter Models](https://openrouter.ai/models) and [OpenRouter Free](https://openrouter.ai/openrouter/free).

## Funnel coverage in detail — 77/77

The overall funnel percentage uses the six categories below. A behaviour is
counted once, in the category that owns its primary risk.

### Authoring and administration — 17/17

1. Deterministic streamed template generation.
2. Raw-code template creation.
3. Raw-code template update.
4. Raw-code template preview.
5. Visual template loading.
6. Visual template preview.
7. Visual template save/update and design-JSON round trip.
8. Slot and unsubscribe-marker preservation.
9. Content-library item creation.
10. Composed message creation.
11. Composed message preview.
12. Closed sequence creation.
13. Open-ended queue creation.
14. Step append through the browser.
15. Every step editor persists its configuration.
16. Middle-step deletion safely renumbers positions.
17. Completed/interest route administration and fresh-funnel deletion.

### Supported step configuration families — 9/9

1. Composed/library email.
2. Inline subject-and-body email.
3. Durable delay.
4. Contact-attribute branch, with both paths executed.
5. Open-event branch, with both paths executed.
6. Click-event branch, with both paths executed.
7. Interest-event branch, with both paths executed.
8. Completed goal.
9. Interest goal.

### Actual worker and lifecycle invariants — 10/10

1. Actual Cascade worker discovery and claim.
2. Sequential execution across all four step types.
3. Enrollment idempotency.
4. Open-ended frontier parking.
5. Frontier wake-up when a step is appended.
6. Frontier re-parking after the appended issue drains.
7. Mandatory suppression check before transport.
8. Five transport attempts and terminal failure.
9. Retry safety: an enrollment-step pair cannot double-send.
10. Send/enrollment history guards for destructive step, funnel, and variant operations.

### Variants, grounding, and optimization — 12/12

1. Draft variant creation.
2. Successful validation.
3. Compliance validation rejection.
4. Approval and activation.
5. Active-arm allocation stamped onto the send.
6. Engagement attribution and variant statistics.
7. Active variant retirement.
8. Unsent non-active variant detachment.
9. Sent variant history protection.
10. Four-active-arm cap.
11. Grounded asset and offer synchronization/generation.
12. Offline optimizer under both `approve_all` and `auto_activate` autonomy modes.

### Routing, tracking, compliance, and analytics — 21/21

1. Completion routing.
2. Interest routing.
3. Open pixel and GIF response.
4. Ordinary click redirect.
5. Interest click redirect and stop/reroute.
6. Tampered tracking-token rejection.
7. POST unsubscribe.
8. Browser GET unsubscribe.
9. Unsubscribe idempotency.
10. Delivered provider webhook.
11. Duplicate provider-webhook suppression.
12. Bounce webhook and suppression.
13. Complaint webhook and suppression.
14. Forged-signature rejection.
15. Stale-signature rejection.
16. Malformed-payload rejection.
17. Oversized-payload rejection.
18. Unknown provider-ID acceptance without mutation.
19. Live per-step metrics.
20. Tenant-aware, re-runnable daily rollup.
21. Operator dashboard rendering.

### Authentication and boundary behaviour — 8/8

1. Unauthenticated denial.
2. Viewer read access.
3. Viewer mutation denial.
4. Owner mutation access.
5. Missing-entitlement denial.
6. Expired-plan denial.
7. Malformed UUID and payload rejection.
8. Cross-funnel ownership guards and self-route rejection.

## Workflow coverage in detail

### Triggers — 4/4

- Manual browser execution.
- Signed public webhook, including valid delivery, duplicate idempotency, forged signature, stale replay, malformed JSON, and oversized payload rejection.
- Product event delivery and duplicate suppression.
- Scheduled execution through the real maintenance enqueue and worker path. The test makes the schedule immediately due instead of waiting for wall-clock cron time.

### Built-in step types — 13/13

- `trigger.manual`
- `trigger.schedule`
- `trigger.webhook`
- `trigger.event`
- `agent`
- `op.queryBrain`
- `op.filter`
- `op.setData`
- `control.branch`
- `control.delay`
- `control.approval`
- `action.product`
- `out.deliver`

Both branch directions execute. Delay persistence and approval/resume execute through the worker. The result artifact and durable run log are inspected from the browser and survive reload.

### Product Action choices — 7/7

- `do_research`
- `extract_topics`
- `generate_content_ideas`
- `refine_content_idea`
- `generate_content_draft`
- `research_lead`
- `qualify_lead`

These execute through the actual queue, worker, persistence, entitlement, and billing boundaries. Only their external generative/action computation is deterministic in the default lane.

## Wider business journeys covered

- API-created lead through the workspace and manual outreach.
- Content idea to draft, signed HTTP publishing, and calendar history.
- Nurture composition, variant validation, and real lead enrollment.
- Cross-product workspace handoffs and mobile navigation.
- Shared authentication and RBAC across unified, outreach, and content deployments.
- Expired plan, exhausted wallet, and missing-entitlement boundaries.
- Deterministic conversational UI streams after real auth, thread persistence, and billing.
- Accessibility checks, empty/error/loading dashboard states, and stable shared authentication visuals.

## Verification evidence

| Gate | Result |
|---|---|
| Comprehensive funnel browser + actual-worker suite | **6/6 passed together, 0 failed** in 3.3 minutes |
| Cascade unit/integration suite | **81/81 passed, 0 failed** in 6 minutes 41 seconds |
| Existing nurture launch journey | **1/1 passed, 0 failed** in 48.3 seconds |
| Authorization policy suite | **14 passed, 1 explicitly skipped integration case, 0 failed** |
| Architecture boundary suite | **62/62 passed, 0 failed** |
| Affected workflow regression | **9/9 scenarios green**: 8 passed together; the corrected cold-start editor case passed separately in 35.2 seconds |
| Live OpenRouter workflow-provider gate | **1 passed, 0 failed**; real provider execution completed in 33.6 seconds |
| Supported root typecheck | **All supported workspace scopes passed** |

The local verification machine is running Node 26.3.0 while the repository declares Node 24. CI uses Node 24. This produced an engine warning but did not cause a failing gate. Schema preparation also reports the existing Better Auth `rateLimit.lastRequest` `int8` compatibility warning.

## Defects found and fixed during this pass

- JSONB values could be persisted with the wrong representation in workflow run state.
- Terminal workflow failures did not emit a durable `run.failed` audit event.
- The worker did not establish organization graph context before live agent execution.
- Several former browser-only fakes bypassed real API, persistence, billing, or action boundaries.
- Cross-product fixtures could leave data behind or make cleanup assertions appear green without proving cleanup.
- Webhook security coverage did not include the full forged/stale/malformed/oversized matrix.
- Local E2E startup could reuse an incompatible server environment.
- A cold worker start could exceed a hard-coded 30-second UI assertion on the constrained test machine.
- Funnel branch authoring exposed only event conditions; contact-attribute branch authoring is now available and labelled.
- Step and variant APIs accepted too many malformed or cross-parent inputs.
- Active/sent variants could not be safely distinguished from detachable unsent variants.
- Middle-step deletion used negative temporary positions despite a positive-position database constraint.
- A completed non-email step could race with the next email form and erase its subject/body.
- Deterministic mail provider IDs reset on every worker restart and could misattribute provider webhooks.
- Daily rollups omitted tenant ownership and could fail composite organization foreign keys.
- A dismissed support nudge reappeared after full-page navigation and could cover funnel controls.
- Launch-journey cleanup could delete a variant before a worker-created send that referenced it, rolling back the fixture cleanup.
- Fresh local workspaces omitted the Cascade entitlement.
- Deterministic Cascade template and mail transports were not explicitly forbidden by the production environment contract.

## Remaining risk, deliberately outside this release gate

- Semantic quality is not proven across every OpenRouter model. Add prompt-and-model evaluations with scored fixtures before treating output quality as complete.
- Provider availability, routing, rate limits, and free-model availability can change independently of this codebase.
- The schedule path is forced due in E2E; the suite does not wait through a real hourly cron interval.
- Product-event idempotency and dispatch are covered with a representative event type; every named event value is not duplicated as an otherwise identical E2E.
- Two expensive live generative UI journeys remain opt-in rather than part of the deterministic default gate.
- Funnel email transport is deterministic and delivery-free in E2E. The real Resend HTTP client is unit tested and the actual signed webhook server path is E2E tested, but the suite deliberately does not send third-party email.
- Funnel generation and optimization use grounded deterministic model output in the default gate. This proves orchestration, validation, storage, and activation, not semantic quality across live models.
- The 100% funnel figure means all 77 behaviours in this published business-critical denominator passed. It does not mean 100% source-line, mutation, browser, provider, or combinatorial coverage.

## Recommended release gates

1. Require the deterministic E2E suite on every pull request.
2. Require the live OpenRouter workflow-provider test on a protected manual or scheduled CI job with secrets.
3. Keep semantic model evaluations separate from E2E pass/fail so provider variance does not hide application regressions.
4. Investigate any new skipped default test; only explicitly labelled live-provider tests should be gated.
