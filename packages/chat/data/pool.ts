import { Pool } from 'pg'
import { controlPoolConfig, runtimePoolConfig } from '@content-automation/database'
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
  return { ...runtimePoolConfig(), options }
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
    globalThis.__assistantAdminPool = new Pool({
      ...controlPoolConfig(),
      options: `-csearch_path=${assistantSchemaName()} -capp.assistant_tenant_id=control`,
    })
  }
  return globalThis.__assistantAdminPool
}

export function quoteAssistantSchema(): string {
  return `"${assistantSchemaName().replaceAll('"', '""')}"`
}
