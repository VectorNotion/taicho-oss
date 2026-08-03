# Database schema and migrations

This package is the only source of truth for PostgreSQL structure.

- `schema/` contains the Drizzle schema for every retained application table.
- `migrations/` contains the ordered, immutable migration history.
- `migrate.ts` applies pending migrations with the dedicated administrative
  database connection.
- `adoption/` is used only once for a pre-Drizzle database. It first verifies
  that the database exactly matches the checked-in baseline, then records that
  baseline before applying later migrations.

Application startup and request handlers must never create, alter, or drop
database objects. The architecture suite enforces that rule.

PostgreSQL role creation, credentials, and grants are deployment
infrastructure, not application schema. Provision the configured runtime and
administrative roles before starting the application. Migrations deliberately
do not create environment-specific roles or grant privileges to usernames from
environment variables.

## Commands

After changing `schema/`:

```sh
pnpm db:generate
pnpm db:check
pnpm db:migrate
```

For an existing database that predates this package, run this exactly once:

```sh
pnpm db:adopt
```

`db:adopt` fails closed if tables are missing or unexpected. A fresh database
uses `db:migrate` directly.

## Query access

Use `databaseFor(pool)` from `@content-automation/database` to obtain the typed
Drizzle client and import table definitions from `@content-automation/database`.
Routine reads and writes should use Drizzle's select/insert/update/delete
builders. PostgreSQL-specific expressions should remain inside Drizzle's
parameterized `sql` expressions; never interpolate caller-controlled values.
