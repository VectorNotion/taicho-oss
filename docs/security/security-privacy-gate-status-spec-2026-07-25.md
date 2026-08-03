# Security and privacy gate status — paused handoff

- Status date: 25 July 2026
- Work state: **Paused by owner request**
- Working branch: `launch/security-privacy-gates`
- Draft pull request: [#7](https://github.com/rkumar1310/content-automation/pull/7)
- Paused implementation baseline: `24cad9beb556a6ac74913addeefe634f8dddce2c`
- Production deployment from this branch: **Not performed**

## Purpose

This document is the resume point for the security/privacy launch-readiness
work. It separates completed implementation from gates that still require
candidate, deployment, provider-console, operational, or named-approval
evidence.

The full launch tracker remains
[`docs/launch-readiness-checklist.md`](../launch-readiness-checklist.md). Do not
check a gate in either document merely because its repository implementation is
complete.

## Status snapshot

- Security/privacy implementation: **10/10 complete**
- Security/privacy gates fully closed: **2/10**
- Security/privacy gates still open: **8/10**
- Overall launch engineering work: **22/52 complete**
- Overall launch gates fully closed: **4/52**
- Current launch decision: **NO-GO**
- Production dependency audit on the branch: **0 critical, 0 high, 1 moderate,
  1 low**
- Local architecture verification: **77/77 passed**
- Latest pull-request run: security and canonical test jobs passed; browser
  E2E failed

## Per-gate status

| Gate | Implementation | Gate | Completed work | Evidence still required |
| --- | --- | --- | --- | --- |
| SEC-01 — security headers | Complete | **Closed** | CSP, HSTS, framing, MIME, referrer, and permissions policies are implemented, regression-tested, and verified on live responses. | None for this gate unless the edge policy changes. |
| SEC-02 — framework disclosure | Complete | **Closed** | `x-powered-by` is disabled in the applications and absent from live responses. | None for this gate unless the runtime or proxy changes. |
| SEC-03 — authentication abuse protection | Complete | **Open** | Durable auth throttling, waitlist-only signup, privacy-safe alerts, and enumeration-safe errors are implemented and tested. | Pass the immutable-candidate tests and safely exercise the deployed edge limits. |
| SEC-04 — session and request-origin policy | Complete | **Open** | Session expiry/revocation, secure cookie policy, CSRF/origin checks, one canonical trusted origin, OAuth state binding, and safe `returnTo` behavior are regression-tested. | Capture immutable-candidate and deployed-cookie/request-origin evidence. |
| SEC-05 — tenant isolation | Complete | **Open** | Forced PostgreSQL RLS, scoped runtime roles, tenant foreign keys, worker re-entry, signed webhook ownership, per-tenant FalkorDB graphs, mandatory Qdrant filters, and two-tenant negative suites are implemented. | Deploy the scoped roles and migrations from a signed candidate, then repeat the rollback-only live probes. |
| SEC-06 — outbound URLs and webhooks | Complete | **Open** | DNS-pinned SSRF protection, exact host rules, private/metadata denial, bounded bodies, provider-specific webhook signatures, replay storage, and redacted errors are implemented and tested. | Connect and verify the launch workspace's provider webhook through Nurture Settings; approve the exact MCP/publishing outbound hosts or disable those features; apply receipt migrations; run candidate and live negative probes. |
| SEC-07 — secret scanning and supply chain | Complete | **Open** | Blocking Gitleaks, CodeQL SARIF, dependency audit, Trivy, SBOM, provenance, Cosign signing/verification, digest-bound promotion, and historical MCP-key retirement controls are implemented. The latest security job passed with three retained findings and zero blockers. | Pass the complete release-candidate workflow from the default branch; retain scans, attestations, signatures, and digests for all eight images; positively verify them on the production host. |
| SEC-08 — secret ownership and rotation | Complete | **Open** | A value-free inventory, structural CI validation, split/rotated registry identities, root-only production secret files, seed-credential retirement, and historical MCP-key retirement are complete. | Rotate and rehearse revocation for the eight records with unknown dates: Better Auth signing, PostgreSQL owner, CRM envelope, OpenRouter, Tavily, Cascade link signing, R2 media, and publishing-provider credentials. |
| SEC-09 — customer legal and data documents | Complete | **Open** | Public fail-closed draft pages cover Privacy, Terms, subprocessors, DPA, AI disclosure, retention/deletion/export, acceptable use, and cookies/telemetry; they remain `noindex`. | Named Legal and Product approval, executed provider/DPA terms, approved production metadata, and tested contact routes. |
| SEC-10 — continuous dependency maintenance | Complete | **Open** | Dependabot coverage, ownership/SLA policy, time-limited exceptions, and blocking validation are implemented; the branch has no critical/high production advisory. | Merge to the default branch, observe the first update run, reconcile the refreshed graph, and remediate or obtain accountable approval for the two exceptions expiring 15 August 2026. |

## Latest candidate validation

[Workflow run 30147424926](https://github.com/rkumar1310/content-automation/actions/runs/30147424926)
tested commit `24cad9b`.

| Lane | Result | Evidence |
| --- | --- | --- |
| Change detection | Passed | Workflow job completed successfully. |
| Security | Passed | Gitleaks passed; CodeQL reported 3 retained findings and 0 blocking high-confidence error/high/critical findings. |
| Canonical test | Passed | Clean migrations, lint, typecheck, unified build, canonical tests, and coverage completed successfully. |
| Browser E2E | **Failed** | 26 passed, 3 failed, and 2 live-provider tests were skipped. |
| Live-provider | Not run | This pull-request run was not a manually dispatched release candidate. |
| Images, scans, signing, manifest | Not run | Downstream candidate jobs were skipped after E2E failed and because no default-branch release candidate was dispatched. |

### Browser failures to resume from

1. `accessibility.spec.ts` — `/legal` uses `text-primary` at a measured 4.02:1
   contrast ratio on the dark card background; WCAG AA requires 4.5:1 for that
   text size.
2. `automation-runtime.spec.ts` — the failure monitor records aborted automation
   run page/API requests during the durable-log navigation. The symptom is
   captured; root cause has not been established.
3. `commercial-boundaries.spec.ts` — the unentitled-workspace scenario reaches
   the content page but records browser `Failed to fetch` errors. The symptom is
   captured; root cause has not been established.

No gate credit was given for this run, and no retry was started after the pause
request.

## Owner inputs required before gates can close

| Input | Gates affected |
| --- | --- |
| Approval to merge the draft PR, dispatch a strict candidate, and schedule a controlled maintenance/deployment window | SEC-03 through SEC-07 |
| Verified launch-workspace delivery-provider webhook and exact outbound-host decisions | SEC-06 |
| Provider/production console access to rotate and rehearse the eight unresolved credentials | SEC-08 |
| Named Legal and Product approvals plus executed provider/DPA terms | SEC-09 |
| Named accountable approval or remediation for the two dependency exceptions | SEC-10 |

Secret values must not be pasted into this document, a pull-request comment, or
chat. Supply them only through the approved secret store or provider console.

## Resume order

1. Reproduce and resolve the three browser failures; rerun only the focused
   specs first.
2. Run the complete pull-request workflow and require security, canonical test,
   and browser lanes to pass on one commit.
3. Obtain the owner inputs above; do not infer approvals.
4. Merge only after review, then observe the first default-branch dependency
   update run.
5. Dispatch the strict release-candidate workflow and retain all scan,
   attestation, signature, and digest evidence.
6. During an approved maintenance window, rotate remaining credentials, deploy
   the signed candidate, and run the defined live negative probes.
7. Reconcile the main launch checklist and request named sign-off.

## Evidence index

- [Authentication access policy](../product/signup-access-policy.md)
- [Tenant-isolation review](tenant-isolation-review-2026-07-25.md)
- [Network and webhook review](network-and-webhook-review-2026-07-25.md)
- [Supply-chain review](supply-chain-review-2026-07-25.md)
- [Secret ownership and rotation](secret-ownership-and-rotation.md)
- [Legal launch review](../legal/launch-legal-review.md)
- [Dependency review](dependency-review-2026-07-25.md)
- [Dependency maintenance policy](dependency-maintenance.md)
