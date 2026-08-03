# Production environment review — 2026-07-25

Status: **blocked (76 checks pass, 18 checks fail)**
Target: `graph-server:/root/content-automation/.env`
Canonical origin: `https://app.taicho.ai`
Validator: `pnpm env:validate:production`

This report is intentionally redacted. It records presence, structure,
semantic checks, and database role attributes but never secret values,
passwords, tokens, tenant document IDs, or operator email addresses.

## Completed controls

- Canonical Better Auth, public application, assistant, Cascade, and MCP
  resource/issuer URLs pass.
- The production env file and its new backup are mode `0600`.
- The approved publishing and migration organization ID is shared by Cascade,
  publishing, and content migrations without exposing the ID in this report.
- A separate observability identity-hash key was generated and stored.
- The publishing launch set is explicitly
  `instagram,linkedin,x,youtube`, and every selected credential pair passes the
  presence and minimum-length checks.
- PostgreSQL roles were provisioned and their credentials were stored only in
  the protected env file:

  | Workload | Role | Superuser | Bypass RLS |
  |---|---|---:|---:|
  | Assistant request runtime | `assistant_app` | No | No |
  | Assistant migration | `assistant_admin` | No | Yes |
  | Cascade request/worker runtime | `cascade_app` | No | No |
  | Cascade migration/control plane | `cascade_admin` | No | Yes |
  | Publishing request/worker runtime | `publishing_app` | No | No |
  | Publishing migration/control plane | `publishing_admin` | No | Yes |
  | Generic job runtime | `jobs_app` | No | No |
  | Generic job migration/control plane | `jobs_admin` | No | Yes |
  | MCP request/worker runtime | `mcp_app` | No | No |
  | MCP migration/control plane | `mcp_admin` | No | Yes |

- The empty `assistant` schema is owned by `assistant_admin`; the next release
  migration will create its RLS-protected tables and grant the runtime role.
- The Cascade and publishing schemas are owned by their dedicated admin roles.
  Rollback-only production probes as their runtime roles proved
  cross-organization reads and forged ownership writes are blocked.
- Every production web and worker entrypoint runs the complete redacted
  validator before migrations or work. Unified startup also migrates the
  assistant schema before serving traffic.

The pre-change environment is recoverable from:

`/root/content-automation/.env.backup-20260725-production-contract`

The environment state before the additional tenant roles is recoverable from:

`/root/content-automation/.env.backup-20260725-tenant-roles`

No production service was restarted or recreated during this review.

## Blocking configuration

The following failures are real launch blockers, not values that should be
invented:

| Group | Missing contract | Resolution evidence required |
|---|---|---|
| Outbound MCP | `MCP_OUTBOUND_ALLOWED_HOSTS` | Security-approved exact resource and OAuth issuer hosts; connectivity probe succeeds with redirects/private-address protection enabled. |
| Payload tenant/gateway | `TAICHO_PAYLOAD_TENANT_ID`, `PAYLOAD_ASSISTANT_GATEWAY_URL` | Canonical Payload tenant document ID and reachable HTTPS actions endpoint. |
| Cross-service assistant secrets | `ASSISTANT_INTERNAL_SECRET`, `ASSISTANT_KNOWLEDGE_SECRET`, `PAYLOAD_ASSISTANT_SECRET` | Independently generated values installed on both producer and consumer, followed by authenticated positive and negative probes. |
| Vector/embedding service | `QDRANT_URL`, `QDRANT_API_KEY`, `ASSISTANT_EMBEDDING_API_KEY`, `OPENAI_API_KEY` | Network-reachable Qdrant from the content-automation network, authenticated collection probe, and embedding dimension/model compatibility check. |
| Research provider | `TAVILY_API_KEY` | Provider key and a redacted successful search smoke test. |
| Email | `CASCADE_CREDENTIAL_ENCRYPTION_KEY`, `CASCADE_CREDENTIAL_ENCRYPTION_KEY_VERSION`; provider secrets are encrypted workspace settings | Verified provider connection, sender/domain, workspace-specific webhook, delivered nurture test, and signed/replay-negative webhook probes. |
| Operations telemetry | `DD_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Datadog agent health plus correlated web/worker traces in Datadog and privacy-filtered AI trace in Langfuse. |
| Commercial access | `COMMERCIAL_OPERATOR_EMAILS` | Owner-approved email list; authenticated allow/deny authorization probes. |

## Required and optional contract

Required for every production release:

- Canonical runtime/auth/MCP URLs and origins, Better Auth secret, PostgreSQL
  and FalkorDB connection settings.
- Distinct assistant runtime/migration DSNs and role declarations.
- Stable worker organization IDs and observability identity-hash key.
- Assistant tenant, Payload gateway, Qdrant, embeddings, and cross-service
  credentials.
- OpenRouter, OpenAI embeddings, Tavily, Cascade delivery-provider settings,
  R2, Datadog, and
  Langfuse credentials.
- Explicit `LAUNCH_PUBLISHING_DESTINATIONS`; every selected integration must have its
  complete credential pair.
- Approved commercial operator email addresses.
- Counsel-approved legal-document status, entity/address, legal and privacy
  contacts, effective date, launch markets, infrastructure provider/location,
  and AI-provider data-use position.

Optional unless intentionally enabled:

- `AUTH_OAUTH_PROVIDERS` and `NEXT_PUBLIC_AUTH_PROVIDERS` (both must be valid,
  matching JSON arrays when present).
- The `CMS_MCP_URL`, `CMS_MCP_API_KEY`, and `CMS_TENANT_ID` bundle (all three
  become required together).
- `MCP_OUTBOUND_PRIVATE_HOSTS` (every exception must also be in the ordinary
  outbound allowlist).
- `AUTH_SEED_PASSWORD` after initial seeding; absence is preferred.

## Verification

Local automated evidence:

```text
architecture tests: 36 passed, 0 failed
```

Redacted production validation:

```text
Production environment validation: FAIL
Summary: 76 passed, 0 warnings, 28 failed
```

Release preflight:

```bash
pnpm env:validate:production
pnpm test:architecture
pnpm typecheck
pnpm build:unified
```

P0-06 remains open until the 18 missing runtime/provider contracts and 10
legal-approval fields are supplied, the report passes with zero failures, the
new image starts successfully with validation enabled, and web/worker/provider
smoke tests prove the shared values work across each boundary.
