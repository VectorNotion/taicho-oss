# Primary journey release rehearsal

> Historical launch snapshot. The current policy keeps browser execution out of
> CI: the production-release agent runs the relevant flows against development,
> commits the evidence under `tests/browser-qa/`, and the production workflow
> validates those records without launching a browser.

Date: 25 July 2026
Ticket: UX-05
Environment: isolated local launch graph and PostgreSQL schemas, Node 24,
Chromium and the unified app plus its product workers
Candidate status: historical implementation evidence only

## Coverage

| Journey | Deterministic evidence | Live-provider evidence |
| --- | --- | --- |
| Lead creation and outreach | A realistic lead is created through the API, queried from the lead workspace, and advanced through manual outreach. | Lead qualification and web-backed research stream and settle against configured providers. |
| Content | Project, idea, draft, channel, scheduled post, publication state, calendar visibility, and cancellation are exercised with disposable records. | Idea refinement, draft and idea generation, topic extraction, project graph extraction, and web-backed research stream and settle. |
| Nurture | Template, content, composed email, funnel, email step, variant validation/approval, enrollment, and retirement are exercised. | Template generation streams from the configured model provider and produces the required slots. |
| Sales assistant | A signed internal request completes a deterministic assistant turn across the service boundary. | Not required for the deterministic boundary check. |
| Support assistant | The browser renders a cited answer, offers escalation, and completes ticket creation against the support SSE contract. | Provider-independent contract lane; provider failure behavior is covered separately. |
| Account and administration | Profile, agent settings save/restore, workspace administration, and billing request access render and submit successfully. | Not provider-dependent. |

## Enforced failure policy

The primary and live-provider suites fail on:

- browser `console.error` output;
- any HTTP response with status 500 or greater; and
- failed `fetch` or XHR requests.

Aborted document navigations are intentionally excluded because authentication
redirects cancel obsolete page requests and do not represent API failures.

## Local results

Commands were run against `http://localhost:3104` with
`PLAYWRIGHT_SKIP_WEBSERVER=1` so the isolated app and real workers could share
one stable environment:

- `launch-primary-journeys.spec.ts` plus `automation-runtime.spec.ts`: 9/9
  passed with the failure monitor enabled.
- `generative-ui-live.spec.ts` plus
  `generative-ui-outreach-live.spec.ts`: 2/2 passed before the failure monitor
  was added; a monitored repeat is recorded in the tracker when it completes.
- Sync storage focused tests: 8 passed and 1 provider integration test skipped
  when R2 credentials were not selected.

All tests create uniquely named records and remove mutable journey fixtures in
cleanup paths. Test-only local object storage is rejected when
`NODE_ENV=production`; production continues to require the configured R2
contract.

## Release-candidate closure gate

Under the current release policy, closure requires the release agent to run the
deterministic and required provider flows against development, commit their
Browser QA evidence to the immutable launch commit, and pass the production
record-integrity gate. The deployed digest must match that commit.
