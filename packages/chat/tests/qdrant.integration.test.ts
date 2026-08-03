import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import {
  QdrantSalesKnowledgeRetriever,
  type QdrantSalesKnowledgeConfig,
} from '../qdrant'

const enabled = process.env.ASSISTANT_QDRANT_TESTS === '1'
const qdrantUrl = (process.env.QDRANT_TEST_URL ?? 'http://127.0.0.1:6333')
  .replace(/\/+$/, '')

async function waitForQdrant(): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${qdrantUrl}/readyz`)
      if (response.ok) return
      lastError = new Error(`Qdrant readiness returned ${response.status}.`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw lastError instanceof Error ? lastError : new Error('Qdrant did not become ready.')
}

async function qdrantRequest(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${qdrantUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`Qdrant request failed (${response.status}): ${await response.text()}`)
  }
  return response
}

test('Qdrant enforces assistant tenant isolation against a real collection', {
  skip: !enabled,
}, async (t) => {
  await waitForQdrant()
  const collection = `assistant_tenant_${randomUUID().replaceAll('-', '')}`
  const tenantA = `qdrant_a_${randomUUID().replaceAll('-', '')}`
  const tenantB = `qdrant_b_${randomUUID().replaceAll('-', '')}`
  const originalFetch = globalThis.fetch

  await qdrantRequest(`/collections/${collection}`, {
    method: 'PUT',
    body: JSON.stringify({ vectors: { size: 3, distance: 'Cosine' } }),
  })
  t.after(async () => {
    globalThis.fetch = originalFetch
    await originalFetch(`${qdrantUrl}/collections/${collection}`, {
      method: 'DELETE',
    }).catch(() => undefined)
  })
  await qdrantRequest(`/collections/${collection}/points?wait=true`, {
    method: 'PUT',
    body: JSON.stringify({
      points: [
        {
          id: 1,
          vector: [1, 0, 0],
          payload: {
            tenantId: tenantA,
            siteId: 'site-a',
            botId: 'bot-a',
            sourceId: 'tenant-a:private',
            title: 'Tenant A',
            url: 'https://a.example.test',
            content: 'Private tenant A knowledge.',
            contentHash: 'a'.repeat(64),
            kind: 'sales_fact',
          },
        },
        {
          id: 2,
          vector: [1, 0, 0],
          payload: {
            tenantId: tenantB,
            siteId: 'site-b',
            botId: 'bot-b',
            sourceId: 'tenant-b:private',
            title: 'Tenant B',
            url: 'https://b.example.test',
            content: 'Private tenant B knowledge.',
            contentHash: 'b'.repeat(64),
            kind: 'sales_fact',
          },
        },
      ],
    }),
  })

  globalThis.fetch = async (input, init) => (
    String(input) === 'https://embedding.example.test/v1/embeddings'
      ? Response.json({ data: [{ embedding: [1, 0, 0] }] })
      : originalFetch(input, init)
  )
  const configuration: QdrantSalesKnowledgeConfig = {
    qdrantUrl,
    collection,
    embeddingUrl: 'https://embedding.example.test/v1/embeddings',
    embeddingApiKey: 'integration-test-only',
    embeddingModel: 'integration-test',
  }
  const retriever = new QdrantSalesKnowledgeRetriever(configuration)

  const documentsA = await retriever.search({
    tenantId: tenantA,
    siteId: 'site-a',
    botId: 'bot-a',
    brandName: 'Tenant A',
  }, 'private knowledge')
  const documentsB = await retriever.search({
    tenantId: tenantB,
    siteId: 'site-b',
    botId: 'bot-b',
    brandName: 'Tenant B',
  }, 'private knowledge')

  assert.deepEqual(documentsA.map((document) => document.sourceId), ['tenant-a:private'])
  assert.deepEqual(documentsB.map((document) => document.sourceId), ['tenant-b:private'])
  assert.doesNotMatch(JSON.stringify(documentsA), /tenant-b|Private tenant B/i)
  assert.doesNotMatch(JSON.stringify(documentsB), /tenant-a|Private tenant A/i)
})
