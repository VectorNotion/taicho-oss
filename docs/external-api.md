# External OAuth API

Taicho exposes an organization-scoped REST API at:

```text
https://<application-host>/api/v1
```

The API and remote MCP endpoint are two protocol adapters over the same capability, authorization, audit, idempotency, durable-operation, and credit boundaries. API handlers do not call MCP, and MCP does not loop back through HTTP.

The machine-readable contract is available without authentication:

```text
GET /api/v1/openapi.json
GET /.well-known/oauth-protected-resource/api/v1
GET /.well-known/oauth-authorization-server/api/auth
```

The OpenAPI 3.1 document is generated from the capability registry, so operation IDs, request schemas, response schemas, routes, and OAuth scope requirements remain aligned with executable code.

## Register an integration

A workspace owner or administrator opens `/settings/developers`. The page supports:

- public or confidential OAuth applications for user-facing integrations;
- exact redirect URI registration;
- authorization-code access with mandatory PKCE;
- service principals for unattended client-credentials access;
- organization role, billing member, audience, and least-privilege scope selection;
- one-time display and rotation of confidential client secrets;
- immediate revocation of an application or service principal.

Public clients do not receive a client secret. Confidential and service-principal secrets are returned once and are never recoverable. Keep public dynamic registration disabled in production with `OAUTH_ALLOW_PUBLIC_REGISTRATION=false`; managed clients are created in the developer console.

Every client must be allowed to request the `api` resource. Access tokens must use the exact audience from `API_RESOURCE_URL`; an MCP token is not accepted by the REST API and an API token is not accepted by MCP.

## Human authorization code with PKCE

Use the authorization and token endpoints advertised by metadata:

```text
GET  /api/auth/oauth2/authorize
POST /api/auth/oauth2/token
```

Create a high-entropy `code_verifier`, send its base64url SHA-256 digest as `code_challenge`, and use `code_challenge_method=S256`. The authorization request includes the exact registered redirect URI, requested scopes, state, and API resource:

```text
https://<application-host>/api/auth/oauth2/authorize?
  response_type=code&
  client_id=<client-id>&
  redirect_uri=<exact-registered-uri>&
  code_challenge=<base64url-sha256-verifier>&
  code_challenge_method=S256&
  scope=vn%3Aworkspace%3Aread%20vn%3Acontent%3Aread&
  resource=https%3A%2F%2F<application-host>%2Fapi%2Fv1&
  state=<unguessable-state>
```

The user signs in, selects a workspace, and reviews consent. The client must verify `state`, then exchange the code:

```bash
curl -X POST https://<application-host>/api/auth/oauth2/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode 'client_id=<client-id>' \
  --data-urlencode 'code=<authorization-code>' \
  --data-urlencode 'redirect_uri=<exact-registered-uri>' \
  --data-urlencode 'code_verifier=<original-verifier>' \
  --data-urlencode 'resource=https://<application-host>/api/v1'
```

Request offline access only for clients that can protect rotating refresh tokens. Browser-only and native applications remain public clients and must use PKCE; a bundled secret does not make them confidential.

## Service principal client credentials

Use client credentials for server-to-server automation with no human present:

```bash
curl -X POST https://<application-host>/api/auth/oauth2/token \
  -u '<client-id>:<client-secret>' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode 'scope=vn:workspace:read vn:content:read' \
  --data-urlencode 'resource=https://<application-host>/api/v1'
```

A service principal is fixed to one organization, live workspace role, billing member, scope allowlist, and resource allowlist. Token validation rechecks the principal, membership, entitlements, subscription, and plan capabilities on every request, so disabling or revoking the principal takes effect before its JWT expires.

## Call the API

Use bearer tokens only in the `Authorization` header:

```bash
curl https://<application-host>/api/v1/workspace \
  -H 'Authorization: Bearer <access-token>' \
  -H 'X-Request-Id: <optional-correlation-id>'
```

Successful responses use one envelope:

```json
{
  "data": {},
  "meta": {
    "requestId": "...",
    "replayed": false,
    "summary": "Loaded the current workspace."
  }
}
```

Failures use `application/problem+json` with a stable `code`, HTTP status, safe detail, instance, and request ID. Authentication failures include a `WWW-Authenticate` challenge pointing to API protected-resource metadata. Responses are `no-store` and include rate-limit headers.

Every mutation requires an `Idempotency-Key` header between 8 and 200 characters:

```bash
curl -X POST https://<application-host>/api/v1/content/projects \
  -H 'Authorization: Bearer <access-token>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: project-import-018f...' \
  -d '{"name":"Launch research"}'
```

Keys are isolated by organization, OAuth client, and capability. Reusing a key with different input returns a conflict. Replays return the stored result and set `Idempotency-Replayed: true`; replay records redact one-time secrets. JSON request bodies are limited to 1 MiB. List endpoints use bounded limits and opaque cursors where the underlying capability is paginated.

Browser access uses an exact `API_ALLOWED_ORIGINS` allowlist. Wildcards are not supported. CORS preflight permits only the documented methods and `Authorization`, `Content-Type`, `Idempotency-Key`, and request-ID headers.

## Scopes

OAuth scope is necessary but not sufficient. Workspace roles, product entitlements, subscription state, and commercial plan capabilities are always enforced again during execution.

| Scope | Access |
| --- | --- |
| `vn:read` | Legacy broad read compatibility while clients migrate to granular read scopes |
| `vn:workspace:read` | Workspace, plan, billing, settings, and Brain reads |
| `vn:content:read` | Content and publishing reads |
| `vn:outreach:read` | Outreach reads |
| `vn:cascade:read` | Cascade reads |
| `vn:operations:read` | Durable operation status |
| `vn:intelligence:read` | Intelligence definitions, runs, artifacts, and attention reads |
| `vn:intelligence:execute` | Execute an Intelligence workflow |
| `vn:intelligence:outcomes:write` | Record outcomes and update attention state |
| `vn:webhooks:read` | Webhook endpoint and delivery status reads |
| `vn:webhooks:write` | Webhook endpoint lifecycle, secret rotation, and redelivery |
| `vn:ai:execute` | Credit-bearing durable AI operations |
| `vn:content:write` | Content project, research, topic, idea, and draft mutations |
| `vn:content:publish` | Secure media handoff and publication lifecycle |
| `vn:outreach:write` | Lead, persona, note, activity, research, qualification, and message mutations |
| `vn:cascade:write` | Funnel, route, enrollment, template, content, email, variant, and autonomy mutations |
| `vn:workspace:write` | Workspace agent-profile mutation |
| `vn:integrations:write` | Publishing connections and webhook administration compatibility |
| `vn:billing:write` | Billing requests |
| `vn:workspace:admin` | Workspace administration |
| `vn:commercial:operator` | Restricted platform commercial operations; never delegated to service principals |

New integrations should request granular read scopes instead of `vn:read`.

## Durable AI operations

Credit-bearing content, outreach, Cascade, and Chat endpoints return `202` with an operation. Poll `/api/v1/operations/{id}`. An operation reserves credits before enqueueing, commits them on success, and releases them on pre-start cancellation or terminal failure. Cancellation and retry use their own idempotency keys.

The supervised `mcp-worker` deployment is now a compatibility name for the shared capability worker. It claims both API- and MCP-created operations and also delivers the webhook outbox:

```bash
pnpm capability:worker
```

The worker always discovers only IDs through its control-plane role, then re-enters the database through an organization-scoped, non-superuser, non-`BYPASSRLS` runtime pool.

## Publishing and secure media

The publishing surface supports channel summaries, supported destinations, queue/history, channel creation or disconnection, publishing-provider OAuth links, scheduling, cancel/retry, and individual post status.

Binary media uses a separate, one-time handoff:

1. Create `/api/v1/publishing/media/uploads` with `vn:content:publish` and an idempotency key.
2. Save the returned `uploadUrl` and one-time `Authorization: Upload ...` header.
3. `PUT` the exact byte count using the authorized `Content-Type` and `Content-Length` within ten minutes.
4. Use the returned opaque `mediaKey` when scheduling a post.

The upload endpoint reads only within a configured bound, rejects byte-count or media-type drift, stores only a token hash, rotates it after success, and permits a completed media key only in its owning organization. Configure R2 and `API_MEDIA_UPLOAD_MAX_BYTES` to enable it.

## Signed webhooks

Workspace owners and administrators create endpoints through `/api/v1/webhooks/endpoints`. A signing secret is returned only on creation or rotation. Select one or more event types advertised by the API, or `*`.

Product-event creation and webhook-outbox insertion happen in the same database transaction. The capability worker claims deliveries with leases, rejects redirects and private/non-routable DNS answers, pins validated DNS results, applies a ten-second timeout, and retries failures with bounded exponential backoff. Failed deliveries can be explicitly requeued.

Each request contains:

```text
X-Taicho-Delivery: <delivery-uuid>
X-Taicho-Event: <event-name>
X-Taicho-Timestamp: <unix-seconds>
X-Taicho-Signature: v1=<hex-hmac-sha256>
```

Verify the HMAC over the exact bytes `timestamp + "." + body`, compare in constant time, reject stale timestamps, and deduplicate by `X-Taicho-Delivery` before processing. Return any `2xx` status only after durable acceptance. Webhook secrets are AES-256-GCM encrypted at rest with `EXTERNAL_WEBHOOK_ENCRYPTION_KEY`.

## Intelligence migration

OAuth replacements live under `/api/v1/intelligence` for workflow definitions and execution, run/artifact lists and detail, attention state, and outcome reporting. The earlier HMAC routes under `/api/intelligence/v1` remain temporarily available and return `Deprecation`, `Sunset`, and successor `Link` headers. The default sunset is February 1, 2027 and can be advanced with `INTELLIGENCE_LEGACY_API_SUNSET` after consumers have migrated.

Do not issue new legacy Intelligence tokens. New consumers use authorization code or client credentials with the granular Intelligence scopes.

## Production configuration and rollout

Required API-specific production values include:

```dotenv
API_RESOURCE_URL=https://cloud.taicho.ai/api/v1
OAUTH_AUTHORIZATION_ISSUER=https://cloud.taicho.ai/api/auth
OAUTH_ALLOW_PUBLIC_REGISTRATION=false
API_ALLOWED_ORIGINS=https://cloud.taicho.ai
API_RATE_LIMIT_READ_PER_MINUTE=120
API_RATE_LIMIT_WRITE_PER_MINUTE=60
API_MEDIA_UPLOAD_MAX_BYTES=26214400
CAPABILITY_DATABASE_URL=postgresql://capability_app:...@postgres:5432/taicho
CAPABILITY_ADMIN_DATABASE_URL=postgresql://capability_admin:...@postgres:5432/taicho
CAPABILITY_DATABASE_ROLE=capability_app
CAPABILITY_OPERATION_POLL_MS=1000
EXTERNAL_WEBHOOK_ENCRYPTION_KEY=<canonical-base64-of-32-random-bytes>
EXTERNAL_WEBHOOK_ALLOWED_HOSTS=
INTELLIGENCE_LEGACY_API_SUNSET=Mon, 01 Feb 2027 00:00:00 GMT
```

`CAPABILITY_DATABASE_URL` and `CAPABILITY_ADMIN_DATABASE_URL` must use distinct roles. MCP database values are accepted only as a rollout fallback while the shared tables retain their compatibility names.

Roll out in this order:

1. Back up Postgres, apply `pnpm db:migrate`, and verify forced RLS and role grants for the capability, rate-limit, webhook, operation, audit, idempotency, and media tables.
2. Configure the exact HTTPS issuer, audiences, origins, database roles, R2, and webhook encryption key; run `pnpm env:validate:production`.
3. Deploy the unified application and the combined capability (`mcp-worker`) deployment.
4. Register a test public PKCE client and service principal in a non-production workspace.
5. Verify exact-audience rejection, least-privilege scope denial, immediate principal disablement, idempotent replay, rate limiting, cross-organization non-disclosure, one-time media replay rejection, durable credit settlement, and signed webhook delivery/redelivery.
6. Migrate legacy Intelligence consumers, observe audit and error rates, then retire HMAC access on the announced date.

Local contract checks that do not require Postgres:

```bash
pnpm --filter @content-automation/capabilities test
pnpm --filter @content-automation/unified-app test
pnpm --filter @content-automation/auth typecheck
pnpm --filter @content-automation/mcp typecheck
pnpm db:check
```
