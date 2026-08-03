# Model Context Protocol

Vector Notion exposes its supported product outcomes through one remote MCP endpoint:

```text
https://<application-host>/api/mcp
```

The endpoint uses the official TypeScript MCP SDK, stateless Streamable HTTP, and OAuth access tokens issued by the application's Better Auth authorization server. Product code is invoked directly through shared packages; MCP does not loop back through the application's REST routes.

The design proposal and codebase review that led to this implementation are in [the MCP platform proposal](superpowers/specs/2026-07-23-mcp-platform-design.md).

## Supported platform surface

Tool and resource discovery is filtered by the caller's OAuth scopes, current organization role, product entitlements, and commercial plan. Execution repeats those checks.

| Area | MCP surface |
| --- | --- |
| Workspace | Current workspace, plan and billing resources; workspace brief prompt; core platform get/search tools |
| Brain and intelligence | Brain overview/neighborhood/search; Chat threads; agent profile settings |
| Assistant | Organization-owned chat threads and durable Taicho message operations |
| Content | Projects, sources, research, topics, ideas and drafts; CRUD tools; durable ingest, research, topic extraction, idea generation/refinement and draft generation |
| Outreach | Leads, personas, research, qualification, notes, activities and messages; CRUD tools; durable research, qualification and grounded message generation |
| Cascade | Funnels, steps, routes, contacts, email assets/templates/content, variants and autonomy controls; durable AI template generation |
| Publishing | Channels, OAuth setup links, scheduling, cancel/retry, queue/history and secure media upload handoffs |
| Administration | Members, roles, teams, team administrators, organization usage attribution and service principals |
| Commerce | Plan-change and enterprise inquiries; separately gated platform-operator plan and credit controls |
| Integrations | Organization-owned outbound MCP registry, discovery and allowlisted remote tool calls |

Provider callbacks, tracking endpoints, queue leasing, worker ticks and token refresh remain internal. MCP exposes the user-visible outcome around each of those mechanisms.

## OAuth profile

The authorization server issuer is `https://<application-host>/api/auth`. The protected resource metadata document is:

```text
/.well-known/oauth-protected-resource/api/mcp
```

Authorization server metadata is available at:

```text
/.well-known/oauth-authorization-server/api/auth
```

Two OAuth paths are supported:

- Human clients use authorization code with PKCE. The user signs in, selects an organization, reviews consent, and authorizes the requested scopes. Consent and resulting access tokens are bound to that organization.
- Internal automation uses client credentials with a dedicated service principal. Each principal is fixed to one organization, role, billing member and scope allowlist. Client credentials are returned only when the principal is created or its secret is rotated.

Dynamic client registration is authenticated by default. Set `MCP_ALLOW_PUBLIC_REGISTRATION=true` only when the deployment has intentionally enabled public registration and added appropriate edge rate limits.

Access tokens are JWTs with strict issuer and MCP-resource audience validation. Every request rehydrates live membership, service-principal state, entitlements and plan capabilities, so member removal, entitlement changes and service-principal disablement take effect immediately even for an unexpired token.

## End-user client setup

Workspace administrators can copy the canonical endpoint, OAuth issuer and
protected-resource metadata URL from `/settings`. The public
[MCP connection guide](content/api.mdx) contains current walkthroughs for
Claude, the ChatGPT desktop app, Codex, Cursor, generic OAuth-capable clients
and unattended cloud automation.

For a self-service deployment, an end user supplies only the Streamable HTTP
endpoint:

```text
https://<application-host>/api/mcp
```

The client follows the protected-resource challenge, registers an OAuth client,
opens the Taicho sign-in and organization-selection flow, and stores its access
and rotating refresh tokens. Public dynamic registration is available only
when `MCP_ALLOW_PUBLIC_REGISTRATION=true`. Keep it disabled for managed
deployments; clients must then use an OAuth client ID registered by an
organization administrator. Better Auth applies a dedicated registration rate
limit, and production should also enforce an edge rate limit before enabling
self-service registration.

Examples:

```bash
codex mcp add taicho --url https://<application-host>/api/mcp
codex mcp login taicho --scopes vn:read
```

```json
{
  "mcpServers": {
    "taicho": {
      "url": "https://<application-host>/api/mcp"
    }
  }
}
```

The JSON form is accepted by clients such as Cursor. Claude uses a remote custom
connector created from its Connectors settings. ChatGPT Work on the web uses
remote MCP tools supplied through an installed plugin and does not read the
local Codex configuration.

### Scopes

| Scope | Access |
| --- | --- |
| `vn:read` | Organization resources and read-only discovery/search tools |
| `vn:ai:execute` | Credit-bearing durable AI and research operations |
| `vn:content:write` | Content project, research, topic, idea and draft mutations |
| `vn:content:publish` | Publishing connections, media handoff and post lifecycle |
| `vn:outreach:write` | Outreach leads, personas, activities, messages and persisted research |
| `vn:cascade:write` | Cascade funnels, email assets, enrollment, variants and settings |
| `vn:workspace:write` | Agent profile and assistant-thread mutations |
| `vn:integrations:write` | Outbound MCP connection policies and calls |
| `vn:billing:write` | Commercial requests and inquiries |
| `vn:workspace:admin` | Members, teams, service principals and organization usage reporting |
| `vn:commercial:operator` | Cross-organization commercial operations; restricted to `COMMERCIAL_OPERATOR_EMAILS` and never delegable to a service principal |

OAuth scope is necessary but not sufficient. Existing product roles and commercial capabilities remain authoritative. Credit-bearing operations that mutate a product require both `vn:ai:execute` and that product's write scope.

## Service principals

An organization administrator can use the `oauth.service_principal.create`, `.update`, and `.rotate_secret` tools from a human-authorized MCP session. Creation and rotation return a client secret once. Idempotency records contain a redacted replay value, never the plaintext secret.

A client then requests a token from:

```text
POST /api/auth/oauth2/token
Authorization: Basic <base64(client_id:client_secret)>
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=vn%3Aread&resource=https%3A%2F%2F%3Capplication-host%3E%2Fapi%2Fmcp
```

Use the exact `MCP_RESOURCE_URL` advertised by protected-resource metadata. Do not share service principals between organizations or environments.

## Tenant isolation

MCP PostgreSQL rows are protected by forced row-level security. Request and
per-tenant worker access uses the non-superuser role in `MCP_DATABASE_URL`;
the dedicated `MCP_ADMIN_DATABASE_URL` role is limited to migrations and
ID-only operation/upload discovery before work re-enters a tenant-scoped pool.

The authenticated organization is derived from trusted token claims and cannot be supplied or overridden in tool arguments.

- FalkorDB uses one opaque, hash-derived graph name per organization. Async organization context is required by graph access and propagates through MCP calls and operation workers.
- Cascade and publishing connections set `app.organization_id`; their tables have organization columns, forced row-level security, organization-scoped uniqueness and composite tenant foreign keys.
- Flow, MCP operations, idempotency records, audit events, media handoffs and outbound connections include organization predicates in every lookup and mutation.
- Internal REST proxies overwrite the organization header from their authenticated session; client-provided values are not trusted.

The production application database role must be `NOSUPERUSER NOBYPASSRLS`. Run schema and legacy-assignment commands with a separate migration role, because migration code performs DDL and the explicit assignment scripts temporarily disable RLS inside a transaction.

## Durable operations and credits

AI/research/chat tools enqueue `mcp_operation` records instead of running detached work in the HTTP process. This includes Content generation and research, Outreach research/qualification/message generation, Cascade template generation, and Taicho responses. They reserve credits before enqueueing and return an operation resource URI. Successful completion commits the reservation; failure or pre-start cancellation releases it.

Run at least one supervised worker:

```bash
pnpm mcp:worker
```

Workers claim operations with leases, retry bounded failures, restore the organization graph context and persist progress/result/error. `operation.cancel` applies only before work begins; `operation.retry` creates a fresh credit reservation for a failed operation.

The compatibility-named MCP worker now runs the shared capability executor and signed webhook outbox for both MCP and the versioned REST API. `pnpm capability:worker` is the protocol-neutral command alias. The REST OAuth contract is documented in [External OAuth API](external-api.md).

## Publishing media

Binary data is not embedded in MCP JSON. `publishing.media.upload.create` returns a ten-minute, one-time authenticated `PUT` URL. The client must send the exact `Content-Type` and `Content-Length` it requested. The endpoint validates expiry, size and byte count, writes under an opaque organization R2 namespace, rotates the token hash and rejects replay. A scheduled post may use an MCP-staged R2 key only when the same organization owns the completed handoff.

Set the `RELAY_R2_*` variables and `MCP_MEDIA_UPLOAD_MAX_BYTES` to enable this surface. Upload tokens and service-principal secrets are never persisted in plaintext.

## Outbound MCP

Outbound servers are registered per organization with an explicit tool allowlist. Product code uses the official MCP client and completes initialization/capability negotiation before discovery or execution. Supported auth policies are:

- `none`;
- a bearer token referenced by environment-variable name;
- a custom header value referenced by environment-variable name;
- OAuth client credentials referenced by an environment variable containing JSON such as `{"clientId":"...","clientSecret":"...","scope":"cms:write"}`.

Credential values are resolved only on the server and are not returned through MCP. Production fails closed unless `MCP_OUTBOUND_ALLOWED_HOSTS` contains every exact resource and OAuth issuer hostname. Every SDK request is revalidated and DNS-resolved, private/non-routable addresses are rejected, the validated addresses are pinned to the connection to prevent DNS rebinding, and redirects are rejected. `MCP_OUTBOUND_TIMEOUT_MS` and `MCP_OUTBOUND_MAX_RESPONSE_BYTES` bound remote behavior. An explicitly approved private/on-premise hostname may be placed in `MCP_OUTBOUND_PRIVATE_HOSTS`, but it must also be in the normal allowlist.

Run `integration.mcp.schemas.pin` after registering or changing a connection. It negotiates with the server, requires every allowed tool to exist, and stores canonical SHA-256 input-schema hashes plus the discovered server identity/capabilities. Discovery and invocation then fail closed if a pinned schema disappears or changes. Remote mutation calls require both an allowlisted tool and `confirmExternalCall=true`.

The outreach CMS integration now uses this same official client wrapper rather than hand-written JSON-RPC.

## Audit, idempotency and limits

Every MCP protocol request is recorded in `mcp_audit_event`; business tools add a second capability-specific event containing outcome, duration, entity IDs, idempotency key and credit delta where applicable. Audit metadata does not contain tool arguments or secrets.

Mutating tools require an `idempotencyKey`. Keys are isolated by organization, OAuth client and capability. Reusing a key with different input is rejected. Running leases permit safe recovery, and persisted replay results redact one-time credentials.

The server validates browser origins and limits declared request bodies with `MCP_MAX_REQUEST_BYTES` (1 MiB by default). Secure media has a separate limit. Deploy the endpoint only over HTTPS outside local development and apply normal edge timeouts and rate limits by client and organization.

## Configuration

Required production values:

```dotenv
BETTER_AUTH_URL=https://cloud.taicho.ai
BETTER_AUTH_SECRET=<at-least-32-random-characters>
BETTER_AUTH_TRUSTED_ORIGINS=https://cloud.taicho.ai
MCP_RESOURCE_URL=https://cloud.taicho.ai/api/mcp
MCP_AUTHORIZATION_ISSUER=https://cloud.taicho.ai/api/auth
MCP_ALLOWED_ORIGINS=https://trusted-mcp-client.example
MCP_ALLOW_PUBLIC_REGISTRATION=false
MCP_OUTBOUND_ALLOWED_HOSTS=cms.example.com,another-approved.example
MCP_OUTBOUND_PRIVATE_HOSTS=
MCP_OUTBOUND_TIMEOUT_MS=30000
MCP_OUTBOUND_MAX_RESPONSE_BYTES=5242880
MCP_MAX_REQUEST_BYTES=1048576
MCP_MEDIA_UPLOAD_MAX_BYTES=26214400
MCP_OPERATION_POLL_MS=1000
```

Also configure Postgres, FalkorDB, commerce/AI providers, R2 for media, and each outbound connection's credential environment reference. Keep `.mcp.json` free of literal credentials. The previously tracked CMS credential must be rotated and repository history/CI logs reviewed before rollout.

## Migration and rollout

Back up Postgres and FalkorDB first. In a maintenance window, use the privileged migration role and run:

```bash
pnpm auth:migrate
pnpm commerce:migrate
pnpm cascade:migrate
pnpm automation:migrate
pnpm mcp:migrate
CONTENT_MIGRATION_ORGANIZATION_ID=<org-id> pnpm content:migrate
```

For a database that predates organization ownership, explicitly choose the sole legacy owner. The scripts refuse to infer it, require confirmation, preserve the source Falkor graph, and refuse to overwrite an existing target graph:

```bash
LEGACY_ORGANIZATION_ID=<org-id> MIGRATION_CONFIRM_COPY=yes pnpm graph:assign-legacy
LEGACY_ORGANIZATION_ID=<org-id> MIGRATION_CONFIRM_ASSIGN=yes pnpm cascade:assign-legacy
LEGACY_ORGANIZATION_ID=<org-id> MIGRATION_CONFIRM_ASSIGN=yes pnpm publishing:assign-legacy
```

If legacy data belongs to multiple organizations, do not run the bulk assignment scripts; write and review an explicit record-level mapping migration instead.

Deploy the unified app, MCP worker, Cascade worker and publishing worker. Then verify, in order:

1. Protected-resource and authorization-server metadata use the canonical HTTPS URLs.
2. A human authorization-code client can select an organization, consent and read its workspace.
3. A service principal can obtain a scoped token, initialize MCP and list only permitted tools.
4. Disabling that principal rejects the existing token immediately.
5. Cross-organization graph, Cascade, publishing and operation IDs are not visible or linkable.
6. A durable operation reserves, completes and commits credits; failure/cancel releases them.
7. A one-time media PUT succeeds once and is rejected on replay.
8. An outbound OAuth connection can discover only its allowlisted tools.

## Local verification

After migrations and seeding:

```bash
pnpm --filter @content-automation/auth test
pnpm --filter @content-automation/mcp test
pnpm --filter @content-automation/platform test
pnpm --filter @content-automation/mcp typecheck
pnpm build:unified
```

The database-backed OAuth and complete remote-client suites are opt-in so the default unit command cannot accidentally mutate a developer database. Run them only against a disposable migrated database:

```bash
RUN_MCP_OAUTH_INTEGRATION_TESTS=1 pnpm --filter @content-automation/auth test
RUN_MCP_PLATFORM_INTEGRATION_TESTS=1 pnpm --filter @content-automation/mcp test
```

The MCP test suite also contains an exact owner-surface manifest. It fails if a supported tool, resource, resource template, or prompt disappears from discovery.

For an end-to-end client test, use an OAuth-capable MCP client pointed only at `http://localhost:3000/api/mcp`; it should discover the authorization server from the protected-resource challenge. Avoid manually copying bearer tokens into tracked configuration.

## Operational alerts

Alert on repeated OAuth token failures, denied scope/policy checks, audit insertion failures, operation queue age, exhausted operation retries, reserved-credit age, media upload failures, outbound MCP failures and worker heartbeat loss. Retain audit records according to the organization's compliance policy and redact error details before exposing them as MCP results.
