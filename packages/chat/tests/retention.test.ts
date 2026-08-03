import assert from 'node:assert/strict'
import test from 'node:test'
import type { Database } from '@content-automation/database'
import type { Pool } from 'pg'
import { pruneAssistantData } from '../retention'

test('retention dry run reports candidates without issuing deletes', async () => {
  const counts = [12, 3, 4, 5, 6, 7]
  const database = {
    async $count() {
      return counts.shift() ?? 0
    },
  } as unknown as Database

  const result = await pruneAssistantData(database, {
    salesDays: 30,
    supportDays: 365,
    dryRun: true,
  })

  assert.deepEqual(result, {
    dryRun: true,
    salesConversations: 12,
    supportConversations: 3,
    identityLinks: 4,
    idempotencyKeys: 5,
    rateLimitBuckets: 6,
    requestReceipts: 7,
  })
  assert.equal(counts.length, 0)
})

test('retention rejects unsafe retention windows before connecting', async () => {
  let connected = false
  const pool = {
    async connect() {
      connected = true
      throw new Error('should not connect')
    },
  } as unknown as Pool

  await assert.rejects(
    pruneAssistantData(pool, { salesDays: 0 }),
    /salesDays must be an integer/,
  )
  assert.equal(connected, false)
})
