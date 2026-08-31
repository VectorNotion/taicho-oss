# Production secret ownership and rotation

The value-free source of truth is
`ops/security/secret-inventory.json`. It covers application environment
secrets, GitHub release credentials, TLS key material, dynamic CRM/MCP
credentials, and the exposed historical MCP key. Secret values must never be
added to the registry, this document, tickets, logs, or rotation evidence.

## Storage and access

The production environment is stored at `/root/content-automation/.env` as
`root:root` mode `0600`. Six protected rollback copies currently match the
same access boundary under `/root/content-automation/.env.backup-*`. They are
secret-bearing artifacts, not ordinary configuration, and must be removed
through an approved retention decision after the rollback window.

GitHub Actions keeps only release, registry, deployment, and signing credentials;
provider credentials are not available to CI browser jobs.
GitHub's job token and OIDC signing token are short-lived platform-managed
credentials and are intentionally excluded from the static rotation registry.
The production Docker pull credential resides in `/root/.docker/config.json`.
TLS private material remains under `/etc/letsencrypt`.

Only root production operators and the accountable provider owner may retrieve
or replace a value. Evidence records contain the identifier, actor, provider
operation ID, date, and test outcome—never the old or new value.

## Standard rotation procedure

1. Open a security-sensitive change record naming the inventory ID, owner,
   affected services, overlap plan, and rollback path.
2. Create a least-privilege replacement in the authoritative provider or data
   store. Prefer overlapping credentials so validation precedes revocation.
3. Update the protected production store atomically and preserve mode `0600`.
   Update GitHub Actions separately when the record lists it.
4. Restart only affected consumers and run the positive, negative, replay, and
   tenant-bound probes named by the inventory record.
5. Revoke the old credential and prove that it is rejected.
6. Record `lastRotated` in the inventory, review rollback copies, and attach a
   value-free audit record to the release.

Compromise skips the overlap window: disable the credential and affected
feature first, then replace and investigate.

## Automated gates

`pnpm secrets:inventory:check` verifies that every secret-like name in
`.env.example` and GitHub Actions has exactly one owner, storage location,
rotation procedure, and emergency path. Explicit infrastructure and dynamic
secrets are included too.

`pnpm secrets:inventory:launch` is the strict release gate. It also rejects
active credentials with unknown rotation dates, deprecated credentials that
remain present, and any compromised credential. The release-candidate workflow
runs this strict mode before images can be built.

`.gitleaksignore` contains exact historical finding fingerprints only. Six are
false positives for public property names or a function parameter, and one is
the retired MCP credential documented below. Exact fingerprints keep those
reviewed findings auditable without excluding their commits, paths, or rules
from future secret detection.

## Current launch blockers

- Several active application and provider secrets
  lack trustworthy last-rotation dates.

Until those records are resolved, SEC-08 and the strict candidate gate remain
open by design.

On 25 July, the shared registry `admin` login was replaced with separate
`ci-push` and `prod-pull` identities. GitHub Actions and the production Docker
credential store were updated without exposing either value; CI registry
authentication and production manifest access both passed before and after
the old login was removed. The htpasswd file and its timestamped rollback copy
are `root:root` mode `0600`. The current basic-auth registry gives both named
identities the same repository permissions; a future scope-aware token service
is required for true push-versus-pull authorization.

The observability identity hash was generated and installed on 25 July, so its
rotation date is now recorded rather than left unknown.

The historical `MCP_API_KEY` in commit
`48b1efd29b2e947213864e6fb86b2cd2b50eb077` was confirmed to match a stale
local CMS integration value. That value was removed from the active local
environment; production and GitHub contain no matching secret name, the
current MCP client configuration embeds no value, and the old receiver at
`http://localhost:3001/api/mcp/mcp` is decommissioned and rejects the key path
with HTTP 404. No replacement was issued because the integration is disabled.
The historical commit remains audit evidence of a retired credential and must
never be treated as a usable secret.

On 25 July, the deterministic seed was made production-ineligible and stopped
logging its password. The five existing `@local.test` credential hashes were
cleared and their 13 sessions revoked without deleting tenant records. A
checksummed database backup was taken first. `AUTH_SEED_PASSWORD` and the
unused `NEO4J_PASSWORD` were removed from the protected active env; the
currently running unified container was not restarted and therefore retains
its prior environment snapshot until the next controlled candidate recreate.
The disabled credential hashes make that stale seed value unusable, and its
logs contain no seed-password entries.
