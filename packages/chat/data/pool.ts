import { Pool } from 'pg'
import { validatedTenantId } from '../security'

declare global {
  // eslint-disable-next-line no-var
  var __assistantPools: Map<string, Pool> | undefined
  // eslint-disable-next-line no-var
  var __assistantAdminPool: Pool | undefined
}

export function assistantSchemaName(): string {
  const value = process.env.ASSISTANT_SCHEMA ?? 'assistant'
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value)) throw new Error('Invalid ASSISTANT_SCHEMA.')
  return value
}

function databaseConfig(tenantId: string) {
  const options = `-csearch_path=${assistantSchemaName()} -capp.assistant_tenant_id=${tenantId}`
  const connectionString = process.env.ASSISTANT_DATABASE_URL
    ?? (process.env.POSTGRES_HOST ? undefined : process.env.DATABASE_URL)
  if (process.env.NODE_ENV === 'production' && !process.env.ASSISTANT_DATABASE_URL) {
    throw new Error('ASSISTANT_DATABASE_URL is required in production and must use a non-superuser, non-BYPASSRLS role.')
  }
  if (connectionString) return { connectionString, options }
  return {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'postgres',
    password: process.env.POSTGRES_PASSWORD ?? 'postgres',
    database: process.env.POSTGRES_DB ?? 'langgraph',
    options,
  }
}

export function getAssistantPool(tenantId: string): Pool {
  const scopedTenantId = validatedTenantId(tenantId)
  const pools = globalThis.__assistantPools ??= new Map<string, Pool>()
  let pool = pools.get(scopedTenantId)
  if (!pool) {
    pool = new Pool(databaseConfig(scopedTenantId))
    pools.set(scopedTenantId, pool)
  }
  return pool
}

export function getAssistantAdminPool(): Pool {
  if (!globalThis.__assistantAdminPool) {
    const connectionString = process.env.ASSISTANT_ADMIN_DATABASE_URL
      ?? (process.env.POSTGRES_HOST ? undefined : process.env.DATABASE_URL)
    if (process.env.NODE_ENV === 'production' && !process.env.ASSISTANT_ADMIN_DATABASE_URL) {
      throw new Error(
        'ASSISTANT_ADMIN_DATABASE_URL is required in production and must use the dedicated migration role.',
      )
    }
    globalThis.__assistantAdminPool = new Pool(connectionString
      ? { connectionString, options: `-csearch_path=${assistantSchemaName()} -capp.assistant_tenant_id=migration` }
      : {
          host: process.env.POSTGRES_HOST ?? 'localhost',
          port: Number(process.env.POSTGRES_PORT ?? 5432),
          user: process.env.POSTGRES_USER ?? 'postgres',
          password: process.env.POSTGRES_PASSWORD ?? 'postgres',
          database: process.env.POSTGRES_DB ?? 'langgraph',
          options: `-csearch_path=${assistantSchemaName()} -capp.assistant_tenant_id=migration`,
        })
  }
  return globalThis.__assistantAdminPool
}

export function quoteAssistantSchema(): string {
  return `"${assistantSchemaName().replaceAll('"', '""')}"`
}
