import { Pool } from "pg";
import { controlPoolConfig, runtimePoolConfig } from "@content-automation/database";

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

function runtimeDatabaseConfig(organizationId: string) {
  const options = `-csearch_path=${publishingSchemaName()} -capp.organization_id=${organizationId}`;
  return { ...runtimePoolConfig(), options };
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

/** Queue-discovery pool. It never has schema ownership or DDL access. */
export function getPublishingAdminPool(): Pool {
  if (!globalThis.__publishingAdminPool) {
    const options = `-csearch_path=${publishingSchemaName()}`;
    globalThis.__publishingAdminPool = new Pool({
      ...controlPoolConfig(),
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
