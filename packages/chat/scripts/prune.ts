import { getAssistantAdminPool } from '../data/pool'
import { pruneAssistantData } from '../retention'

function optionalInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`Invalid integer value: ${value}`)
  return parsed
}

const pool = getAssistantAdminPool()
try {
  const result = await pruneAssistantData(pool, {
    salesDays: optionalInteger(process.env.ASSISTANT_SALES_RETENTION_DAYS),
    supportDays: optionalInteger(process.env.ASSISTANT_SUPPORT_RETENTION_DAYS),
    batchSize: optionalInteger(process.env.ASSISTANT_RETENTION_BATCH_SIZE),
    dryRun: process.argv.includes('--dry-run'),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  await pool.end()
}
