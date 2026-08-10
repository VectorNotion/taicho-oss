import assert from 'node:assert/strict'
import test from 'node:test'
import {
  QdrantSalesKnowledgeRetriever,
  QdrantSupportKnowledgeStore,
  type QdrantSalesKnowledgeConfig,
} from '../qdrant'

const configuration: QdrantSalesKnowledgeConfig = {
  qdrantUrl: 'https://qdrant.example.test',
  qdrantApiKey: 'qdrant-secret',
  collection: 'sales_bot_knowledge',
  embeddingUrl: 'https://embeddings.example.test/v1/embeddings',
  embeddingApiKey: 'embedding-secret',
  embeddingModel: 'test-embedding',
  scoreThreshold: 0.2,
}

test('Qdrant retrieval applies mandatory Payload tenant, site, and bot filters', async (t) => {
  const originalFetch = globalThis.fetch
  let queryBody: Record<string, unknown> | undefined
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('embeddings.example.test')) {
      return Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] })
    }
    queryBody = JSON.parse(String(init?.body))
    return Response.json({
      result: {
        points: [{
          id: 'point-1',
          score: 0.91,
          payload: {
            tenantId: 'payload-tenant-id',
            siteId: 'vectornotion',
            botId: 'payload-bot-id',
            sourceId: 'vectornotion:services',
            title: 'Services',
            url: 'https://vectornotion.com',
            content: 'VectorNotion builds web and AI products.',
            contentHash: 'a'.repeat(64),
            kind: 'sales_fact',
            pagePath: '/',
          },
        }, {
          id: 'point-from-another-tenant',
          score: 0.99,
          payload: {
            tenantId: 'different-payload-tenant',
            siteId: 'vectornotion',
            botId: 'payload-bot-id',
            sourceId: 'private:fact',
            title: 'Private fact',
            url: 'https://private.example.test',
            content: 'This content must never cross tenant boundaries.',
            contentHash: 'b'.repeat(64),
            kind: 'sales_fact',
          },
        }],
      },
    })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const retriever = new QdrantSalesKnowledgeRetriever(configuration)
  const documents = await retriever.search({
    tenantId: 'payload-tenant-id',
    siteId: 'vectornotion',
    botId: 'payload-bot-id',
    brandName: 'VectorNotion',
  }, 'What can you build?', 5, '/')

  assert.equal(documents.length, 1)
  assert.equal(documents[0].sourceId, 'vectornotion:services')
  assert.deepEqual(queryBody?.filter, {
    must: [
      { key: 'tenantId', match: { value: 'payload-tenant-id' } },
      { key: 'siteId', match: { value: 'vectornotion' } },
      { key: 'botId', match: { value: 'payload-bot-id' } },
      { key: 'kind', match: { value: 'sales_fact' } },
    ],
  })
})

test('a missing Qdrant collection produces no cross-tenant fallback', async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => (
    String(input).includes('embeddings.example.test')
      ? Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] })
      : new Response('missing', { status: 404 })
  )
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const retriever = new QdrantSalesKnowledgeRetriever(configuration)
  const documents = await retriever.search({
    tenantId: 'another-payload-tenant',
    siteId: 'another-site',
    botId: 'another-bot',
    brandName: 'Another brand',
  }, 'Tell me about pricing')

  assert.deepEqual(documents, [])
})

test('support retrieval is restricted to documentation from the signed tenant', async (t) => {
  const originalFetch = globalThis.fetch
  let queryBody: Record<string, unknown> | undefined
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('embeddings.example.test')) {
      return Response.json({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] })
    }
    queryBody = JSON.parse(String(init?.body))
    return Response.json({
      result: {
        points: [{
          id: 'support-point',
          score: 0.92,
          payload: {
            tenantId: 'taicho',
            kind: 'docs',
            sourceId: 'api#prospects',
            title: 'Prospect API',
            url: 'https://docs.taicho.ai/api',
            content: 'Create prospects with a validated REST API payload.',
            contentHash: 'a'.repeat(64),
          },
        }, {
          id: 'other-tenant',
          score: 0.99,
          payload: {
            tenantId: 'another-tenant',
            kind: 'docs',
            sourceId: 'private',
            title: 'Private',
            url: 'https://private.example.test',
            content: 'Never return this.',
            contentHash: 'b'.repeat(64),
          },
        }],
      },
    })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const store = new QdrantSupportKnowledgeStore(configuration)
  const documents = await store.search('taicho', 'prospect API', 5)

  assert.deepEqual(documents.map(({ sourceId }) => sourceId), ['api#prospects'])
  assert.deepEqual(queryBody?.filter, {
    must: [
      { key: 'tenantId', match: { value: 'taicho' } },
      { key: 'kind', match: { value: 'docs' } },
    ],
  })
})

test('support knowledge replacement embeds, scopes, and replaces only tenant docs', async (t) => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    requests.push({ url, method, body })
    if (url.includes('embeddings.example.test')) {
      return Response.json({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] })
    }
    if (method === 'GET') {
      return Response.json({
        result: { config: { params: { vectors: { size: 3 } } } },
      })
    }
    return Response.json({ status: 'ok' })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const store = new QdrantSupportKnowledgeStore(configuration)
  await store.replace('taicho', [{
    sourceId: 'api#prospects',
    title: 'Prospect API',
    url: 'https://docs.taicho.ai/api',
    heading: 'Create a prospect',
    content: 'Create prospects with a validated REST API payload.',
    contentHash: 'a'.repeat(64),
    kind: 'docs',
    metadata: {
      tenantId: 'malicious-override',
      kind: 'sales_fact',
      locale: 'en',
    },
  }])

  const deletion = requests.find(({ url }) => url.endsWith('/points/delete?wait=true'))
  const upsert = requests.find(({ url }) => url.endsWith('/points?wait=true'))
  assert.deepEqual(deletion?.body?.filter, {
    must: [
      { key: 'tenantId', match: { value: 'taicho' } },
      { key: 'kind', match: { value: 'docs' } },
    ],
  })
  const point = (upsert?.body?.points as Array<{ payload: Record<string, unknown> }>)[0]
  assert.equal(point.payload.tenantId, 'taicho')
  assert.equal(point.payload.kind, 'docs')
  assert.equal(point.payload.locale, 'en')
})
