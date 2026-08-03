import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Pool } from 'pg'

import { PostgresAssistantRepository } from '../repository'

function databaseUrl(user?: string, password?: string): string {
  const source = process.env.DATABASE_URL?.trim()
    || `postgresql://${encodeURIComponent(process.env.POSTGRES_USER ?? 'postgres')}:${encodeURIComponent(process.env.POSTGRES_PASSWORD ?? 'postgres')}@${process.env.POSTGRES_HOST ?? 'localhost'}:${process.env.POSTGRES_PORT ?? '5432'}/${process.env.POSTGRES_DB ?? 'langgraph'}`
  const url = new URL(source)
  if (user) url.username = user
  if (password) url.password = password
  return url.toString()
}

test('assistant runtime role enforces RLS for sales and support storage', async () => {
  const suffix = randomUUID().replaceAll('-', '')
  const schema = 'assistant'
  const role = `assistant_test_${process.pid}_${suffix.slice(0, 10)}`
  const password = `T3st${suffix}`
  const tenantA = `assistant_a_${suffix}`
  const tenantB = `assistant_b_${suffix}`
  const admin = new Pool({
    connectionString: databaseUrl(),
    options: `-csearch_path=${schema}`,
  })
  let poolA: Pool | undefined
  let poolB: Pool | undefined

  try {
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`,
    )
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`)
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`)
    await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${role}"`)

    const runtimeUrl = databaseUrl(role, password)
    poolA = new Pool({
      connectionString: runtimeUrl,
      options: `-csearch_path=${schema} -capp.assistant_tenant_id=${tenantA}`,
    })
    poolB = new Pool({
      connectionString: runtimeUrl,
      options: `-csearch_path=${schema} -capp.assistant_tenant_id=${tenantB}`,
    })
    const repositoryA = new PostgresAssistantRepository(poolA, tenantA)
    const repositoryB = new PostgresAssistantRepository(poolB, tenantB)
    const conversationA = await repositoryA.ensureConversation({
      tenantId: tenantA,
      surface: 'support',
      subjectId: 'user:a',
      accountId: 'account-a',
      userId: 'user-a',
    })
    const conversationB = await repositoryB.ensureConversation({
      tenantId: tenantB,
      surface: 'sales',
      subjectId: 'anonymous:b',
    })

    await assert.rejects(
      repositoryB.ensureConversation({
        tenantId: tenantB,
        surface: 'support',
        subjectId: 'user:b',
      }, conversationA.id),
      /Conversation not found/,
    )
    await assert.rejects(
      repositoryA.ensureConversation({
        tenantId: tenantA,
        surface: 'sales',
        subjectId: 'anonymous:a',
      }, conversationB.id),
      /Conversation not found/,
    )
    assert.equal(
      (await poolB.query(
        'UPDATE conversations SET status=$1 WHERE id=$2',
        ['closed', conversationA.id],
      )).rowCount,
      0,
    )
    await assert.rejects(
      poolB.query(
        `INSERT INTO conversations (tenant_id, surface, subject_id)
         VALUES ($1, 'support', 'forbidden')`,
        [tenantA],
      ),
      /row-level security policy/,
    )
  } finally {
    await Promise.all([poolA?.end(), poolB?.end()])
    await admin.query(`DELETE FROM "${schema}".conversations WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]).catch(() => undefined)
    await admin.query(`DROP OWNED BY "${role}"`).catch(() => undefined)
    await admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => undefined)
    await admin.end()
  }
})
