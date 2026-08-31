import { Pool } from "pg";
import { controlPoolConfig, runtimePoolConfig } from "@content-automation/database";

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

function runtimeDatabaseConfig(organizationId: string) {
  const options = `-csearch_path=${schemaName()} -capp.organization_id=${organizationId}`;
  return { ...runtimePoolConfig(), options };
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

/** Queue-discovery pool. It never has schema ownership or DDL access. */
export function getCascadeAdminPool(): Pool {
  if (!globalThis.__cascadeAdminPool) {
    const options = `-csearch_path=${schemaName()}`;
    globalThis.__cascadeAdminPool = new Pool({
      ...controlPoolConfig(),
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
