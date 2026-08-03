# Platform-owned AI and import catalog

Branches:

- Taicho: `codex/model-choice-prototype`
- Payload CMS: `codex/platform-catalog-cms`

## Ownership boundary

Payload CMS is the control plane. Global super administrators publish the
models and CRM import providers the product may offer. Provider, deployment,
operational status, and opaque secret-manager references remain visible only
in CMS and the protected server-to-server catalog.

Customers do not configure gateways, API keys, deployment names, or provider
health. Taicho gives them only the compatible choices produced after the
published catalog is intersected with the current surface and compiled runtime
support.

## Delivery and enforcement

The CMS endpoint `/api/platform/catalog` requires a private API key and signs
the exact response body with HMAC-SHA256. Taicho verifies the signature and
schema before accepting the catalog, stores the last known good version in
Postgres, and keeps a short per-process cache.

Publishing a catalog record sends a signed refresh event to
`/api/internal/platform-catalog/sync`. Taicho then pulls and verifies the full
catalog. A transient CMS failure falls back to the materialized snapshot.

The browser receives only safe model metadata. It submits stable keys such as
`text-balanced`; the server resolves the private
LiteLLM/FAL deployment only after repeating all policy checks.

## Current surfaces

- Dashboard and `/chat`: capability-filtered language-model choices.
- Historical `/squad/new` prototype (retired): approved language models only; server validation was repeated
  before graph persistence.
- Historical Squad delegation prototype (retired): CMS deployment aliases, with a
  temporary execution path for previously stored OpenRouter slugs.

The old customer `/settings/models` page has been removed. Platform operators
manage both catalogs under **Platform Control Plane** in Payload Admin.

## Provider split

LiteLLM remains the language-model gateway. FAL remains the native creative
execution provider because queued media jobs, webhooks, cancellation, and
model-specific inputs do not fit the language-model gateway abstraction.
Provider credentials remain runtime secrets; CMS stores references, never raw
keys.
