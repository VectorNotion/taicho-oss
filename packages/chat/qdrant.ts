import { createHash } from 'node:crypto'
import type { AssistantKnowledgeScope } from './contracts'
import type { KnowledgeDocument } from './repository'

export interface SalesKnowledgeRetriever {
  search(
    scope: AssistantKnowledgeScope,
    query: string,
    limit?: number,
    pagePath?: string,
  ): Promise<KnowledgeDocument[]>
}

export interface SupportKnowledgeRetriever {
  search(tenantId: string, query: string, limit?: number): Promise<KnowledgeDocument[]>
}

export interface SupportKnowledgeStore extends SupportKnowledgeRetriever {
  replace(tenantId: string, documents: KnowledgeDocument[]): Promise<void>
}

export type QdrantSalesKnowledgeConfig = {
  qdrantUrl: string
  qdrantApiKey?: string
  collection: string
  embeddingUrl: string
  embeddingApiKey: string
  embeddingModel: string
  embeddingDimensions?: number
  scoreThreshold?: number
}

type QdrantPoint = {
  id?: string | number
  score?: number
  payload?: Record<string, unknown>
}

const DEFAULT_COLLECTION = 'sales_bot_knowledge'
const DEFAULT_EMBEDDING_URL = 'https://api.openai.com/v1/embeddings'
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('ASSISTANT_EMBEDDING_DIMENSIONS must be a positive integer.')
  }
  return parsed
}

function finiteNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error('QDRANT_SCORE_THRESHOLD must be a finite number.')
  }
  return parsed
}

export function qdrantSalesKnowledgeConfigFromEnvironment():
  | QdrantSalesKnowledgeConfig
  | null {
  const qdrantUrl = process.env.QDRANT_URL?.trim()
  const embeddingApiKey = process.env.ASSISTANT_EMBEDDING_API_KEY?.trim()
  if (!qdrantUrl && !embeddingApiKey) return null
  if (!qdrantUrl || !embeddingApiKey) {
    throw new Error('QDRANT_URL and ASSISTANT_EMBEDDING_API_KEY must be configured together.')
  }

  return {
    qdrantUrl: qdrantUrl.replace(/\/+$/, ''),
    qdrantApiKey: process.env.QDRANT_API_KEY?.trim() || undefined,
    collection: process.env.QDRANT_COLLECTION?.trim() || DEFAULT_COLLECTION,
    embeddingUrl: process.env.ASSISTANT_EMBEDDING_URL?.trim() || DEFAULT_EMBEDDING_URL,
    embeddingApiKey,
    embeddingModel: process.env.ASSISTANT_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL,
    embeddingDimensions: positiveInteger(process.env.ASSISTANT_EMBEDDING_DIMENSIONS),
    scoreThreshold: finiteNumber(process.env.QDRANT_SCORE_THRESHOLD),
  }
}

function requiredPayloadString(
  payload: Record<string, unknown>,
  field: string,
): string | null {
  const value = payload[field]
  return typeof value === 'string' && value ? value : null
}

async function embedTexts(
  config: QdrantSalesKnowledgeConfig,
  input: string[],
): Promise<number[][]> {
  const response = await fetch(config.embeddingUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.embeddingApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.embeddingModel,
      input,
      ...(config.embeddingDimensions
        ? { dimensions: config.embeddingDimensions }
        : {}),
    }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Embedding request failed (${response.status}).`)
  }
  const result = await response.json() as {
    data?: Array<{ index?: number; embedding?: unknown }>
  }
  const embeddings = [...(result.data ?? [])]
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((item) => item.embedding)
  if (
    embeddings.length !== input.length ||
    embeddings.some((embedding) => (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    ))
  ) {
    throw new Error('The embedding provider returned an invalid vector batch.')
  }
  return embeddings as number[][]
}

function qdrantHeaders(config: QdrantSalesKnowledgeConfig): HeadersInit {
  return {
    'content-type': 'application/json',
    ...(config.qdrantApiKey ? { 'api-key': config.qdrantApiKey } : {}),
  }
}

async function qdrantRequest(
  config: QdrantSalesKnowledgeConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${config.qdrantUrl}${path}`, {
    ...init,
    headers: {
      ...qdrantHeaders(config),
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  })
}

function collectionPath(config: QdrantSalesKnowledgeConfig, suffix = ''): string {
  return `/collections/${encodeURIComponent(config.collection)}${suffix}`
}

function configuredVectorSize(result: unknown): number | undefined {
  if (!result || typeof result !== 'object' || !('result' in result)) return undefined
  const vectors = (result as {
    result?: { config?: { params?: { vectors?: unknown } } }
  }).result?.config?.params?.vectors
  if (!vectors || typeof vectors !== 'object') return undefined
  return 'size' in vectors && typeof vectors.size === 'number' ? vectors.size : undefined
}

async function ensureCollection(
  config: QdrantSalesKnowledgeConfig,
  vectorSize: number,
): Promise<void> {
  const existing = await qdrantRequest(config, collectionPath(config))
  if (existing.ok) {
    const size = configuredVectorSize(await existing.json())
    if (size && size !== vectorSize) {
      throw new Error(
        `Qdrant collection ${config.collection} expects ${size}-dimension vectors, but the embedding provider returned ${vectorSize}.`,
      )
    }
  } else if (existing.status === 404) {
    const created = await qdrantRequest(config, collectionPath(config), {
      method: 'PUT',
      body: JSON.stringify({ vectors: { size: vectorSize, distance: 'Cosine' } }),
    })
    if (!created.ok) {
      await created.body?.cancel()
      throw new Error(`Qdrant collection creation failed (${created.status}).`)
    }
  } else {
    await existing.body?.cancel()
    throw new Error(`Qdrant collection lookup failed (${existing.status}).`)
  }

  for (const fieldName of ['tenantId', 'siteId', 'botId', 'kind', 'sourceId']) {
    const indexed = await qdrantRequest(
      config,
      collectionPath(config, '/index?wait=true'),
      {
        method: 'PUT',
        body: JSON.stringify({ field_name: fieldName, field_schema: 'keyword' }),
      },
    )
    if (!indexed.ok && indexed.status !== 409) {
      await indexed.body?.cancel()
      throw new Error(`Qdrant payload index creation failed for ${fieldName} (${indexed.status}).`)
    }
  }
}

function deterministicPointId(value: string): string {
  const characters = createHash('sha256').update(value).digest('hex').slice(0, 32).split('')
  characters[12] = '5'
  characters[16] = ((Number.parseInt(characters[16], 16) & 0x3) | 0x8).toString(16)
  const joined = characters.join('')
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`
}

function resultPoints(result: unknown): QdrantPoint[] {
  if (!result || typeof result !== 'object' || !('result' in result)) return []
  const value = (result as { result?: { points?: QdrantPoint[] } | QdrantPoint[] }).result
  return Array.isArray(value) ? value : value?.points ?? []
}

function documentFromPoint(
  point: QdrantPoint,
  kind: KnowledgeDocument['kind'],
): KnowledgeDocument | null {
  const payload = point.payload
  if (!payload || payload.kind !== kind) return null
  const sourceId = requiredPayloadString(payload, 'sourceId')
  const title = requiredPayloadString(payload, 'title')
  const url = requiredPayloadString(payload, 'url')
  const content = requiredPayloadString(payload, 'content')
  const contentHash = requiredPayloadString(payload, 'contentHash')
  if (!sourceId || !title || !url || !content || !contentHash) return null
  return {
    sourceId,
    title,
    url,
    content,
    contentHash,
    kind,
    heading: requiredPayloadString(payload, 'heading') ?? undefined,
    pagePath: requiredPayloadString(payload, 'pagePath') ?? undefined,
    rank: typeof point.score === 'number' ? point.score : undefined,
    metadata: payload,
  }
}

export class QdrantSalesKnowledgeRetriever implements SalesKnowledgeRetriever {
  constructor(private readonly config: QdrantSalesKnowledgeConfig) {}

  private async embed(query: string): Promise<number[]> {
    return (await embedTexts(this.config, [query]))[0]
  }

  async search(
    scope: AssistantKnowledgeScope,
    query: string,
    limit = 5,
    pagePath?: string,
  ): Promise<KnowledgeDocument[]> {
    const vector = await this.embed(query)
    const response = await fetch(
      `${this.config.qdrantUrl}/collections/${encodeURIComponent(this.config.collection)}/points/query`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.qdrantApiKey ? { 'api-key': this.config.qdrantApiKey } : {}),
        },
        body: JSON.stringify({
          query: vector,
          filter: {
            must: [
              { key: 'tenantId', match: { value: scope.tenantId } },
              { key: 'siteId', match: { value: scope.siteId } },
              { key: 'botId', match: { value: scope.botId } },
              { key: 'kind', match: { value: 'sales_fact' } },
            ],
          },
          limit: Math.max(1, Math.min(limit, 10)),
          with_payload: true,
          with_vectors: false,
          ...(this.config.scoreThreshold === undefined
            ? {}
            : { score_threshold: this.config.scoreThreshold }),
        }),
        signal: AbortSignal.timeout(30_000),
      },
    )
    if (response.status === 404) return []
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Qdrant query failed (${response.status}).`)
    }
    const points = resultPoints(await response.json())

    return points.flatMap((point) => {
      const payload = point.payload
      if (!payload) return []
      if (
        payload.tenantId !== scope.tenantId ||
        payload.siteId !== scope.siteId ||
        payload.botId !== scope.botId ||
        payload.kind !== 'sales_fact'
      ) return []
      const sourceId = requiredPayloadString(payload, 'sourceId')
      const title = requiredPayloadString(payload, 'title')
      const url = requiredPayloadString(payload, 'url')
      const content = requiredPayloadString(payload, 'content')
      const contentHash = requiredPayloadString(payload, 'contentHash')
      if (!sourceId || !title || !url || !content || !contentHash) return []
      return [{
        sourceId,
        title,
        url,
        content,
        contentHash,
        kind: 'sales_fact' as const,
        heading: requiredPayloadString(payload, 'heading') ?? undefined,
        pagePath: requiredPayloadString(payload, 'pagePath') ?? undefined,
        rank: typeof point.score === 'number'
          ? point.score + (pagePath && payload.pagePath === pagePath ? 0.05 : 0)
          : undefined,
        metadata: payload,
      }]
    }).sort((left, right) => (right.rank ?? 0) - (left.rank ?? 0))
  }
}

export class QdrantSupportKnowledgeStore implements SupportKnowledgeStore {
  constructor(private readonly config: QdrantSalesKnowledgeConfig) {}

  async search(tenantId: string, query: string, limit = 5): Promise<KnowledgeDocument[]> {
    const [vector] = await embedTexts(this.config, [query])
    const response = await qdrantRequest(
      this.config,
      collectionPath(this.config, '/points/query'),
      {
        method: 'POST',
        body: JSON.stringify({
          query: vector,
          filter: {
            must: [
              { key: 'tenantId', match: { value: tenantId } },
              { key: 'kind', match: { value: 'docs' } },
            ],
          },
          limit: Math.max(1, Math.min(limit, 10)),
          with_payload: true,
          with_vectors: false,
          ...(this.config.scoreThreshold === undefined
            ? {}
            : { score_threshold: this.config.scoreThreshold }),
        }),
      },
    )
    if (response.status === 404) return []
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Qdrant support query failed (${response.status}).`)
    }
    return resultPoints(await response.json())
      .flatMap((point) => {
        if (point.payload?.tenantId !== tenantId) return []
        const document = documentFromPoint(point, 'docs')
        return document ? [document] : []
      })
      .sort((left, right) => (right.rank ?? 0) - (left.rank ?? 0))
  }

  async replace(tenantId: string, documents: KnowledgeDocument[]): Promise<void> {
    if (documents.some((document) => document.kind !== 'docs')) {
      throw new Error('The support knowledge store accepts documentation only.')
    }
    if (documents.length === 0) {
      await this.deleteTenantDocuments(tenantId)
      return
    }

    const vectors: number[][] = []
    for (let start = 0; start < documents.length; start += 64) {
      const batch = documents.slice(start, start + 64)
      vectors.push(...await embedTexts(this.config, batch.map(({ content }) => content)))
    }
    await ensureCollection(this.config, vectors[0].length)
    await this.deleteTenantDocuments(tenantId)

    for (let start = 0; start < documents.length; start += 100) {
      const batch = documents.slice(start, start + 100)
      const response = await qdrantRequest(
        this.config,
        collectionPath(this.config, '/points?wait=true'),
        {
          method: 'PUT',
          body: JSON.stringify({
            points: batch.map((document, offset) => ({
              id: deterministicPointId(`${tenantId}:docs:${document.sourceId}`),
              vector: vectors[start + offset],
              payload: {
                ...document.metadata,
                tenantId,
                kind: 'docs',
                sourceId: document.sourceId,
                title: document.title,
                url: document.url,
                heading: document.heading,
                pagePath: document.pagePath,
                content: document.content,
                contentHash: document.contentHash,
              },
            })),
          }),
        },
      )
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Qdrant support knowledge upsert failed (${response.status}).`)
      }
    }
  }

  private async deleteTenantDocuments(tenantId: string): Promise<void> {
    const response = await qdrantRequest(
      this.config,
      collectionPath(this.config, '/points/delete?wait=true'),
      {
        method: 'POST',
        body: JSON.stringify({
          filter: {
            must: [
              { key: 'tenantId', match: { value: tenantId } },
              { key: 'kind', match: { value: 'docs' } },
            ],
          },
        }),
      },
    )
    if (!response.ok && response.status !== 404) {
      await response.body?.cancel()
      throw new Error(`Qdrant support knowledge cleanup failed (${response.status}).`)
    }
  }
}
