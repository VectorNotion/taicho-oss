import {
  conversationsInAssistant as conversationsTable,
  databaseFor,
  type Database,
  idempotency_keysInAssistant as idempotencyKeysTable,
  identity_linksInAssistant as identityLinksTable,
  rate_limit_bucketsInAssistant as rateLimitBucketsTable,
  request_receiptsInAssistant as requestReceiptsTable,
} from '@content-automation/database'
import { and, asc, eq, inArray, like, lt, lte, notExists, or, sql } from 'drizzle-orm'
import type { Pool } from 'pg'

export type AssistantRetentionOptions = {
  salesDays?: number
  supportDays?: number
  batchSize?: number
  dryRun?: boolean
}

export type AssistantRetentionResult = {
  dryRun: boolean
  salesConversations: number
  supportConversations: number
  identityLinks: number
  idempotencyKeys: number
  rateLimitBuckets: number
  requestReceipts: number
}

function retentionDatabase(source: Pool | Database): Database {
  return '$count' in source ? source : databaseFor(source)
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return resolved
}

async function deleteConversationBatches(
  source: Pool | Database,
  surface: 'sales' | 'support',
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  let total = 0
  const cutoff = () => new Date(Date.now() - retentionDays * 86_400_000).toISOString()
  while (true) {
    const deleted = await retentionDatabase(source).transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '5s'`)
      await tx.execute(sql`set local statement_timeout = '60s'`)
      const surfacePredicate = surface === 'sales'
        ? and(eq(conversationsTable.surface, 'sales'), like(conversationsTable.subject_id, 'anonymous:%'))
        : and(eq(conversationsTable.surface, 'support'), inArray(conversationsTable.status, ['resolved', 'closed']))
      const candidates = await tx
        .select({ tenantId: conversationsTable.tenant_id, id: conversationsTable.id })
        .from(conversationsTable)
        .where(and(surfacePredicate, lt(conversationsTable.updated_at, cutoff())))
        .orderBy(asc(conversationsTable.updated_at))
        .limit(batchSize)
        .for('update', { skipLocked: true })
      if (candidates.length === 0) return 0
      const byTenant = new Map<string, string[]>()
      for (const candidate of candidates) {
        const ids = byTenant.get(candidate.tenantId) ?? []
        ids.push(candidate.id)
        byTenant.set(candidate.tenantId, ids)
      }
      let count = 0
      for (const [tenantId, ids] of byTenant) {
        const rows = await tx.delete(conversationsTable).where(and(
          eq(conversationsTable.tenant_id, tenantId),
          inArray(conversationsTable.id, ids),
        )).returning({ id: conversationsTable.id })
        count += rows.length
      }
      return count
    })
    total += deleted
    if (deleted < batchSize) return total
  }
}

export async function pruneAssistantData(
  pool: Pool | Database,
  options: AssistantRetentionOptions = {},
): Promise<AssistantRetentionResult> {
  const salesDays = boundedInteger(options.salesDays, 30, 1, 3_650, 'salesDays')
  const supportDays = boundedInteger(options.supportDays, 365, 30, 3_650, 'supportDays')
  const batchSize = boundedInteger(options.batchSize, 1_000, 10, 10_000, 'batchSize')
  const salesCutoff = new Date(Date.now() - salesDays * 86_400_000).toISOString()
  const supportCutoff = new Date(Date.now() - supportDays * 86_400_000).toISOString()
  const db = retentionDatabase(pool)

  if (options.dryRun) {
    const now = new Date().toISOString()
    const [salesConversations, supportConversations, identityLinks, idempotencyKeys, rateLimitBuckets, requestReceipts] = await Promise.all([
      db.$count(conversationsTable, and(
        eq(conversationsTable.surface, 'sales'),
        like(conversationsTable.subject_id, 'anonymous:%'),
        lt(conversationsTable.updated_at, salesCutoff),
      )),
      db.$count(conversationsTable, and(
        eq(conversationsTable.surface, 'support'),
        inArray(conversationsTable.status, ['resolved', 'closed']),
        lt(conversationsTable.updated_at, supportCutoff),
      )),
      db.$count(identityLinksTable, and(
        lt(identityLinksTable.created_at, salesCutoff),
        notExists(sql`select 1 from ${conversationsTable}
          where ${conversationsTable.tenant_id} = ${identityLinksTable.tenant_id}
            and ${conversationsTable.subject_id} = ${identityLinksTable.source_subject_id}`),
      )),
      db.$count(idempotencyKeysTable, lte(idempotencyKeysTable.expires_at, now)),
      db.$count(rateLimitBucketsTable, lte(rateLimitBucketsTable.expires_at, now)),
      db.$count(requestReceiptsTable, lte(requestReceiptsTable.expires_at, now)),
    ])
    return {
      dryRun: true,
      salesConversations,
      supportConversations,
      identityLinks,
      idempotencyKeys,
      rateLimitBuckets,
      requestReceipts,
    }
  }

  const salesConversations = await deleteConversationBatches(pool, 'sales', salesDays, batchSize)
  const supportConversations = await deleteConversationBatches(pool, 'support', supportDays, batchSize)

  const cleanup = await db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`)
    await tx.execute(sql`set local statement_timeout = '60s'`)
    const now = new Date().toISOString()
    const identityLinks = await tx.delete(identityLinksTable).where(and(
      lt(identityLinksTable.created_at, salesCutoff),
      notExists(sql`select 1 from ${conversationsTable}
        where ${conversationsTable.tenant_id} = ${identityLinksTable.tenant_id}
          and ${conversationsTable.subject_id} = ${identityLinksTable.source_subject_id}`),
    )).returning({ tenantId: identityLinksTable.tenant_id })
    const idempotencyKeys = await tx.delete(idempotencyKeysTable)
      .where(lte(idempotencyKeysTable.expires_at, now)).returning({ key: idempotencyKeysTable.key })
    const rateLimitBuckets = await tx.delete(rateLimitBucketsTable)
      .where(lte(rateLimitBucketsTable.expires_at, now)).returning({ key: rateLimitBucketsTable.key })
    const requestReceipts = await tx.delete(requestReceiptsTable)
      .where(lte(requestReceiptsTable.expires_at, now)).returning({ requestId: requestReceiptsTable.request_id })
    return {
      identityLinks: identityLinks.length,
      idempotencyKeys: idempotencyKeys.length,
      rateLimitBuckets: rateLimitBuckets.length,
      requestReceipts: requestReceipts.length,
    }
  })
  return { dryRun: false, salesConversations, supportConversations, ...cleanup }
}
