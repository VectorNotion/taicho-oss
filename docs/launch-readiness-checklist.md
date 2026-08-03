# Taicho launch-readiness checklist

> Historical audit record: the enterprise-style release controls described
> below were superseded by the owner-approved lean startup CI policy on
> 25 July 2026. They are retained as history and are not current blocking
> requirements. The active release contract is documented in
> `docs/deployment.md`.

Initial audit date: 24 July 2026
Last reconciled: 25 July 2026
Audited commit: `69276da` (`main`)
Paused implementation baseline: `24cad9b`
(`launch/security-privacy-gates`, draft PR #7)
Expected canonical application URL: `https://app.taicho.ai`
Current decision: **NO-GO**
Execution status: **Paused by owner request**

This is the launch tracker. It deliberately tracks two different states so
completed engineering work is visible without overstating launch readiness:

- **Work** is checked when the repository/configuration implementation is
  complete and its local evidence is linked.
- **Gate** is checked only when the full “done when” condition is met, including
  immutable-candidate, deployed, provider, operational, or approval evidence.

Assign every P0 and P1 item before scheduling a launch date.

## Executive summary

Progress snapshot (updated 25 July 2026):

- **22/52 engineering work items complete**
- **1/52 engineering work item in progress** (`UX-05`)
- **4/52 launch gates fully closed**
- **5 P0 launch gates remain open**
- **10/10 security/privacy engineering items complete; 2/10 gates closed**
- Production dependency audit: **0 critical, 0 high, 1 moderate, 1 low**
- Local deterministic primary-journey and automation coverage: **9/9 passed**
- Earlier local role and commercial-boundary browser/API coverage:
  **10/10 passed**; the latest CI browser lane has one separate
  unentitled-workspace console-error failure recorded below
- Local security verification: **77/77 architecture checks passed**; all
  database-, FalkorDB-, Qdrant-, webhook-, and tenant-isolation suites that
  were exercised passed
- Release verdict: the current revision must not be launched until all P0
  gates and the required P1 gates are closed.

Draft PR #7 contains the paused security/privacy candidate. Workflow run
`30147424926` passed its security and canonical test jobs but failed browser
E2E with 26 passed, 3 failed, and 2 live-provider tests skipped. No
release-candidate dispatch, production deployment, provider-console rotation,
legal approval, dependency-risk approval, or launch-day step has been
credited. Continue from the unchecked **Gate** column; do not repeat checked
**Work** unless its implementation changes. The exact pause/resume handoff is
recorded in
`docs/security/security-privacy-gate-status-spec-2026-07-25.md`.

The original audit blockers for the canonical test inventory, publishing
migration, canonical domain/TLS, local Node 24 build path, dependency graph,
security controls, and core UX defects now have repository implementations.
Most remaining work is immutable-candidate evidence, deployment verification,
production credentials/provider environments, legal/owner approvals, and the
unstarted operations/GTM tickets.

## P0 — launch blockers

| Work | Gate | ID | Release requirement | Owner | Done when |
| --- | --- | --- | --- | --- | --- |
| [x] | [ ] | P0-01 | Repair the canonical test inventory after adding `test:chat`. | Codex | `pnpm test` passes from a clean checkout and CI is green. Update `tests/architecture/testing-strategy.test.mjs` so the expected suite list and canonical command agree. |
| [x] | [x] | P0-02 | Make the publishing migration safe for existing tenant and legacy data. | Codex | A production-like database clone migrates twice without error; the backfill runs before the composite foreign key is added; mismatched `"legacy"` rows are handled explicitly; `/api/content/publishing` and `/api/content/channels` return 200 afterward. |
| [x] | [x] | P0-03 | Establish one canonical domain and repair the old domain. | Codex | Product, docs, OAuth callbacks, email links, monitoring, and auth configuration use `app.taicho.ai`; `app.vectornotion.com` either has a valid certificate and redirects to the canonical domain or its DNS and all references are intentionally removed. |
| [x] | [ ] | P0-04 | Produce a reproducible release build and typecheck result on the supported Node version. | Codex | A clean Node 24 job passes `pnpm typecheck` and `pnpm build:unified`, publishes the exact artifact/image under test, and records logs. The documented local verification path also works within the 8 GB development-machine constraint, for example by running packages sequentially or reducing the TypeScript graph. |
| [x] | [ ] | P0-05 | Triage and remediate the high-severity production dependency advisories. | Codex | Runtime reachability is documented for every high advisory; patched versions are deployed where available; compensating controls and expiry dates are approved for exceptions; a high/critical full-lockfile dependency audit is a blocking CI gate. Prioritize MCP SDK, Hono, `path-to-regexp`, PostCSS, Sharp, `linkify-it`, and the unpatched `html-minifier` chain. |
| [x] | [ ] | P0-06 | Validate the complete production environment and secret contract. | Codex | A redacted configuration report proves all required variables are present, canonical URLs/origins are correct, secrets are stable across migrations/web/workers, and startup succeeds with production validation enabled. Include `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `OBSERVABILITY_ID_HASH_KEY`, database/graph credentials, assistant service secrets/URLs, OAuth credentials, the versioned Nurture credential-envelope key, and provider-specific variables. Workspace email-provider secrets are verified through Nurture Settings rather than copied into the environment. |
| [x] | [ ] | P0-07 | Pass the release-candidate pipeline against the exact launch commit. | Codex | Lint, typecheck, canonical tests, database-backed suites, coverage, migration rehearsal, Playwright E2E, container build/scan, and required live-provider checks are green for one immutable commit. The deployed image digest matches that commit. |

Do not set a public launch date while any P0 item is open.

## P1 — required before public customer launch

### Security and privacy

| Work | Gate | ID | Requirement | Owner | Done when |
| --- | --- | --- | --- | --- | --- |
| [x] | [x] | SEC-01 | Add production web security headers. | Codex | Live responses include an approved HSTS policy, CSP, `X-Content-Type-Options`, clickjacking protection via CSP `frame-ancestors` or `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`; regression tests verify them. |
| [x] | [x] | SEC-02 | Stop exposing framework identity. | Codex | `x-powered-by: Next.js` is absent from live responses. |
| [x] | [ ] | SEC-03 | Add abuse protection to account creation and email/password sign-in. | Codex | Rate limits, lockout/backoff, alerting, and bot protection appropriate to the signup policy are tested without enabling account enumeration or denial-of-service abuse. |
| [x] | [ ] | SEC-04 | Verify session, cookie, CSRF, CORS, redirect, and trusted-origin policy. | Codex | Security review confirms secure cookie attributes, session expiry/revocation, allowed origins, safe `returnTo` handling, and cross-site request protections in production. |
| [x] | [ ] | SEC-05 | Complete tenant-isolation tests for every shared store and background job. | Codex | Negative tests prove cross-organization reads/writes fail in PostgreSQL, FalkorDB, job queues, assistants, webhooks, and exports. New chat/support tables are included. |
| [x] | [ ] | SEC-06 | Review inbound URL fetches and webhook endpoints. | Codex | SSRF protections, URL allow/deny rules, signature verification, timestamp/replay protection, payload limits, and error redaction are covered by tests. |
| [x] | [ ] | SEC-07 | Add secret scanning and supply-chain controls. | Codex | Pull requests and release images pass secret scanning, SAST as applicable, container scanning, an SBOM/provenance check, and image signing or equivalent integrity verification. |
| [x] | [ ] | SEC-08 | Document production secret ownership and rotation. | Codex | Each secret has an owner, storage location, rotation procedure, last-rotated date, and tested emergency-revocation path. No production secret is present in source, image layers, client bundles, or logs. |
| [x] | [ ] | SEC-09 | Publish the required customer legal and data documents. | Codex | Legal approves Privacy Policy, Terms, subprocessor/DPA material, AI disclosures, data retention/deletion/export policy, acceptable use, and telemetry/cookie-consent behavior for the launch markets. |
| [x] | [ ] | SEC-10 | Make dependency maintenance continuous. | Codex | Dependabot/Renovate or an equivalent process opens bounded upgrades; an owner reviews alerts on an agreed SLA; exceptions are time-limited and visible. |

#### Active security/privacy gate status

| ID | Completed and checked under Work | Why Gate is still unchecked |
| --- | --- | --- |
| SEC-01 | Production headers and regression tests verified. | Closed. |
| SEC-02 | Framework identity removed from live responses. | Closed. |
| SEC-03 | Durable auth throttling, waitlist enforcement, privacy-safe alerts, and enumeration-safe errors pass local tests. | Exercise the immutable candidate and deployed edge safely. |
| SEC-04 | Cookie/session policy, CSRF/origin checks, trusted origins, and safe redirects pass regression tests. | Capture immutable-candidate and deployed-cookie evidence. |
| SEC-05 | Negative isolation suites pass across PostgreSQL, real FalkorDB, real Qdrant, jobs, assistants, webhooks, and workers. | Deploy scoped roles/migrations and repeat the rollback-only live probes. |
| SEC-06 | SSRF, bounded-body, signature, replay, and redaction controls pass focused tests. Resend and Twilio SendGrid enforce provider timestamps; Mailchimp Transactional binds signatures to the exact webhook URL; all use durable replay receipts. | Connect the launch workspace provider through Nurture Settings, approve outbound hosts, then run candidate/live negative probes. |
| SEC-07 | Blocking Gitleaks, local CodeQL SARIF, audit, image, SBOM, provenance, and signing controls are implemented in the release workflow, and the historical MCP key is conclusively retired from active stores. GitHub-hosted Code Scanning is unavailable on the private plan, so CodeQL output is gated and retained as an artifact without dashboard upload. | Produce a green, signed candidate plus production-host verification. |
| SEC-08 | Value-free ownership/rotation inventory and strict CI validation are implemented; production secret files are root-only; registry credentials are split and rotated; the historical MCP key is retired. | Record and rehearse the remaining active application/provider rotations and emergency revocations; do not invent provider evidence. |
| SEC-09 | Public, fail-closed legal pages and review packet are implemented as drafts and remain `noindex`. | Named counsel/Product approval, executed provider/DPA terms, tested contact channels, and approved production values are required. |
| SEC-10 | Dependabot configuration, owner SLA, and time-limited exception registry are implemented and structurally validated. Babel and Hono are patched rather than excepted. | Merge to the default branch, observe the first update run, reconcile alerts, and obtain accountable approval or remediation for the two remaining moderate/low exceptions. |

The unchecked security gates are not failed engineering tasks. They are
deliberately open because their acceptance criteria require candidate,
deployment, provider, operational, or named-approver evidence that does not
exist yet.

#### Inputs required to close the remaining security/privacy gates

| Gates | Next action that can close them | Accountable input still required |
| --- | --- | --- |
| SEC-03, SEC-04, SEC-05, SEC-06, SEC-07 | Approve the candidate and a controlled maintenance window, dispatch the strict release-candidate workflow from the default branch, deploy the signed digests, and retain the defined live negative probes. | Repository/production owner approval to merge and deploy; no production rollout has been inferred from this audit. |
| SEC-06 | Configure the launch workspace's delivery provider, webhook signing secret, verified domain, and default sender through Nurture Settings; approve the exact MCP and publishing outbound-host allowlists, or formally disable those features for launch. | Product/Security host decisions and provider credentials through the encrypted Settings surface. |
| SEC-08 | Rotate the eight inventory entries whose dates are unknown and rehearse emergency revocation without exposing values in the tracker. | Production/provider console owner sessions for Better Auth, PostgreSQL owner, CRM envelope, OpenRouter, Tavily, Cascade signing, R2, and publishing-provider credentials. |
| SEC-09 | Replace draft legal metadata with approved production values, execute applicable provider/DPA terms, and test every published contact route. | Named Legal and Product approvers plus executed terms; Codex cannot self-approve legal risk. |
| SEC-10 | Merge the maintenance configuration, observe the first default-branch update run, reconcile the refreshed dependency graph, and remediate or explicitly accept the two time-limited moderate/low exceptions. | Named accountable risk owner approval; the current exception expiry is 15 August 2026. |

SEC-05 resolution progress (25 July 2026): dedicated non-superuser runtime
roles, separate migration/control roles, forced PostgreSQL RLS, composite
tenant foreign keys, worker re-entry boundaries, signed webhook ownership,
per-organization FalkorDB graphs, and mandatory Qdrant tenant/site/bot filters
are implemented. Two-tenant negative suites pass for Cascade, publishing, CRM
assistant sales/support storage, generic jobs, MCP, real
FalkorDB, and real Qdrant. Production roles and protected DSNs are prepared;
live rollback-only Cascade and publishing probes reject cross-tenant reads and
forged writes. The ticket remains open until the immutable candidate applies
the publishing/automation migrations, starts every service on the scoped
roles, and repeats live probes. Evidence:
`docs/security/tenant-isolation-review-2026-07-25.md`.

SEC-06 resolution progress (25 July 2026): customer-controlled publishing and
MCP destinations now pass DNS-pinned SSRF policy with exact host rules,
private/mapped/metadata denial, redirect rejection, timeouts, and byte limits.
Automation, Resend/Svix, HubSpot, Pipedrive, Zoho, and assistant receivers have
bounded streaming bodies, authenticated raw-body contracts, timestamp windows,
durable replay keys, and privacy-safe errors. Architecture and focused
negative suites pass. The ticket remains open until the real
the workspace delivery-provider connection and outbound host decisions are supplied, the immutable
candidate applies receipt migrations, and live negative probes pass. Evidence:
`docs/security/network-and-webhook-review-2026-07-25.md`.

SEC-07 resolution progress (25 July 2026): the canonical release workflow now
blocks on Gitleaks, CodeQL with a repository-owned fail-closed SARIF gate, a
full-lockfile production dependency audit,
high/critical Trivy findings, non-empty SBOM/provenance inspection, keyless
Cosign signing, and immediate signature verification. Production promotion
re-verifies the workflow identity, issuer, annotations, and exact digest; the
legacy mutable-`latest` workflow is removed. A full-history audit also found a
material historical `MCP_API_KEY`, which is not reproduced or suppressed. The
key is now retired: its local active copy was removed, production and GitHub
have no copy, and the decommissioned receiver returns HTTP 404. The ticket
remains open until the candidate pipeline is green, registry signatures are
retained, and the production host positively verifies the signed candidate.
The host now runs checksum-verified Cosign 3.0.6 and rejects the deployed
unsigned legacy digest. Evidence:
`docs/security/supply-chain-review-2026-07-25.md`.

GitHub-hosted Code Scanning cannot accept the SARIF upload on this private
repository because Advanced Security is not purchased. CodeQL itself remains
blocking: the official action runs `security-extended`, the local gate rejects
malformed output and high-confidence error/high/critical findings, and the
complete SARIF output—including nonblocking results—is retained as a workflow
artifact.

The first functional SARIF run reported 14 results. Ten high-confidence
findings identified regex-based HTML/CSS handling; the preview path now uses a
parser-backed HTML allowlist, parsed CSS network-resource removal, a sandbox,
and a restrictive preview CSP, while plain-text rendering no longer treats a
tag-stripping regex as a sanitizer. The OAuth callback now consumes and binds
state before handling provider errors and no longer reflects provider error
text. The security job in workflow run `30147424926`, on commit `24cad9b`,
passed with three reported findings and zero blocking high-confidence
error/high/critical findings. The retained medium-confidence results are two
callback presence guards that run only after one-time state validation and one
test-only regular expression; they remain visible for review rather than being
silently suppressed.

SEC-08 resolution progress (25 July 2026): a value-free machine-readable
registry assigns every application, release, provider, infrastructure, and
dynamic credential to a functional owner, storage boundary, rotation
procedure, and emergency revocation path. Structural coverage is enforced on
every CI run; release candidates additionally fail on unknown rotation dates,
deprecated credentials, or compromised credentials. Production secret-bearing
files are confirmed root-only mode `0600`, and the TLS key date is recorded.
Separate CI and production registry identities now replace the retired shared
login, and the historical MCP key is removed from active stores. The ticket
remains open because several active application and provider keys have unknown
rotation dates and emergency revocation has not been rehearsed. The
deterministic seed is now forbidden in production and no longer logs its
password; five production seed credentials were disabled, 13 sessions revoked,
and the seed and legacy Neo4j password variables removed after a checksummed
backup. The running unified container's old environment snapshot will be
purged by the controlled candidate recreate; its seed value is unusable and
absent from its logs. Evidence:
`docs/security/secret-ownership-and-rotation.md`.

SEC-09 resolution progress (25 July 2026): the unified app now has a public
legal hub covering Privacy, Terms, subprocessors, DPA, AI disclosure, data
retention/deletion/export, acceptable use, and cookie/telemetry behavior.
Drafts are linked from public and authenticated UI, truthfully identify
unimplemented export/deletion and provider controls, and emit `noindex` until
approved. The production validator fails closed on missing entity, contacts,
effective date, markets, hosting provider/location, AI data-use position, or
approval status. The ticket remains open for named counsel approval, executed
provider/DPA terms, tested contact channels, and approved production values.
Evidence: `docs/legal/launch-legal-review.md`.

SEC-10 resolution progress (25 July 2026): Dependabot now covers the pnpm
workspace, pinned GitHub Actions, Dockerfiles, and production Compose on a
bounded weekly schedule with grouped minor/patch and security updates, isolated
majors, PR caps, and repository-owner assignment. A published severity SLA and
machine-readable exception registry enforce owners, controls, upgrade
triggers, and expiry; expired entries fail all CI and pending or critical/high
exceptions fail a release candidate. GitHub dependency alerts are now enabled
and the configured label exists; the remote default branch currently reports 4
critical, 85 high, 96 moderate, and 21 low alerts pending the candidate
lockfile merge and graph refresh. The ticket remains open until the config is
active on the default branch, the first update run is observed, alerts
reconcile, and the two remaining moderate/low exceptions receive accountable
approval or remediation. Evidence: `docs/security/dependency-maintenance.md`.

SEC-03 implementation complete (25 July 2026): Better Auth now uses durable
database rate limiting with bounded rules for sign-in, signup, password
recovery, reset, and token endpoints. The production edge independently
throttles sign-in, rejects signup under the waitlist-only policy, overwrites
caller-supplied forwarding chains, emits privacy-safe rate-limit alerts, and
keeps credential errors enumeration-safe. Unit and architecture regression
tests pass. The gate remains open until the immutable candidate repeats the
tests and the deployed edge limits are exercised safely.

SEC-04 implementation complete (25 July 2026): session expiry, refresh and
freshness windows, password-reset revocation, secure/HTTP-only/SameSite cookie
attributes, CSRF/origin checks, one canonical production trusted origin, and a
shared same-origin `returnTo` sanitizer are explicit and regression-tested.
The gate remains open for immutable-candidate and deployed-cookie evidence.

### Product, UX, and accessibility

| Work | Gate | ID | Requirement | Owner | Done when |
| --- | --- | --- | --- | --- | --- |
| [x] | [ ] | UX-01 | Fix the live pricing-page color contrast violation. | Codex | Axe reports no serious/critical violations at desktop and mobile sizes, and the affected text meets WCAG AA contrast. |
| [x] | [ ] | UX-02 | Fix the mobile billing page overflow and keyboard access. | Codex | At 390 px width the document no longer overflows horizontally, the plan/usage scroller is keyboard-focusable, and Axe reports no serious/critical violation. |
| [x] | [ ] | UX-03 | Add global failure and navigation fallbacks. | Codex | The deployed app has tested global error, not-found, and appropriate loading states; unexpected API/server failures show a useful recovery path and correlation ID without leaking internals. |
| [x] | [ ] | UX-04 | Decide and enforce the public signup policy. | Codex | Product and security approve open signup, invitation-only, or waitlist behavior; UI copy and server authorization match the decision. |
| [ ] | [ ] | UX-05 | Run the primary journeys with realistic fixtures. | Codex | A release candidate completes API lead creation/research/outreach, content research/drafting/publishing, nurture funnel/template/email/variant flow, sales assistant, support assistant/escalation, profile/settings, administration, and billing with no console or API errors. |
| [x] | [ ] | UX-06 | Verify every role and entitlement boundary. | Codex | Owner, team admin, operator/editor, viewer, expired plan, exhausted credits, and unentitled product states are exercised in browser and API tests. |
| [ ] | [ ] | UX-07 | Verify billing end to end in the launch payment environment. | Unassigned | Pricing, currency/tax copy, checkout, success/cancel, signed webhooks, idempotency, upgrades/downgrades, failed payments, refunds, invoices, credit accounting, and entitlement revocation are tested. |
| [ ] | [ ] | UX-08 | Verify email identity and deliverability. | Unassigned | SPF, DKIM, DMARC, branded sender/reply-to, bounce/complaint handling, suppression, unsubscribe, and rate limits are verified; transactional and campaign templates render across target clients. |
| [ ] | [ ] | UX-09 | Verify external OAuth applications and callbacks. | Unassigned | Google/YouTube, LinkedIn, X, CRM, and other enabled integrations use production-reviewed apps, least-privilege scopes, canonical callback URLs, token refresh/revocation, and useful failure states. Disabled integrations are hidden or clearly labeled. |
| [ ] | [ ] | UX-10 | Complete accessibility regression coverage. | Unassigned | Automated axe checks cover all primary products plus admin, billing, support, pricing, and enterprise; keyboard-only, focus order, labels, announcements, zoom, and reduced-motion checks pass on representative journeys. |
| [ ] | [ ] | UX-11 | Complete responsive and browser coverage. | Unassigned | Supported mobile/tablet/desktop viewports pass on current Chrome, Safari, Firefox, and Edge; data tables, dialogs, editors, navigation, charts, and long content do not clip or trap input. |
| [ ] | [ ] | UX-12 | Validate data import and export safety. | Unassigned | CSV/CRM imports handle size limits, duplicates, invalid rows, encoding, cancellation, retries, tenant attribution, and error exports; customer data export and deletion are tested. |
| [ ] | [ ] | UX-13 | Define support-assistant fallback and human escalation. | Unassigned | Unknown/unsafe requests, prompt injection, provider outage, quota exhaustion, PII handling, citations, ticket creation, and handoff to a human are tested and observable. |
| [ ] | [ ] | UX-14 | Update all customer-facing names and links. | Unassigned | README, architecture/deployment/auth docs, emails, OAuth consoles, help content, app metadata, and monitoring contain the approved Taicho name and canonical URLs with no VectorNotion drift. |

UX-01 resolution progress (25 July 2026): the `Popular` pricing badge now uses
a violet-700/violet-50 pair with semibold small text instead of the failing
primary pair. The production-mode candidate reports zero serious/critical Axe
violations at both 390 × 844 and 1280 × 800, and the public-page E2E lane now
covers pricing at both sizes. The ticket remains open until the immutable
candidate is deployed and the same live Axe probes pass.

UX-02 resolution progress (25 July 2026): the billing summary, actions, cards,
quota rows, and activity card now shrink or stack at narrow widths rather than
forcing the document wider. Shared table overflow regions have a visible focus
ring, `role="region"`, an accessible name, and `tabindex="0"`; billing gives
its activity table a specific label and intentional 36 rem inner width. An
authenticated 390 × 844 browser rehearsal measured document/viewport width
390/390, zero serious/critical Axe violations, and a 308 px keyboard-focusable
scroller containing 576 px of table content. The ticket remains open until the
candidate is deployed and the live authenticated probe repeats.

UX-03 resolution progress (25 July 2026): the unified app now has segment and
root error boundaries, a shared not-found experience, and an accessible global
loading skeleton. Failure screens provide retry, reload, and safe navigation
without rendering exception messages or stacks; server render references and
proxy support codes are validated before display. Billing, enterprise, and
support-assistant request failures now ignore response bodies and show only
generic recovery copy plus a trusted support code when available. Structured,
privacy-safe logging replaced the raw dashboard and support-path error output.
Observability unit tests, architecture checks, unified typecheck, and a
production build pass. A production-mode 390 × 844 browser probe rendered the
not-found recovery with the response support code, no internal marker or
horizontal overflow, and zero serious/critical Axe violations. The ticket
remains open until the immutable candidate is deployed and live error,
not-found, loading, and failed-API probes pass.

UX-04 resolution progress (25 July 2026): the launch baseline is now explicitly
waitlist-only. The production runtime rejects an `open` setting, Better Auth
disables email account creation, the production preflight forbids open signup,
nginx denies the exact signup endpoint, and the candidate sign-in UI replaces
account creation with a rate-limited request-access path. Auth unit/type tests
and cross-layer architecture checks pass. The active production environment
file contains the waitlist setting and the live edge returns 403 for the
signup endpoint. The running legacy image does not yet show the candidate
waitlist copy or contain the new environment snapshot, so the ticket remains
open until the candidate is deployed, a realistic inquiry-to-operator flow is
tested, and named Product and Security owners approve the decision. Evidence:
`docs/product/signup-access-policy.md`.

UX-05 resolution progress (25 July 2026): realistic browser fixtures and real
local workers now cover every journey named in the ticket. The deterministic
primary-journey and automation lanes pass 9/9 with automatic failure on
browser-console errors, HTTP 5xx responses, or failed fetch/XHR requests. Both
live-provider suites completed functionally; the monitored content suite is
clean, while the monitored generated-email preview still emits one
sandbox-blocked-script console warning. Preview sanitization and regression
coverage are implemented, but this final warning and the immutable-candidate
repeat keep both Work and Gate open. The paused CI run also recorded aborted
automation run requests during durable-log navigation, so that focused journey
must be reproduced before the next complete run. Evidence:
`docs/qa/primary-journey-rehearsal-2026-07-25.md`.

UX-06 implementation complete (25 July 2026): owner, team administrator,
outreach operator, content editor, viewer, expired plan, exhausted credits, and
unentitled-product boundaries passed the earlier local browser/API coverage
(10/10 aggregate).
The review fixed an authorization defect that allowed expired subscriptions to
retain capabilities and receive new included credits. Inactive subscriptions now
lose capabilities and billing-period grants, exhausted work fails before provider
invocation, and reactivation issues exactly one fresh grant. The paused CI run
reached the expected content page in the unentitled-workspace scenario but
recorded browser fetch errors, so the Gate remains open for a clean
immutable-candidate repeat and deployed smoke evidence. Evidence:
`docs/security/role-and-entitlement-boundary-review-2026-07-25.md`.

UX-07 implementation progress (29 July 2026): recurring subscriptions use
Razorpay Plans and organization top-ups use one-time Razorpay Orders. Top-up
sessions snapshot the CMS pack, verify checkout and webhook signatures, fetch
the provider order and captured payment, validate amount/currency, and issue one
12-month organization credit lot through a durable idempotency key. Local
Postgres coverage includes browser-callback fulfillment, webhook-only
fulfillment, duplicate events, duplicate verification, ineligible plans,
unpublished packs, amount mismatch rejection, and recovery of a captured payment
by the durable commerce worker when callbacks are absent. The Gate remains open
until the same flows, payment failure/retry, refund handling, and reconciliation
are exercised with Razorpay test credentials in the launch environment.

### Reliability, deployment, and operations

| Work | Gate | ID | Requirement | Owner | Done when |
| --- | --- | --- | --- | --- | --- |
| [ ] | [ ] | OPS-01 | Add a real readiness endpoint and external monitor. | Unassigned | A narrowly exposed endpoint distinguishes web-process health from PostgreSQL/FalkorDB/critical dependency readiness; it is used by orchestration and external monitoring. Unauthenticated `/api/health` returning 401 is not the readiness signal. |
| [ ] | [ ] | OPS-02 | Add worker and queue health coverage. | Unassigned | Content, automation, sync, MCP, nurture, assistant, and other workers expose or publish liveness, last-success, queue lag, retry, dead-letter, and stuck-job metrics with alerts. |
| [ ] | [ ] | OPS-03 | Define SLOs and actionable alerting. | Unassigned | Owners approve availability/latency/error and background-job SLOs; dashboards and paging thresholds are tested by a controlled failure; every alert links to a runbook. |
| [ ] | [ ] | OPS-04 | Implement and rehearse backups. | Unassigned | Automated PostgreSQL and FalkorDB backups have documented RPO/RTO, encryption, retention, off-host storage, monitoring, and a successful restore drill. A verified snapshot is taken immediately before launch migrations. |
| [ ] | [ ] | OPS-05 | Make migration deployment recoverable. | Unassigned | Migrations are transactional/idempotent where possible, destructive operations are separated, preflight checks run before traffic cutover, and rollback/forward-fix procedures are rehearsed against a clone. |
| [ ] | [ ] | OPS-06 | Deploy immutable, pinned artifacts. | Unassigned | Application images use commit-addressed tags/digests; mutable `latest` is not the promotion boundary; PostgreSQL, FalkorDB, Datadog, and other production images are pinned to reviewed versions or digests. |
| [ ] | [ ] | OPS-07 | Replace uncontrolled automatic promotion with an auditable release step. | Unassigned | The exact tested digest is promoted intentionally, health checks gate completion, failed rollout stops automatically, and the prior known-good digest can be restored without rebuilding. |
| [ ] | [ ] | OPS-08 | Run rollback and disaster exercises. | Unassigned | The team restores the previous application version, handles a forward-only database change, restores data, and records actual recovery times and owners. |
| [ ] | [ ] | OPS-09 | Run capacity, concurrency, and cost tests. | Unassigned | Representative concurrent users, imports, assistant streams, publishing jobs, email sends, and provider failures stay inside agreed latency/error/resource budgets; per-tenant quotas and provider spend alerts work. |
| [ ] | [ ] | OPS-10 | Monitor DNS, certificates, and external dependencies. | Unassigned | Alerts cover DNS resolution, certificate expiry, HTTP reachability, OAuth/provider status, email delivery, payment webhooks, and public synthetic journeys from outside the host. |
| [ ] | [ ] | OPS-11 | Confirm logging, tracing, and privacy behavior. | Unassigned | Datadog/Langfuse correlation works across HTTP, jobs, and assistants; `OBSERVABILITY_ID_HASH_KEY` is configured; sensitive prompts, tokens, credentials, and customer fields are redacted according to policy. |
| [ ] | [ ] | OPS-12 | Create incident and customer-support runbooks. | Unassigned | Named on-call/support owners can handle login failure, database/graph outage, stuck jobs, provider outage, billing incidents, bad deploys, data deletion/export, and security reports; escalation contacts and status messaging are ready. |
| [ ] | [ ] | OPS-13 | Confirm legacy runtime disposition. | Unassigned | The documented systemd fallback is either retained through the approved rollback window or removed only after stable operation, with the decision and recovery implications recorded. |
| [ ] | [ ] | OPS-14 | Run a launch-day change freeze and rehearsal. | Unassigned | The release candidate, data snapshot, deployment order, smoke tests, owners, communication channel, abort criteria, and rollback command are rehearsed before launch day. |

### Go-to-market and customer readiness

| Work | Gate | ID | Requirement | Owner | Done when |
| --- | --- | --- | --- | --- | --- |
| [ ] | [ ] | GTM-01 | Approve pricing, packaging, quotas, and entitlement copy. | Unassigned | Marketing, product, finance, and support agree on the live plan matrix and it matches server enforcement. |
| [ ] | [ ] | GTM-02 | Publish onboarding and help material. | Unassigned | A new user can connect required providers, import data, create the first useful output, understand quotas, and recover from common errors without internal assistance. |
| [ ] | [ ] | GTM-03 | Define support coverage and response targets. | Unassigned | The public contact path works, ticket routing is tested, launch-week coverage is staffed, and customer-facing response targets are documented. |
| [ ] | [ ] | GTM-04 | Validate product analytics and consent. | Unassigned | Approved activation, conversion, retention, failure, and cost events reach the correct environment without sensitive payloads or duplicate identities; consent behavior matches policy. |
| [ ] | [ ] | GTM-05 | Run a controlled canary/beta. | Unassigned | Internal and selected tenant traffic uses the exact release candidate for an agreed soak period; no unresolved P0/P1 defect or SLO breach remains. |
| [ ] | [ ] | GTM-06 | Prepare launch and incident communications. | Unassigned | Launch announcement, known limitations, maintenance/incident templates, security contact, support links, and status updates are approved and ready. |
| [ ] | [ ] | GTM-07 | Set launch success and abort criteria. | Unassigned | Owners agree on measurable activation, error, latency, queue, billing, provider-cost, and support-volume thresholds plus who can pause or roll back the launch. |

## Launch-day execution checklist

Run this only after the P0 and P1 exit criteria are met.

| Status | Step | Owner | Evidence |
| --- | --- | --- | --- |
| [ ] | Freeze the approved launch commit and record its Git SHA and image digest. | Unassigned | Release record |
| [ ] | Confirm all required CI and security checks are green for that SHA. | Unassigned | CI links |
| [ ] | Confirm provider status, quotas, production secrets, DNS, and certificate health. | Unassigned | Preflight report |
| [ ] | Take and verify the pre-migration data snapshot. | Unassigned | Backup ID and restore verification |
| [ ] | Run migration preflight against the latest production snapshot/clone. | Unassigned | Migration log |
| [ ] | Deploy the immutable release to canary/internal traffic. | Unassigned | Deployment record |
| [ ] | Run unauthenticated, owner, editor/operator, viewer, billing, assistant, publishing, email, and background-job smoke tests. | Unassigned | Smoke-test report |
| [ ] | Check error rate, latency, queue lag, provider errors, spend, logs, traces, and database/graph capacity during the soak. | Unassigned | Dashboard links |
| [ ] | Make the explicit go/no-go decision with Engineering, Product, Security, Operations, Support, and Legal. | Unassigned | Sign-off record |
| [ ] | Increase traffic in controlled stages and repeat smoke/health checks at each stage. | Unassigned | Rollout log |
| [ ] | Announce launch only after the final health window passes. | Unassigned | Communication link |
| [ ] | Keep the rollback owner and launch channel active through the agreed observation window. | Unassigned | Handoff record |

## Audit evidence and reproduction

### Critical findings

#### QA-001 — canonical test command fails

Severity: Critical
Area: CI/release gate

Reproduction:

1. Check out `69276da`.
2. Install the locked dependencies.
3. Run `pnpm test`.

Observed: the architecture test reports `15 !== 14` because `package.json`
includes `test:chat` while the owned-suite list in
`tests/architecture/testing-strategy.test.mjs` has not been updated.

Expected: the canonical test command includes every owned suite and exits zero.

Resolution progress (25 July 2026): the owned-suite inventory now includes
`test:chat`. The latest canonical run passed architecture, observability,
auth, sync, platform, UI, commerce, chat, and MCP before the local `.env`
directed Squad at an inactive FalkorDB port. Squad and every remaining suite
then passed directly against the active local FalkorDB instance. This is
environment evidence rather than a test assertion failure, but P0-01 remains
open until a clean checkout and the exact candidate commit pass the canonical
command in CI without an environment override.

#### QA-002 — publishing migration fails and can prevent web startup

Severity: Critical
Area: Database migration/deployment

Reproduction:

1. Use an existing database containing legacy publishing channels/posts.
2. Run `POSTGRES_HOST=localhost pnpm content:migrate`.

Observed: PostgreSQL rejects `posts_channel_organization_fkey` because a post
with organization `"legacy"` references a channel without the matching
`(organization_id, id)` tuple. The production unified entrypoint runs this
migration under `set -e` before starting Next.js, so the service would not
start on an affected database. The legacy-assignment script currently calls
`ensurePublishingSchema` before its backfill, which is too late for this case.

Expected: legacy data is validated/backfilled before adding the constraint and
the migration is safe to rerun.

Related local behavior after the failed migration:

- `GET /api/content/publishing` returned 500.
- `GET /api/content/channels` returned 500 with
  `{"error":"Failed to list channels"}`.
- Other checked endpoints, such as outreach leads, continued to return 200.

#### QA-003 — documented application domain has an invalid certificate

Severity: Critical
Area: DNS/TLS/customer entry point

Resolution (25 July 2026): Resolved. The certificate now covers
`app.taicho.ai` and `app.vectornotion.com`; HTTP and HTTPS requests to the old
hostname return 308 to the canonical hostname with path/query preserved.
Production URL configuration and current documentation use `app.taicho.ai`.

Reproduction:

1. Run `curl -I https://app.vectornotion.com`.
2. Inspect the certificate for that host.

Observed: TLS verification fails because the certificate covers only
`app.taicho.ai`. Both hostnames resolve to the same server, while repository
documentation still points customers/operators to `app.vectornotion.com`.

Expected: every advertised hostname presents a valid certificate and redirects
to the approved canonical domain.

#### QA-004 — production dependency audit contains high advisories

Severity: Critical until runtime triage is complete
Area: Application/supply chain

Reproduction:

1. Run `pnpm audit --prod --audit-level high`.

Observed: the command exits non-zero with 83 advisories: 8 low, 45 moderate,
and 30 high. Notable runtime chains include:

- `@modelcontextprotocol/sdk` 1.25.2: patched at 1.26.0; shared
  server/transport reuse can leak data between clients.
- `@hono/node-server` 1.19.9 and Hono 4.11.4: authentication/static-file/CORS
  advisories with patched releases available.
- `path-to-regexp`, PostCSS, Sharp, and `linkify-it`: denial-of-service or
  file-handling advisories with patched releases.
- `html-minifier` through MJML: ReDoS advisory with no patched release in the
  reported chain, requiring replacement or bounded/isolated input processing.

Expected: no unaccepted reachable high/critical advisory is present in the
release, and a fail-closed lockfile audit blocks future regressions.

Resolution progress (25 July 2026): the candidate production graph now reports
0 critical, 0 high, 1 moderate, and 1 low advisories. MCP/Hono, Babel, routing,
validation, rich-text, PostCSS, Sharp, glob, and YAML chains are patched; MJML
5.4.0 removes `html-minifier`. CI now blocks on
`pnpm audit --prod --audit-level high` across the frozen lockfile. Runtime
reachability, the two residual controls, expiry dates, and verification results are recorded in
`docs/security/dependency-review-2026-07-25.md`. This ticket remains open until
the patched SHA image passes CI and is deployed.

#### QA-005 — release build/typecheck are not reproducible on the development machine

Severity: Critical release-evidence gap
Area: Build

Reproduction:

1. Run `pnpm typecheck`.
2. Run the content-generator typecheck alone with a 3 GiB Node heap.
3. Run `pnpm build:unified`.

Observed: the canonical typecheck was killed with exit 137 near the default
heap limit; the isolated content-generator typecheck also exhausted a 3 GiB
heap; the unified build compiled application code but its Next.js typecheck
worker was OOM-killed. No VM or container memory was increased. CI uses Node 24
and a 4 GiB heap, so the release needs a clean CI result and a resource-safe
local workflow rather than a larger Colima VM.

Expected: supported clean environments can typecheck and build the exact
release deterministically within their documented resource budgets.

Resolution progress (25 July 2026): all Zod 4 consumers are pinned to 4.3.5,
eliminating the duplicate Mastra declaration graph; strict session and webhook
type errors exposed by the repaired graph were fixed. With Node 24.18.0, a
forced zero-cache typecheck completed all 12 package targets plus the sync
worker in 23 seconds with 0.99 GB peak RSS, and `pnpm build:unified` completed
all 91 routes in 36 seconds with 1.55 GB peak RSS. The commands now run
sequentially with a 3 GiB heap cap and are documented in `docs/deployment.md`.
The CI workflow also runs both commands before its SHA-tagged image build. The
ticket remains open until that clean CI job publishes the exact image and its
logs.

### Release-candidate pipeline progress

Resolution progress (25 July 2026): manual release-candidate dispatch now
binds the static checks, canonical/database suites, coverage, two-pass
migration rehearsal, Playwright suite, and required live-provider E2E to the
same commit. It builds all eight application images under the commit SHA only,
generates SBOM/provenance attestations, blocks high/critical Trivy findings,
and retains per-image digests plus scan output in a checksummed candidate
manifest. Candidate builds no longer publish the mutable deployment tag.
P0-07 remains open until this workflow is green for the frozen launch SHA and
the production digest is verified against its manifest.

### Major findings

#### QA-006 — production responses omit baseline security headers

Severity: Major
Area: Web security

Observed on `app.taicho.ai`: no HSTS, CSP, `X-Content-Type-Options`,
clickjacking protection, `Referrer-Policy`, or `Permissions-Policy`; responses
also expose `x-powered-by: Next.js`.

Expected: the approved header policy is present on live HTML and applicable API
responses.

Resolution (25 July 2026): resolved. The canonical nginx vhost now applies the
same checked-in browser policy to HTML, API, Cascade tracking, and error
responses, hides upstream framework disclosure, and suppresses the nginx
version. Live HTML/API/tracking probes return CSP, one-year app-host HSTS,
`nosniff`, `DENY` plus CSP `frame-ancestors 'none'`,
`strict-origin-when-cross-origin`, and the restricted Permissions Policy.
`x-powered-by` is absent. All three Next application configs also disable the
header and share regression-tested policy for defense in depth. The pre-change
nginx file is retained as
`/etc/nginx/sites-available/app.taicho.ai.backup-20260725-security-headers`.

#### QA-007 — live pricing page has insufficient color contrast

Severity: Major
Area: Accessibility

Reproduction:

1. Open `https://app.taicho.ai/pricing` at 390 × 844.
2. Run Axe.

Observed: one serious `color-contrast` violation.

Expected: no serious/critical Axe violations and WCAG AA contrast.

Resolution progress (25 July 2026): the candidate replaces the live 4.01:1
badge pair with a high-contrast violet pair and semibold text. Production-mode
candidate Axe runs at mobile and desktop sizes report zero serious/critical
violations. Live verification is pending deployment.

#### QA-008 — local mobile billing page overflows and has an inaccessible scroller

Severity: Major
Area: Responsive UX/accessibility

Reproduction:

1. Sign in to the audited local release at a 390 × 844 viewport.
2. Open `/billing`.
3. Run Axe and compare document width with viewport width.

Observed: document width was 462 px for a 390 px viewport and Axe reported one
serious `scrollable-region-focusable` violation.

Expected: no horizontal page overflow and every scrollable region is reachable
by keyboard.

Resolution progress (25 July 2026): the candidate stacks the plan actions,
adds `min-width: 0` boundaries, wraps quota metadata, and confines the activity
table to a named focusable scroll region. The authenticated mobile rehearsal
reports 390 px document width at a 390 px viewport and zero serious/critical
Axe violations. Live verification is pending deployment.

#### QA-009 — environment documentation is incomplete

Severity: Major
Area: Configuration

Observed: `.env.example` omits `BETTER_AUTH_URL`, although production auth
startup requires an HTTPS value. Several integration, assistant, email, and
provider variables used by runtime code are also not classified as required or
optional. Enabling Langfuse without `OBSERVABILITY_ID_HASH_KEY` causes
observability initialization to fail closed.

Expected: one validated, redacted environment contract covers every process,
marks required/optional variables, and provides canonical production examples.

Resolution progress (25 July 2026): a checked-in fail-closed validator now
covers the complete release contract and runs before migrations/work in every
production web and worker entrypoint. Dedicated runtime/admin database roles
were provisioned with verified RLS attributes. A stable observability-hash key
plus canonical internal settings were added without restarting production. The runtime
contract improved from 29 pass / 38 fail to 76 pass / 18 fail; the new
fail-closed legal approval contract adds 10 intentionally missing fields, so
the current combined report is 76 pass / 28 fail. The remaining vendor,
Payload/Qdrant, telemetry, email, commercial-operator, outbound-MCP, and
legal launch contracts are itemized in
`docs/security/production-environment-review-2026-07-25.md`; P0-06 remains
open until they are supplied and the deployed startup report passes.

#### QA-010 — health checks do not prove application readiness

Severity: Major
Area: Operations

Observed: unauthenticated `https://app.taicho.ai/api/health` returns 401. The
unified container checks the root route, which can succeed/redirect while
database, graph, migration, or worker dependencies are unusable.

Expected: orchestration and external monitoring consume a purpose-built
readiness signal with safe dependency checks.

#### QA-011 — deployment and base images are mutable

Severity: Major
Area: Release integrity

Observed: production compose/watchtower promotes mutable application tags and
uses tags such as `falkordb/falkordb:latest`. This weakens reproducibility and
rollback confidence.

Expected: the tested digest is promoted intentionally and all critical images
are pinned under an update policy.

#### QA-012 — test isolation can be poisoned by stale automation runs

Severity: Major
Area: Test reliability

Observed: the flow suite passed 13 tests and failed 4 when stale queued rows
from an interrupted prior run remained in the shared automation schema.
`claimNextRun` is global while test cleanup targets only the current random
organization.

Expected: each test run uses an isolated schema/database or reliably cleans all
owned records without depending on unrelated shared state.

#### QA-013 — CI dependency review is advisory

Severity: Major
Area: CI security gate

Observed: `.github/workflows/docker.yml` sets the high-severity dependency
review step to `continue-on-error: true`, and the main job does not run the
production audit command.

Expected: reachable high/critical regressions fail CI unless a visible,
time-limited exception is approved.

Resolution (25 July 2026): GitHub's dependency-review action is unavailable
because Advanced Security is not purchased for this private repository; an
administrator's enable request returned HTTP 422. The unsupported action was
removed rather than shown as a false passing control. After every frozen
install, the test job runs a blocking
`pnpm audit --prod --audit-level high` across the full production lockfile;
Dependabot alerts/updates remain enabled, and architecture regression coverage
prevents the audit from silently becoming advisory.

#### QA-014 — failure pages and route fallbacks are incomplete

Severity: Major
Area: UX/recovery

Observed: no app-level `error.tsx`, `global-error.tsx`, `not-found.tsx`, or
general loading boundary was found in the unified route tree.

Expected: users receive recoverable, branded states with a correlation ID for
unexpected failures and missing routes.

#### QA-015 — lint succeeds with unresolved warnings

Severity: Major for the hook warnings; Minor for the remainder
Area: Code quality

Observed: `pnpm lint` exits zero with 16 warnings. Several content screens have
missing React hook dependencies, alongside unused values, explicit `any`,
unescaped entities, and an internal sign-out navigation using
`window.location.assign`.

Expected: the hook dependency warnings are reviewed for stale-state defects and
the launch branch has a warning budget of zero or an explicitly approved list.

## Checks that passed

- [x] `git diff --check` passed during the audit.
- [x] Lint exited zero, subject to QA-015.
- [x] UI coverage passed: 7 tests; 98.55% statements, 84.48% branches, 94.11%
  functions, and 98.27% lines. This report covers the UI package, not the full
  monorepo.
- [x] Independently exercised non-database suites passed for observability,
  auth, platform, UI, commerce, chat, MCP, intelligence, cascade, atlas, content,
  and outreach after isolating local telemetry/database configuration.
- [x] Auth, commerce, chat, cascade, and MCP migrations
  completed idempotently against the local services; content migration is the
  exception recorded in QA-002.
- [x] Authenticated local pages rendered successfully for dashboard, Brain,
  Squad, outreach leads/personas, primary content screens,
  Cascade screens, billing, profile, settings, administration, credits, and
  support. Publishing calendar/channels exposed QA-002.
- [x] A viewer was redirected from `/admin` to `/access-denied` and
  `GET /api/admin` returned 403.
- [x] Authenticated mobile checks at 390 × 844 found no serious/critical Axe
  violations on dashboard, outreach leads, content, Cascade, or support and no
  horizontal overflow on those pages.
- [x] Live mobile checks found no serious/critical Axe violations on sign-in or
  enterprise and no horizontal overflow on sign-in, pricing, or enterprise.
- [x] `https://app.taicho.ai` redirects unauthenticated users to sign-in;
  sign-in, pricing, and enterprise return 200.
- [x] `taicho.ai` and `docs.taicho.ai` returned 200 during the audit.

## Not verified in this audit

- Authenticated production journeys: no production user credential or
  authorization to mutate production data was used.
- Payment, email, OAuth/social/CRM, and live model-provider side effects: these
  require approved test tenants, secrets, and cost/side-effect controls.
- A complete canonical E2E run: the current canonical unit test gate is already
  red, local port 3000 was owned by an unrelated user process, and the full
  three-server Playwright topology is resource-intensive on this 8 GB machine.
- Production backup restoration, rollback, load, failover, and alert delivery:
  no safe evidence or environment was available.
- The Firecrawl QA connector could not authenticate because no Firecrawl API
  key was available. Live inspection used direct TLS/HTTP requests and
  Playwright instead.

These are evidence gaps, not passes. Their corresponding checklist items remain
open.

## Rerun inputs

For a repeat browser QA run:

```yaml
workflow: firecrawl-qa
url: https://app.taicho.ai
focus: full
```

Suggested local verification commands:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm audit --prod --audit-level high
pnpm build:unified
pnpm test:e2e
```

Run database migrations and E2E tests only against an isolated test database or
an approved production-like clone. Never use the launch database for test
fixtures.

## Exit criteria and sign-off

Launch is eligible for a final go/no-go meeting only when:

1. Every P0 item is checked with evidence.
2. Every P1 item is checked, or a named accountable owner has approved a
   written, time-limited risk acceptance with compensating controls.
3. The exact image digest passed the complete release pipeline and canary soak.
4. Backup/restore and application rollback have been rehearsed.
5. No unresolved critical/high security finding or serious/critical
   accessibility defect remains in an in-scope journey.
6. The sign-off table below is complete.

| Function | Name | Decision | Date | Evidence/notes |
| --- | --- | --- | --- | --- |
| Product |  | [ ] Go / [ ] No-go |  |  |
| Engineering |  | [ ] Go / [ ] No-go |  |  |
| Security/privacy |  | [ ] Go / [ ] No-go |  |  |
| Operations |  | [ ] Go / [ ] No-go |  |  |
| Support |  | [ ] Go / [ ] No-go |  |  |
| Legal/compliance |  | [ ] Go / [ ] No-go |  |  |
