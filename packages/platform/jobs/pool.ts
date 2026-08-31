import { Client, Pool, type ClientConfig, type PoolConfig } from 'pg';
import { controlPoolConfig, runtimePoolConfig } from '@content-automation/database';

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

function runtimeConfig(organizationId: string): PoolConfig {
  const options = `-capp.organization_id=${validateJobOrganizationId(organizationId)}`;
  return { ...runtimePoolConfig(), options };
}

function adminConfig(): PoolConfig {
  return controlPoolConfig();
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

/** ID-only queue-discovery pool. It never has schema ownership or DDL access. */
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
