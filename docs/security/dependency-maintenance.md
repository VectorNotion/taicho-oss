# Dependency maintenance policy

Owner: **Application Security / `@rkumar1310`**
Effective for the launch branch: 25 July 2026

GitHub dependency alerts were enabled on 25 July and the repository now has
the configured `dependencies` label. The default-branch baseline reconciled by
API on 25 July is 206 open records: 4 critical, 85 high, 96 moderate, and 21
low. Those alerts reflect the current remote `main`; the unmerged candidate
lockfile locally audits at 0 critical/high. Alerts must be reconciled only
after the patched commit is merged and GitHub refreshes its graph.

## Automated update lanes

Dependabot checks the pnpm workspace, GitHub Actions, Dockerfiles, and
production Compose every Monday in `Asia/Kolkata`. Minor and patch npm updates
are grouped by production/development scope; security fixes have a dedicated
group; major changes remain isolated. Action and image updates are separately
bounded, and open pull requests are capped so maintenance cannot flood the
queue.

No dependency PR auto-merges. The normal release checks—lint, typecheck,
canonical/database tests, Playwright, full-lockfile dependency audit, local
CodeQL SARIF gate, Gitleaks, image scan, attestations, and signing—remain
mandatory. GitHub-hosted dependency review and code-scanning dashboards are
not claimed because Advanced Security is unavailable on the current private
repository plan.

## Review SLA

| Severity / update | Acknowledge | Remediate or approve bounded exception |
| --- | ---: | ---: |
| Critical, reachable | 4 hours | 24 hours |
| High, reachable or unknown | 1 business day | 3 business days |
| Moderate | 3 business days | 14 calendar days |
| Low | 10 business days | 30 calendar days |
| Routine minor/patch PR | 5 business days | Next planned release |
| Major upgrade | 10 business days | Scheduled design/test window |

The owner triages runtime reachability, public exploitability, fixed versions,
breaking-change risk, and affected images. Alerts stay open until the patched
digest is deployed, not merely until a lockfile changes.

## Exception rules

`ops/security/dependency-exceptions.json` is the only accepted exception
registry. Every record names packages, severity, accountable owner, rationale,
compensating controls, upgrade trigger, approval, and expiry. Critical/high
exceptions are forbidden by the strict launch gate. An expired exception fails
CI even in structural mode.

```bash
pnpm deps:exceptions:check
pnpm deps:exceptions:launch
```

The first command verifies visibility, ownership, controls, and future expiry
on every CI run. The release-candidate workflow runs strict mode and rejects
pending approval. The patched Babel and Hono entries were removed after their
Node 24 tests and typechecks passed. The two remaining moderate/low entries
expire on 15 August 2026 and remain pending owner approval.

## Operating rhythm

1. Monday: review newly opened update PRs and security alerts.
2. Reproduce the advisory against the production graph and document
   reachability without copying exploit secrets or customer data.
3. Patch and exercise affected package plus architecture/integration suites.
4. If no compatible patch exists, add a short exception and obtain accountable
   approval before a candidate; never weaken the high/critical CI threshold.
5. Merge only after required checks and review. Deploy through the immutable
   candidate pipeline and close the alert after digest verification.
6. At each monthly review, remove obsolete overrides/patches and close or renew
   exceptions through a new approval; silent extension is not allowed.

Official schema reference:
<https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference>.
