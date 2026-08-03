import assert from 'node:assert/strict'
import test from 'node:test'
import { getAssistantPool } from '../data/pool'
import { PostgresAssistantRepository, type KnowledgeDocument } from '../repository'

const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
const tenantA = `chat_test_a_${suffix}`
const tenantB = `chat_test_b_${suffix}`
const poolA = getAssistantPool(tenantA)
const poolB = getAssistantPool(tenantB)

async function cleanup() {
  for (const [pool, tenant] of [[poolA, tenantA], [poolB, tenantB]] as const) {
    await pool.query('DELETE FROM identity_links WHERE tenant_id=$1', [tenant])
    await pool.query('DELETE FROM idempotency_keys WHERE tenant_id=$1', [tenant])
    await pool.query('DELETE FROM rate_limit_buckets WHERE tenant_id=$1', [tenant])
    await pool.query('DELETE FROM request_receipts WHERE tenant_id=$1', [tenant])
    await pool.query('DELETE FROM documents WHERE tenant_id=$1', [tenant])
    await pool.query('DELETE FROM conversations WHERE tenant_id=$1', [tenant])
    await pool.end()
  }
}

test('Postgres repository enforces tenant ownership, retrieval, identity links, and rate limits', async (t) => {
  t.after(cleanup)
  const repositoryA = new PostgresAssistantRepository(poolA, tenantA)
  const repositoryB = new PostgresAssistantRepository(poolB, tenantB)
  const salesActor = {
    tenantId: tenantA,
    surface: 'sales' as const,
    subjectId: 'anonymous:1234567890abcdef',
  }
  const conversation = await repositoryA.ensureConversation(salesActor)
  await repositoryA.updateLeadState(conversation.id, {
    consent: true,
    company: 'Acme',
    useCase: 'Create leads through the API',
  }, { salesSummary: 'Acme asked about creating leads through the API.' })
  await repositoryA.linkIdentity(
    salesActor.subjectId,
    'user:user-1',
    'authenticated_session',
  )

  const supportConversation = await repositoryA.ensureConversation({
    tenantId: tenantA,
    surface: 'support',
    subjectId: 'user:user-1',
    accountId: 'organization-1',
    userId: 'user-1',
  })
  assert.equal(await repositoryA.recordSupportFeedback(supportConversation.id, {
    helpful: false,
    createdAt: new Date().toISOString(),
  }), 1)
  assert.equal(await repositoryA.recordSupportFeedback(supportConversation.id, {
    helpful: false,
    createdAt: new Date().toISOString(),
  }), 2)
  assert.equal(await repositoryA.recordSupportFeedback(supportConversation.id, {
    helpful: true,
    createdAt: new Date().toISOString(),
  }), 0)

  await assert.rejects(
    repositoryB.ensureConversation({
      ...salesActor,
      tenantId: tenantB,
    }, conversation.id),
    /Conversation not found/,
  )
  const linked = await repositoryA.salesContextFor('user:user-1')
  assert.equal(linked.length, 1)
  assert.equal(linked[0].leadState.company, 'Acme')

  const scopedConversation = await repositoryA.ensureConversation({
    ...salesActor,
    siteId: 'taicho',
    botId: 'taicho-bot',
  })
  await assert.rejects(
    repositoryA.ensureConversation({
      ...salesActor,
      siteId: 'another-site',
      botId: 'another-bot',
    }, scopedConversation.id),
    /Conversation not found/,
  )

  const document: KnowledgeDocument = {
    sourceId: 'docs:api#leads',
    title: 'Create leads',
    url: 'https://docs.taicho.ai/api#create-a-lead',
    heading: 'Create a lead through the API',
    content: 'Send a validated lead payload to the REST API or use the MCP lead tool.',
    contentHash: '0123456789abcdef',
    kind: 'docs',
  }
  await repositoryA.replaceKnowledge('docs', [document])
  const results = await repositoryA.searchKnowledge('create lead API payload', 'docs')
  assert.equal(results[0]?.sourceId, document.sourceId)
  assert.equal(await repositoryB.searchKnowledge('create lead API payload', 'docs').then((rows) => rows.length), 0)
  await repositoryA.replaceKnowledge('sales_fact', [{
    ...document,
    sourceId: 'taicho:pricing:pro',
    title: 'Taicho pricing',
    url: 'https://taicho.ai/pricing',
    heading: 'Pro',
    content: 'Pro costs ₹10,999 per month and includes 20,000 credits per billing period.',
    contentHash: 'fedcba9876543210',
    kind: 'sales_fact',
    pagePath: '/pricing',
  }])
  const pricing = await repositoryA.searchKnowledge(
    'How much does the Pro plan cost?',
    'sales_fact',
    5,
    '/pricing',
  )
  assert.equal(pricing[0]?.sourceId, 'taicho:pricing:pro')

  assert.equal((await repositoryA.consumeRateLimit('public-subject', 2, 60)).allowed, true)
  assert.equal((await repositoryA.consumeRateLimit('public-subject', 2, 60)).allowed, true)
  const limited = await repositoryA.consumeRateLimit('public-subject', 2, 60)
  assert.equal(limited.allowed, false)
  assert.ok(limited.retryAfterSeconds > 0)

  const requestId = '019c94cf-0b89-76b4-a337-c37a891f1274'
  assert.equal(await repositoryA.consumeRequestReceipt('sales', requestId), true)
  assert.equal(await repositoryA.consumeRequestReceipt('sales', requestId), false)
  assert.equal(await repositoryA.consumeRequestReceipt('knowledge', requestId), true)
  assert.equal(await repositoryB.consumeRequestReceipt('sales', requestId), true)
})
