import { Client, Pool, type ClientConfig, type PoolConfig } from 'pg';
import { dedicatedDatabaseRolesRequired } from '@content-automation/database';

declare global {
  // eslint-disable-next-line no-var
  var __platformJobPools: Map<string, Pool> | undefined;
  // eslint-disable-next-line no-var
  var __platformJobAdminPool: Pool | undefined;
}

export function validateJobOrganizationId(organizationId: string): string {
  const value = organizationId.trim();
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(value)) {
    throw new Error('Invalid job organization identifier.');
  }
  return value;
}

function baseConfig(): PoolConfig {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'langgraph',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
  };
}

function runtimeConfig(organizationId: string): PoolConfig {
  const options = `-capp.organization_id=${validateJobOrganizationId(organizationId)}`;
  if (process.env.JOBS_DATABASE_URL) {
    return { connectionString: process.env.JOBS_DATABASE_URL, options };
  }
  if (dedicatedDatabaseRolesRequired()) {
    throw new Error(
      'JOBS_DATABASE_URL is required in production or strict database-role mode and must use a non-superuser, non-BYPASSRLS role.',
    );
  }
  return { ...baseConfig(), options };
}

function adminConfig(): PoolConfig {
  if (process.env.JOBS_ADMIN_DATABASE_URL) {
    return { connectionString: process.env.JOBS_ADMIN_DATABASE_URL };
  }
  if (dedicatedDatabaseRolesRequired()) {
    throw new Error(
      'JOBS_ADMIN_DATABASE_URL is required in production or strict database-role mode and must use the dedicated migration/control-plane role.',
    );
  }
  return baseConfig();
}

export function getJobPool(organizationId: string): Pool {
  const scopedOrganizationId = validateJobOrganizationId(organizationId);
  const pools = globalThis.__platformJobPools ??= new Map<string, Pool>();
  let pool = pools.get(scopedOrganizationId);
  if (!pool) {
    pool = new Pool({
      ...runtimeConfig(scopedOrganizationId),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    });
    pools.set(scopedOrganizationId, pool);
  }
  return pool;
}

/** Migration and ID-only queue-discovery pool. Never use it for tenant payload work. */
export function getJobAdminPool(): Pool {
  if (!globalThis.__platformJobAdminPool) {
    globalThis.__platformJobAdminPool = new Pool({
      ...adminConfig(),
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    });
  }
  return globalThis.__platformJobAdminPool;
}

export function createJobWorkerConnection(organizationId: string): Client {
  return new Client(runtimeConfig(organizationId) as ClientConfig);
}

export async function closeJobPools(): Promise<void> {
  const pools = globalThis.__platformJobPools;
  await Promise.all([
    ...(pools ? [...pools.values()].map((pool) => pool.end()) : []),
    globalThis.__platformJobAdminPool?.end(),
  ]);
  pools?.clear();
  globalThis.__platformJobAdminPool = undefined;
}
