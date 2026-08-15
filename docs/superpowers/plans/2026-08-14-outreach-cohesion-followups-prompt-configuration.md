# Outreach Cohesion, Follow-up Automation, and Prompt Configuration Plan

**Date:** 2026-08-14
**Status:** Implemented
**Scope:** Taicho Outreach, shared authentication inputs, and tenant-configurable outreach prompts

## Outcome

Taicho should present one coherent sales-intelligence picture, let operators research a promising account independently of a weak prospect, always create the next follow-up when a message is generated, make password entry verifiable, and let each tenant control the prompts that generate its outreach messages.

## Current state

- Account ICP and timing scores already exist and are visible on account pages and in a compact company bar on prospect pages.
- Prospect persona scoring and the final qualification result exist, but they are rendered separately from the account scores and do not read as one decision surface.
- Account-only research already has a dedicated stream route and works from the account page, but the prospect page exposes a combined research action rather than explicit person/account choices.
- Auto-follow-ups are currently created after a message is marked sent or another contact activity is recorded; generating and saving a draft does not create the next follow-up.
- Password and secret inputs are inconsistent: CMS fields are masked, authentication uses a plain password input, and content-channel secrets are masked without a shared reveal control.
- Outreach message prompts are currently embedded in application code, so tenants have no surface for understanding or changing the instructions and channel templates used to generate their messages.

## Product decisions

1. The prospect detail page becomes the primary cohesive sales-intelligence surface.
2. Account and person research remain independent operations because their evidence, freshness, and scores have different lifecycles.
3. Qualification remains deterministic: account ICP gates, prospect persona gates, and timing ranks but never gates.
4. A generated message is the scheduling boundary: after the draft is durably saved, the next automatic follow-up must exist before the generation flow reports success.
5. Manual action items are never overwritten by automation; automatic follow-ups are independently idempotent and may coexist with manual items.
6. Outreach prompts are tenant-scoped, use immutable published versions, and keep an editable draft separate from the active version; broader AI observability is deferred to a future OpenTelemetry-based system.
7. “Passport” in the request is treated as “password.”

## Delivery order

### Phase 1 — Shared revealable secret input

Build one reusable password/secret field and replace every relevant entry surface.

#### Work

- Add a shared input wrapper with `Eye` and `EyeOff` controls.
- Keep values masked by default and reset visibility when the field unmounts or a form completes.
- Provide `Show password` / `Hide password` accessible names, keyboard operation, visible focus, and preserved autocomplete behavior.
- Integrate it into sign-in/sign-up, Payload CMS workspace/user password fields, and content-channel API key/signing-secret dialogs.
- Do not reveal previously stored secrets; reveal only the value currently entered in the browser.

#### Acceptance

- Every editable password or secret field has the same reveal control.
- Toggling does not modify the value or submit the form.
- Screen-reader and keyboard tests pass.
- Saved secrets are never returned to the client merely to support reveal.

### Phase 2 — Canonical sales-intelligence dossier

Create one read model and one visual decision surface for account and prospect scoring.

#### Work

- Add a canonical dossier response containing:
  - account ICP score, timing score, hard exclusions, evidence, and computed timestamp;
  - prospect persona score, persona evidence, and computed timestamp;
  - final qualification status, thresholds used, explanation, and recommended next action;
  - missing/stale research indicators for each independent scope.
- Replace the disconnected company summary and qualification presentation with a single dossier card on the prospect page.
- Keep drill-down sections for account evidence, timing signals, and person evidence below the summary.
- Show why a result exists, not only its number: what matched, what failed, confidence, exclusions, and freshness.
- Link directly to the account page without losing prospect context.

#### Acceptance

- A user can answer “Is this person worth pursuing, is the company worth pursuing, and is now a good time?” without moving between pages.
- Account and prospect scores are taken from one consistent response snapshot.
- Missing, stale, excluded, and partially researched states are explicit.
- Account scores never get mislabeled as prospect scores, and timing never changes the qualification gate.

### Phase 3 — Independent person and account research

Expose the independent research engines directly in the prospect workflow.

#### Work

- Replace the ambiguous prospect-page research action with `Research person` and `Research account` actions.
- Allow account research whenever a prospect resolves to an account, regardless of the prospect’s qualification.
- If no account exists yet, offer an explicit account-resolution/create step instead of silently coupling it to person research.
- Keep the existing account-page `Research account` action.
- Refresh only the affected evidence/score section while streaming, then recompute the combined dossier.
- After account research, requalify attached prospects whose persona score exists and queue missing persona research separately without blocking the account result.

#### Acceptance

- A poor prospect never prevents research of an interesting company.
- Account-only research does not spend credits on person research.
- Person-only research does not silently rerun fresh account research.
- Stream progress clearly identifies which entity and dimensions are running.
- Repeated requests are idempotent and respect freshness rules.

### Phase 4 — Immediate follow-up chain

Move follow-up creation from a send-only side effect to a durable generation invariant.

#### Work

- Introduce a domain operation that saves the generated message and ensures its next automatic follow-up as one logical workflow.
- Emit an idempotent `outreach.generated` event carrying organization, prospect, message, medium, generation type, and cadence policy references.
- Upsert one open automatic follow-up per prospect/cadence while allowing manual action items to coexist.
- Link the action item payload to the message that caused it and record the cadence/version used to calculate its due date.
- On follow-up generation, complete or supersede the prior automatic step and schedule the next one before returning success.
- Retain send/contact events for `lastContactedAt` and delivery history, but do not rely on them as the first scheduling trigger.
- Handle retries without duplicate drafts, duplicate action items, or skipped sequence steps.
- Show the newly scheduled item immediately beside the generated draft.

#### Acceptance

- Every successfully saved initial message or follow-up has a visible next automatic follow-up before the UI reports completion.
- Retrying the same generation produces one next action.
- Manual tasks are preserved and never silently rescheduled.
- Failed generation creates neither a message nor a follow-up.
- Sending a previously generated message does not duplicate its existing next action.

### Phase 5 — Workspace Outreach Prompt Settings

Give each tenant a clear control surface for the instructions that generate outreach messages.

#### Work

- Add an `Outreach prompts` settings page in standalone Outreach and unified Taicho.
- Let authorized workspace administrators edit the system instructions and a separate template for email, personalized InMail, traditional InMail, and content comments.
- Show the documented variables available to templates and reject unknown variables.
- Compile a live preview from editable sample inputs without making a model call or consuming credits.
- Keep an editable draft separate from the active prompt and require an explicit publish action.
- Store published versions immutably, activate only the newly published version, and record its key, version, and content hash on every generated message.
- Keep non-configurable truthfulness, untrusted-context, tool-verification, and structured-output rules outside the tenant-editable prompt.

#### Acceptance

- A tenant can view the active outreach prompt and its published version history from one settings page.
- Authorized users can save, preview, validate, and publish a draft while read-only users cannot mutate it.
- Each tenant sees only its own prompt configuration through the existing organization-scoped graph context.
- Published prompt versions cannot change underneath historical generated messages.
- Generating outreach immediately uses the tenant's active version and records that version on the draft.

## Cross-cutting implementation contracts

- Every new route and durable event carries organization, actor, request, parent execution, and trace attribution.
- All writes are idempotent and safe under stream retries.
- Scores retain independent freshness timestamps and evidence provenance.
- Generated outreach artifacts reference their prompt version.
- UI loading, empty, stale, partial, success, and failure states are explicitly tested.
- Product behavior is covered at the domain, repository, API, and browser levels.

## Verification matrix

| Area | Required verification |
| --- | --- |
| Password reveal | Component accessibility tests plus sign-in, CMS, and channel-dialog browser coverage |
| Cohesive dossier | Repository/API contract tests and prospect-page browser tests for all score states |
| Independent research | Stream tests for person-only, account-only, cascaded requalification, retries, and credit isolation |
| Follow-up chain | Repository concurrency tests, generation rollback tests, send deduplication tests, and browser visibility checks |
| Outreach prompt settings | Template validation/compilation, version immutability, tenant isolation, authorization, generation attribution, and settings-page tests |

## Explicit non-goals

- Do not merge account and prospect research into one model prompt or one score.
- Do not let timing gate qualification.
- Do not overwrite manually scheduled action items.
- Do not send raw prompts, outputs, credentials, or customer content to Datadog.
- Do not enable broad raw-content capture in Langfuse.
- Do not build a proprietary AI run inspector; use an OpenTelemetry-compatible observability system later.
- Do not expose stored password or integration-secret values back to the browser.

## Completion definition

This plan is complete when an operator can open one prospect dossier, understand the person/account/timing decision, research the account independently, generate any outreach step and immediately see the next scheduled follow-up, verify every password or secret while entering it, and configure, preview, version, and activate the tenant's outreach-generation prompts from a clear settings surface.
