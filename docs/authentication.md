# Authentication and access control

All three Next.js applications use `@content-automation/auth`. The package owns Better Auth, PostgreSQL persistence, organization membership, product entitlements, and typed role permissions.

## Local setup

```bash
pnpm auth:migrate
pnpm auth:seed
```

The seed creates one organization with both product entitlements and these users:

| Email | Role |
| --- | --- |
| `owner@local.test` | Owner |
| `outreach@local.test` | Outreach operator |
| `content@local.test` | Content editor |
| `viewer@local.test` | Viewer |
| `teamadmin@local.test` | Team administrator for Growth |

The local password defaults to `ContentAutomation123!` and can be changed with `AUTH_SEED_PASSWORD`.

The seed also creates `Growth` and `Editorial` teams. The team administrator can manage Growth membership but cannot create teams, change organization roles, or access Editorial membership.

## Roles and teams

Roles express authority; users and teams are managed resources.

| Scope | Roles | Responsibility |
| --- | --- | --- |
| Organization | Owner, Administrator | Manage users, roles, teams, and both products |
| Delegated team | Team administrator | Manage membership only for explicitly assigned teams |
| Outreach | Outreach manager, Outreach operator | Configure or operate the Outreach product |
| Content | Content manager, Content editor | Configure or operate the Content product |
| Basic | Member, Viewer | Read-only or baseline product access |

The `team_admin` role is attached while a member has at least one row in `team_administrator`. This explicit assignment table is the source of team scope; the role alone never grants access to every team.

## Administration console

The shared console is available at `/admin` in the unified, Outreach, and Content applications. Each app mounts the same `AdminConsole` component and `/api/admin` handler from `@content-automation/auth`, so behavior does not diverge between deployment shapes.

- Owners and administrators see all organization users and teams.
- Team administrators see only members of teams assigned to them.
- Owner removal and owner role changes are blocked.
- Adding a user requires an existing account; the console does not issue temporary passwords.
- All mutations revalidate the session, organization, role, and team scope on the server.

## Required production configuration

- `BETTER_AUTH_SECRET`: random secret of at least 32 characters; use the same value for deployments that share sessions.
- `BETTER_AUTH_URL`: `https://cloud.taicho.ai`, the canonical application URL
  handling OAuth callbacks.
- `BETTER_AUTH_TRUSTED_ORIGINS`: `https://cloud.taicho.ai`. Add another origin
  only when that deployment is intentionally supported and reviewed.
- PostgreSQL: configure `DATABASE_URL` or the existing `POSTGRES_*` variables.

Tenant-owned Cascade and publishing records use separate runtime and
control-plane DSNs:

- `CASCADE_DATABASE_URL` / `CASCADE_DATABASE_ROLE` and
  `PUBLISHING_DATABASE_URL` / `PUBLISHING_DATABASE_ROLE` must identify
  `NOSUPERUSER NOBYPASSRLS` roles.
- `CASCADE_ADMIN_DATABASE_URL` and `PUBLISHING_ADMIN_DATABASE_URL` are reserved
  for migrations and organization-ID-only queue discovery. Request payload
  reads and worker execution always use an organization-fixed runtime pool.
- Generic content/outreach jobs follow the same boundary:
  `JOBS_DATABASE_URL` / `JOBS_DATABASE_ROLE` identify the scoped
  `NOSUPERUSER NOBYPASSRLS` runtime, while `JOBS_ADMIN_DATABASE_URL` is limited
  to migrations, maintenance, and organization-ID-only queue discovery.
- MCP audit, idempotency, operation, connection, and staged-media records use
  `MCP_DATABASE_URL` / `MCP_DATABASE_ROLE` for tenant payloads.
  `MCP_ADMIN_DATABASE_URL` is restricted to migration and ID-only
  operation/upload discovery before the runtime re-enters the tenant pool.

Database roles are provisioned outside the application. Deployment
infrastructure owns role creation, passwords, and the grants required by each
configured DSN. Drizzle migrations own schemas, tables, indexes, constraints,
and row-level-security policies; application startup never creates roles or
changes privileges.
## Browser and session security

- The database-backed session expires after seven days and rotates its expiry
  after one day of activity. Security-sensitive Better Auth operations require
  a session created within the last hour.
- Production session cookies use the `__Secure-` prefix and are explicitly
  `Secure`, `HttpOnly`, `SameSite=Lax`, and scoped to `/`. Cross-subdomain
  cookies are not enabled.
- Sign-out revokes the current database session. Better Auth also exposes
  authenticated session listing and revocation; password reset revokes every
  existing session for the account.
- Better Auth validates state-changing cookie-authenticated requests against
  the exact trusted origin and validates OAuth callback destinations. The
  application does not enable permissive CORS response headers.
- `returnTo` is limited to a relative path in this application. Absolute URLs,
  protocol-relative URLs, backslashes, control characters, sign-in loops, and
  oversized values fall back to `/`.

## OAuth and OIDC providers

`AUTH_OAUTH_PROVIDERS` is a server-only JSON array accepted by Better Auth's generic OAuth plugin. Each provider can use OIDC discovery or explicit authorization, token, and user-info URLs.

```json
[
  {
    "providerId": "company-sso",
    "clientId": "client-id",
    "clientSecret": "client-secret",
    "discoveryUrl": "https://id.example.com/.well-known/openid-configuration",
    "scopes": ["openid", "profile", "email"]
  }
]
```

Expose only button metadata to the browser:

```json
[{ "id": "company-sso", "label": "Company SSO" }]
```

Set that second JSON value as `NEXT_PUBLIC_AUTH_PROVIDERS`.

## Enforcement

Every page and API request passes through a database-validated Better Auth session check. Product entitlement is checked before the role permission. Unauthenticated APIs return `401`; authenticated requests lacking entitlement or permission return `403`. The UI derives navigation from the same authorization context, but server enforcement remains authoritative.
