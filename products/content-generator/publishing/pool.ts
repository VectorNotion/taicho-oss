import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __publishingPools: Map<string, Pool> | undefined;
  // eslint-disable-next-line no-var
  var __publishingAdminPool: Pool | undefined;
}

export function publishingSchemaName(): string {
  return process.env.PUBLISHING_SCHEMA ?? "publishing";
}

function validatedOrganizationId(organizationId?: string): string {
  const value = organizationId ?? process.env.PUBLISHING_ORGANIZATION_ID ?? "legacy";
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(value)) throw new Error("Invalid publishing organization ID.");
  return value;
}

function baseConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
    database: process.env.POSTGRES_DB ?? "langgraph",
  };
}

function runtimeDatabaseConfig(organizationId: string) {
  const options = `-csearch_path=${publishingSchemaName()} -capp.organization_id=${organizationId}`;
  if (process.env.PUBLISHING_DATABASE_URL) {
    return { connectionString: process.env.PUBLISHING_DATABASE_URL, options };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "PUBLISHING_DATABASE_URL is required in production and must use a non-superuser, non-BYPASSRLS role.",
    );
  }
  return { ...baseConfig(), options };
}

export function getPublishingPool(organizationId?: string): Pool {
  const scopedOrganizationId = validatedOrganizationId(organizationId);
  const pools = globalThis.__publishingPools ??= new Map<string, Pool>();
  let pool = pools.get(scopedOrganizationId);
  if (!pool) {
    pool = new Pool(runtimeDatabaseConfig(scopedOrganizationId));
    pools.set(scopedOrganizationId, pool);
  }
  return pool;
}

/** Migration and queue-discovery pool. Never use it for tenant payload work. */
export function getPublishingAdminPool(): Pool {
  if (!globalThis.__publishingAdminPool) {
    const options = `-csearch_path=${publishingSchemaName()}`;
    const connectionString = process.env.PUBLISHING_ADMIN_DATABASE_URL;
    if (!connectionString && process.env.NODE_ENV === "production") {
      throw new Error("PUBLISHING_ADMIN_DATABASE_URL is required in production.");
    }
    globalThis.__publishingAdminPool = new Pool({
      ...(connectionString ? { connectionString } : baseConfig()),
      options,
    });
  }
  return globalThis.__publishingAdminPool;
}

export async function closePublishingPools(): Promise<void> {
  const pools = globalThis.__publishingPools;
  await Promise.all([
    ...(pools ? [...pools.values()].map((pool) => pool.end()) : []),
    globalThis.__publishingAdminPool?.end(),
  ]);
  pools?.clear();
  globalThis.__publishingAdminPool = undefined;
}
