# Assistant operations

The dashboard support assistant and public website sales assistants share the
`@content-automation/chat` contracts, Postgres conversation store, OpenRouter
model adapter, and Qdrant collection. Qdrant records are separated by `kind`;
support retrieval is restricted to `docs`, while public sales retrieval also
requires the signed Payload tenant, site, and bot identifiers.

## Documentation ingestion

Preview the MDX export without changing external state:

```bash
pnpm chat:preview-docs
```

Ingest the current docs corpus:

```bash
pnpm chat:ingest-docs
```

The command reads `docs/content` by default, produces stable heading-scoped
chunks, signs the request with the tenant knowledge secret, and replaces the
tenant documentation in both Qdrant and Postgres. Use
`ASSISTANT_DOCS_CONTENT_DIR`, `ASSISTANT_DOCS_PUBLIC_URL`, and
`ASSISTANT_KNOWLEDGE_URL` only when the defaults do not match the deployment.

## Retention

Preview candidate deletions:

```bash
pnpm chat:preview-retention
```

Apply retention:

```bash
pnpm chat:prune
```

The default policy removes anonymous sales conversations after 30 days,
resolved or closed support conversations after 365 days, orphaned anonymous
identity links, and expired request receipts, rate-limit buckets, and
idempotency keys. Deletions are bounded in batches. Production runs require the
dedicated assistant admin database connection and should be scheduled by the
deployment platform.

## Deployment checks

Before enabling either assistant, verify:

- the website and dashboard share the correct HMAC secret for their tenant;
- Payload and the dashboard use the same Qdrant collection and embedding model;
- `ASSISTANT_DATABASE_URL` is a tenant-scoped non-superuser role;
- `ASSISTANT_ADMIN_DATABASE_URL` is available only to migrations and retention;
- the Payload assistant bot has trusted product, pricing, docs, contact, and
  support links;
- the docs ingestion and CMS assistant seed have completed successfully.
