# Tenant-isolation review — 25 July 2026

Status: **implemented and locally verified; production activation awaits the
immutable release candidate**

This review covers every shared persistence or work-discovery boundary used by
the launch application. A ticket is not considered closed merely because a
repository query includes an organization identifier: the runtime identity
must also be unable to bypass the store's isolation control.

## Boundary design

| Store or queue | Runtime boundary | Control-plane boundary | Enforced isolation |
| --- | --- | --- | --- |
| Cascade PostgreSQL | `cascade_app` plus `app.organization_id` | `cascade_admin` | Forced RLS, composite tenant foreign keys, per-organization identities |
| Publishing PostgreSQL | `publishing_app` plus `app.organization_id` | `publishing_admin` | Forced RLS, composite channel ownership, organization-scoped idempotency |
| Assistant PostgreSQL | `assistant_app` plus `app.assistant_tenant_id` | `assistant_admin` | Forced RLS for conversations, messages, feedback, tickets, and lead context |
| Generic job queue | `jobs_app` plus `app.organization_id` | `jobs_admin` | Forced RLS with organization-scoped runtime access |
| MCP state and queue | `mcp_app` plus `app.organization_id` | `mcp_admin` | Forced RLS for audit, idempotency, operations, connections, and media uploads |
| FalkorDB | One graph name per organization | None for payload access | Organization-derived graph names; callers cannot supply a raw graph name |
| Qdrant | Mandatory tenant, site, bot, and document-kind filter | Ingestion service | Server-side payload filters plus result-side scope validation |
| Webhooks and tracking | Signed or stored organization binding | ID-only lookup where unavoidable | Organization is recovered from a signed token or control lookup, then processing re-enters a scoped runtime |

Runtime pools fail closed in production when their dedicated DSN or declared
role is absent. Migration/control-plane pools are separate and are limited to
schema migration or an ID-only ownership lookup. Background workers never use
the control pool to read or mutate tenant payloads.

There are no customer data export routes in the candidate. An architecture
test fails if an `export` or `download` route is added before its two-tenant
negative test and isolation review.

## Negative verification

The database-enabled suites create temporary non-superuser,
non-`BYPASSRLS` roles. They create two tenants and prove that reads, updates,
inserts, relationship changes, and queue claims cannot cross the boundary:

- `products/cascade/tests/tenant-isolation.test.ts`
- `products/content-generator/tests/publishing-tenant-isolation.test.ts`
- `packages/chat/tests-postgres/rls-isolation.test.ts`
- `packages/platform/tests/job-attribution.test.ts`
- `packages/mcp/tests/operation-attribution.test.ts`

Non-PostgreSQL boundaries are exercised separately:

- `packages/platform/tests/falkordb-tenant-isolation.test.ts` writes the same
  logical probe into two real organization graphs and proves neither graph can
  read or overwrite the other.
- `packages/chat/tests/qdrant.integration.test.ts` writes equally similar
  private documents for two tenants to a real Qdrant collection and proves
  each retriever receives only its own document.
- `packages/chat/tests/qdrant.test.ts` also verifies the exact mandatory filter
  and rejects an out-of-scope point even if a vector service returns it.
- Cascade signed tracking-token tests prove ownership is recovered before
  tenant payload processing.

`tests/architecture/tenant-isolation.test.mjs` prevents a store, worker, or
export surface from silently dropping these controls. The architecture suite
passes 48 of 48 checks. The real Qdrant assistant suite passes 16 of 16 tests,
and each PostgreSQL/FalkorDB suite listed above passed locally with its
database opt-in enabled.

## Production preparation

Production role attributes were verified without exposing credentials:

| Role class | Superuser | Bypass RLS |
| --- | ---: | ---: |
| All `*_app` runtime roles | No | No |
| All `*_admin` migration/control roles | No | Yes |

The `cascade` and `publishing` schemas are owned by their dedicated admin roles.
Their runtime DML grants are installed; live rollback-only probes proved both
cross-organization reads and forged organization writes are blocked.

Protected production environment entries were added for Cascade, publishing,
jobs, and MCP runtime/admin DSNs and declared runtime
roles. The redacted production validator now reports 76 passing checks and 17
unrelated missing-provider/operations checks. No service was restarted, so the
currently deployed legacy image continues to use its original environment.

Pre-change recovery material:

- Database dump:
  `/root/taicho-backups/pre-sec05-20260725T021535Z.sql.gz`
- Database dump checksum:
  `/root/taicho-backups/pre-sec05-20260725T021535Z.sql.gz.sha256`
- Environment backup:
  `/root/content-automation/.env.backup-20260725-tenant-roles`

## Remaining closure evidence

SEC-05 stays open until the exact immutable candidate:

1. passes all database-enabled tests in CI;
2. runs the publishing and automation migrations during a controlled rollout;
3. starts every web and worker process with the dedicated runtime/admin DSNs;
4. repeats the live cross-tenant probes against the deployed runtime; and
5. confirms no export surface was added without its negative test.
