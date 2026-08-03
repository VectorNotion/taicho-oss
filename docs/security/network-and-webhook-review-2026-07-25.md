# Network and webhook security review — 2026-07-25

Status: **implementation complete; release verification pending**

This review covers server-side requests whose destination is supplied by a
customer, tenant, remote provider, or deployment configuration, plus every
unauthenticated webhook receiver in the launch application. It does not record
URLs containing credentials, webhook bodies, signatures, tokens, or secret
values.

## Outbound network boundaries

| Boundary | Destination trust | Controls |
|---|---|---|
| Custom publishing webhook and CMS | Customer-controlled | HTTPS-only in production; exact allow/deny host rules; credentials and fragments rejected; every DNS answer checked; loopback, private, link-local, metadata, mapped, reserved, and mixed public/private answers rejected; DNS answer pinned to the connection; redirects rejected; request, response, and time limits; provider bodies omitted from errors. |
| Publishing media download | Customer-controlled absolute URL | Same public-network boundary with a 25 MiB response cap and 30-second timeout. |
| Remote MCP integrations | Tenant-controlled endpoint and OAuth metadata | Production requires `MCP_OUTBOUND_ALLOWED_HOSTS`; optional private destinations require an explicit second allowlist; every discovered URL is revalidated, DNS-pinned, redirect-blocked, and response-bounded. |
| CRM provider APIs | Provider or OAuth-issued vendor origin | HTTPS plus a provider-specific vendor-domain allowlist, manual redirects, timeouts, and bounded responses. Salesforce, Dynamics, Pipedrive, and Zoho instance origins are constrained to their vendor domains before storage/use. |
| Assistant Payload, Qdrant, and embedding services | Operator-owned deployment configuration | URLs are schema-validated and are not accepted from a public request. These services may intentionally use private service-network addresses, so the public-only policy is not applied. Provider response bodies are not copied into application errors. |
| Social publishing APIs and upload sessions | Fixed provider origin or provider-issued upload session | Fixed provider API origins. Upload-session URLs originate only from an authenticated provider response; they are never accepted from a customer request. |
| Tavily/OpenRouter/OpenAI | Fixed application origin | Fixed HTTPS origin and bounded application inputs; no caller-selected destination. |

The shared public fetch implementation is
`packages/platform/network/safe-fetch.ts`. Publishing adds operator-controlled
exact rules through `PUBLISHING_OUTBOUND_ALLOWED_HOSTS` and
`PUBLISHING_OUTBOUND_DENIED_HOSTS`. A deny rule wins. Production MCP remains
fail-closed until its exact host list is supplied.

## Inbound webhook boundaries

| Receiver | Authentication and freshness | Replay protection | Payload/error handling |
|---|---|---|---|
| Automation webhook | HMAC-SHA256 over timestamp, delivery ID, raw body, and the unguessable workflow token; five-minute window | Delivery ID is part of the durable workflow-run idempotency key | 1 MiB streaming limit; JSON object only; generic client errors and metadata-only rejection logs |
| Workspace email-provider webhook | Resend: Svix-compatible `v1` HMAC over event ID, timestamp, and raw body with a five-minute window. Twilio SendGrid: timestamped ECDSA signature over the raw body with a five-minute window. Mailchimp Transactional: HMAC-SHA1 over the exact configured URL and sorted form fields. Each connection's verification material is stored in an AES-256-GCM workspace credential envelope. | Tenant-scoped `webhook_receipts` primary key; receipt insertion and event ingestion share one transaction | 1 MiB streaming limit; provider-connection/send ownership match; generic 400/401/413 responses; no body/signature logging |
| HubSpot CRM webhook | HubSpot v3 HMAC with canonical request URL and raw body; five-minute provider timestamp window | Provider event ID, or deterministic raw-body hash and array index, stored under a durable connection-scoped unique key | 2 MiB streaming limit; generic verification response and redacted log |
| Pipedrive CRM webhook | Per-connection Basic credentials installed during subscription; required provider timestamp within 24 hours | Provider event ID, or deterministic raw-body hash, stored under the durable inbox unique key | 2 MiB streaming limit and generic failures |
| Zoho CRM webhook | Timing-safe per-connection notification token; required provider timestamp within 24 hours | Channel/event identity, or deterministic raw-body hash, stored under the durable inbox unique key | 2 MiB streaming limit and generic failures |
| Internal sales assistant | HMAC-SHA256 over request ID, timestamp, and raw body; five-minute window; signed tenant/body match | Tenant- and purpose-scoped durable `request_receipts` | 256 KiB streaming limit; generic 400/401/409/413/500 responses; error class only in logs |
| Internal knowledge ingest | Same request-ID-bound HMAC and freshness policy | Tenant- and purpose-scoped durable `request_receipts` | 10 MiB streaming limit; bounded document schema; generic errors |

CRM timestamps use a wider window because vendor retries can be delayed and
the durable event key provides the primary replay defense. Provider
reconciliation jobs recover events rejected outside that window.

## Automated evidence

- `packages/platform/tests/safe-fetch.test.ts` covers private and mixed DNS
  answers, IPv4-mapped IPv6, metadata/link-local ranges, DNS pinning,
  redirects, request/response limits, timeouts, and streaming inbound limits.
- Publishing adapter tests cover signed outbound webhooks, local safe-fetch
  integration, malformed responses, and provider-body redaction.
- Flow tests cover raw-body, token, timestamp, and delivery-ID binding plus
  stale/unsafe rejection.
- Cascade tests cover valid and malformed Svix signatures, stale delivery,
  oversized delivery, and durable replay deduplication.
- CRM provider tests cover HubSpot HMAC behavior, timing-safe Pipedrive/Zoho
  credentials, fresh/stale provider timestamps, and provider HTTP redirect
  rejection.
- Assistant tests cover request-ID/body/timestamp binding, expiry, durable
  tenant-scoped receipts, and provider-error redaction.
- `tests/architecture/network-webhook-boundaries.test.mjs` prevents a public
  receiver or customer-controlled publishing URL from bypassing these
  boundaries.

Verified locally on Node 24:

```text
architecture: 51 passed
platform: 46 passed, 2 opt-in database tests skipped
chat: 18 passed, 1 opt-in Qdrant test skipped
chat PostgreSQL: 2 passed
flow: 20 passed
CRM provider adapters: 9 passed
Cascade webhook/tracking: 8 passed
publishing webhook/CMS adapters: 4 passed
```

## Release blockers and live proof

- Install the real provider webhook secret through the launch workspace's
  Nurture Settings. It must not be invented or reused from the provider API
  key. Verify the workspace-specific URL and one signed event before enabling
  sends.
- Supply and approve `MCP_OUTBOUND_ALLOWED_HOSTS`; no private exception should
  be added without a documented owner and reason.
- Decide whether launch publishing receivers need a global exact allowlist or
  only the built-in public-address deny policy, then set the two publishing
  host variables accordingly.
- Deploy the immutable candidate so its assistant and Cascade migrations
  create the receipt tables under the migration roles.
- Repeat signed positive, invalid-signature, stale, replay, oversized, private
  URL, mixed-DNS, and redirect probes against the candidate/live endpoints.

No production application was restarted or migrated during this review.
SEC-06 remains open until the candidate is deployed and these live checks pass.
