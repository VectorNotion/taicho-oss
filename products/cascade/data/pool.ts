import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __cascadePools: Map<string, Pool> | undefined;
  // eslint-disable-next-line no-var
  var __cascadeAdminPool: Pool | undefined;
}

export function schemaName(): string {
  return process.env.CASCADE_SCHEMA ?? "cascade";
}

function validatedOrganizationId(organizationId?: string): string {
  const value = organizationId ?? process.env.CASCADE_ORGANIZATION_ID ?? "legacy";
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(value)) {
    throw new Error("Cascade organization IDs may contain only letters, numbers, underscores, and hyphens.");
  }
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
  const options = `-csearch_path=${schemaName()} -capp.organization_id=${organizationId}`;
  if (process.env.CASCADE_DATABASE_URL) {
    return { connectionString: process.env.CASCADE_DATABASE_URL, options };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CASCADE_DATABASE_URL is required in production and must use a non-superuser, non-BYPASSRLS role.",
    );
  }
  return { ...baseConfig(), options };
}

export function getCascadePool(organizationId?: string): Pool {
  const scopedOrganizationId = validatedOrganizationId(organizationId);
  const pools = globalThis.__cascadePools ??= new Map<string, Pool>();
  let pool = pools.get(scopedOrganizationId);
  if (!pool) {
    pool = new Pool(runtimeDatabaseConfig(scopedOrganizationId));
    pools.set(scopedOrganizationId, pool);
  }
  return pool;
}

/** Migration and queue-discovery pool. Never use it for tenant payload work. */
export function getCascadeAdminPool(): Pool {
  if (!globalThis.__cascadeAdminPool) {
    const options = `-csearch_path=${schemaName()}`;
    const connectionString = process.env.CASCADE_ADMIN_DATABASE_URL;
    if (!connectionString && process.env.NODE_ENV === "production") {
      throw new Error("CASCADE_ADMIN_DATABASE_URL is required in production.");
    }
    globalThis.__cascadeAdminPool = new Pool({
      ...(connectionString ? { connectionString } : baseConfig()),
      options,
    });
  }
  return globalThis.__cascadeAdminPool;
}

export async function closeCascadePools(): Promise<void> {
  const pools = globalThis.__cascadePools;
  await Promise.all([
    ...(pools ? [...pools.values()].map((pool) => pool.end()) : []),
    globalThis.__cascadeAdminPool?.end(),
  ]);
  pools?.clear();
  globalThis.__cascadeAdminPool = undefined;
}
