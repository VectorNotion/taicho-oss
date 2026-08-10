import { createHash } from 'node:crypto';
import { getSession, runWithGraphOrganization } from '@content-automation/platform/data/graph';
import { getProspectIntelligenceWorkspace } from '../data/prospect-intelligence-repository';
import {
  getProspectActivities,
  getProspectById,
  getProspectNotes,
  getProspectOutreach,
} from '../data/prospect-repository';
import {
  prospectInsightSourceTarget,
  type ProspectEvidence,
  type ProspectInsightSourceRef,
  type ProspectSemanticSearchResponse,
  type ProspectSemanticSearchResult,
} from '../domain/prospect-intelligence';
import type {
  Prospect,
  ProspectActivity,
  ProspectNote,
  OutreachMessage,
} from '../domain/types';

const DEFAULT_EMBEDDING_URL = 'https://openrouter.ai/api/v1/embeddings';
const DEFAULT_EMBEDDING_MODEL = 'nvidia/nemotron-3-embed-1b:free';
const DEFAULT_EMBEDDING_DIMENSIONS = 2_048;
const MAX_SOURCE_CHARACTERS = 8_000;
const EMBEDDING_BATCH_SIZE = 32;
const INDEX_LABEL = 'ProspectKnowledgeChunk';
const INDEX_PROPERTY = 'embedding';

export interface ProspectSemanticSearchConfig {
  embeddingUrl: string;
  embeddingApiKey?: string;
  embeddingModel: string;
  embeddingDimensions: number;
  queryInputType?: string;
  documentInputType?: string;
}

export type ProspectKnowledgeSource = ProspectInsightSourceRef & { content: string };

function dimensionsFromEnvironment(value: string | undefined): number {
  if (!value) return DEFAULT_EMBEDDING_DIMENSIONS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4_096) {
    throw new Error('OUTREACH_EMBEDDING_DIMENSIONS must be an integer from 1 to 4096.');
  }
  return parsed;
}

export function prospectSemanticSearchConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ProspectSemanticSearchConfig | null {
  const explicitUrl = environment.OUTREACH_EMBEDDING_URL?.trim();
  const embeddingUrl = (explicitUrl || DEFAULT_EMBEDDING_URL).replace(/\/+$/, '');
  const explicitKey = environment.OUTREACH_EMBEDDING_API_KEY?.trim();
  const embeddingApiKey = explicitKey
    || (embeddingUrl === DEFAULT_EMBEDDING_URL
      ? environment.OPENROUTER_API_KEY?.trim()
      : undefined);
  const explicitConfiguration = Boolean(
    explicitUrl
    || environment.OUTREACH_EMBEDDING_MODEL?.trim()
    || environment.OUTREACH_EMBEDDING_DIMENSIONS?.trim(),
  );
  if (!embeddingApiKey && !explicitConfiguration) return null;

  const embeddingModel = environment.OUTREACH_EMBEDDING_MODEL?.trim()
    || DEFAULT_EMBEDDING_MODEL;
  const usesDefaultNvidiaModel = embeddingUrl === DEFAULT_EMBEDDING_URL
    && embeddingModel === DEFAULT_EMBEDDING_MODEL;
  return {
    embeddingUrl,
    embeddingApiKey,
    embeddingModel,
    embeddingDimensions: dimensionsFromEnvironment(environment.OUTREACH_EMBEDDING_DIMENSIONS),
    queryInputType: environment.OUTREACH_EMBEDDING_QUERY_INPUT_TYPE?.trim()
      || (usesDefaultNvidiaModel ? 'query' : undefined),
    documentInputType: environment.OUTREACH_EMBEDDING_DOCUMENT_INPUT_TYPE?.trim()
      || (usesDefaultNvidiaModel ? 'passage' : undefined),
  };
}

export function prospectSemanticSearchIsConfigured(): boolean {
  try {
    return prospectSemanticSearchConfigFromEnvironment() !== null;
  } catch {
    return false;
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceContent(value: string): string {
  return value.trim().slice(0, MAX_SOURCE_CHARACTERS);
}

export function buildProspectKnowledgeSources(input: {
  prospect: Prospect;
  notes: ProspectNote[];
  activities: ProspectActivity[];
  outreach: OutreachMessage[];
  evidence: ProspectEvidence[];
}): ProspectKnowledgeSource[] {
  const { prospect } = input;
  const sources: ProspectKnowledgeSource[] = [{
    id: `prospect:${prospect.id}:profile`,
    type: 'prospect_created',
    label: 'Prospect profile',
    createdAt: prospect.createdAt,
    occurredAt: prospect.createdAt,
    target: prospectInsightSourceTarget({
      id: `prospect:${prospect.id}:profile`,
      recordId: prospect.id,
      type: 'prospect_created',
    }),
    content: sourceContent([
      `Name: ${prospect.name}`,
      prospect.company ? `Company: ${prospect.company}` : '',
      prospect.title ? `Title: ${prospect.title}` : '',
      prospect.location ? `Location: ${prospect.location}` : '',
      `Status: ${prospect.status}`,
      `Priority: ${prospect.priority}`,
      prospect.about ? `About: ${prospect.about}` : '',
      prospect.tags.length ? `Tags: ${prospect.tags.join(', ')}` : '',
    ].filter(Boolean).join('\n')),
  }];

  sources.push(...input.activities.map((activity): ProspectKnowledgeSource => ({
    id: `activity:${activity.id}`,
    type: 'activity',
    label: `Activity · ${activity.type.replaceAll('_', ' ')}`,
    createdAt: activity.createdAt,
    occurredAt: activity.createdAt,
    target: prospectInsightSourceTarget({
      id: `activity:${activity.id}`,
      recordId: activity.id,
      type: 'activity',
    }),
    content: sourceContent([
      activity.title,
      activity.notes ? stripHtml(activity.notes) : '',
      activity.metadata ? JSON.stringify(activity.metadata) : '',
    ].filter(Boolean).join('\n')),
  })));

  sources.push(...input.outreach
    .filter((message) => message.status === 'sent')
    .map((message): ProspectKnowledgeSource => ({
      id: `outreach:${message.id}`,
      type: 'outreach_message',
      label: `Sent ${message.medium.replaceAll('_', ' ')}`,
      createdAt: message.createdAt,
      occurredAt: message.sentAt ?? message.createdAt,
      target: prospectInsightSourceTarget({
        id: `outreach:${message.id}`,
        recordId: message.id,
        type: 'outreach_message',
      }),
      content: sourceContent([
        message.subject ? `Subject: ${message.subject}` : '',
        message.content,
        message.targetContent ? `In response to: ${message.targetContent}` : '',
      ].filter(Boolean).join('\n')),
    })));

  sources.push(...input.evidence.map((item): ProspectKnowledgeSource => ({
    id: item.id,
    type: item.kind,
    label: item.sourceLabel,
    createdAt: item.createdAt,
    occurredAt: item.occurredAt ?? item.createdAt,
    target: prospectInsightSourceTarget({
      id: item.id,
      type: item.kind,
      meetingId: item.meetingId,
      offsetMs: item.offsetMs,
    }),
    content: sourceContent(item.content),
  })));

  sources.push(...input.notes.map((note): ProspectKnowledgeSource => ({
    id: `note:${note.id}`,
    type: 'note',
    label: 'Prospect note',
    createdAt: note.createdAt,
    occurredAt: note.createdAt,
    target: prospectInsightSourceTarget({ id: `note:${note.id}`, type: 'note' }),
    content: sourceContent(stripHtml(note.content)),
  })));

  return sources.filter((source) => source.content.length > 0);
}

async function embedTexts(
  config: ProspectSemanticSearchConfig,
  inputs: string[],
  inputType?: string,
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const allEmbeddings: number[][] = [];
  for (let start = 0; start < inputs.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = inputs.slice(start, start + EMBEDDING_BATCH_SIZE);
    const response = await fetch(config.embeddingUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.embeddingApiKey
          ? { authorization: `Bearer ${config.embeddingApiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: config.embeddingModel,
        input: batch,
        dimensions: config.embeddingDimensions,
        encoding_format: 'float',
        ...(inputType ? { input_type: inputType } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as {
        error?: { message?: unknown } | string;
      } | null;
      const detail = typeof body?.error === 'string'
        ? body.error
        : typeof body?.error?.message === 'string'
          ? body.error.message
          : `HTTP ${response.status}`;
      throw new Error(`The prospect embedding provider rejected the request: ${detail}`);
    }
    const result = await response.json() as {
      data?: Array<{ index?: number; embedding?: unknown }>;
    };
    const embeddings = [...(result.data ?? [])]
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((item) => item.embedding);
    if (
      embeddings.length !== batch.length
      || embeddings.some((embedding) => (
        !Array.isArray(embedding)
        || embedding.length !== config.embeddingDimensions
        || embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))
      ))
    ) {
      throw new Error(
        `The prospect embedding provider did not return ${config.embeddingDimensions}-dimension vectors.`,
      );
    }
    allEmbeddings.push(...embeddings as number[][]);
  }
  return allEmbeddings;
}

function sourceHash(config: ProspectSemanticSearchConfig, source: ProspectKnowledgeSource): string {
  return createHash('sha256')
    .update(config.embeddingModel)
    .update('\0')
    .update(String(config.embeddingDimensions))
    .update('\0')
    .update(config.documentInputType ?? '')
    .update('\0')
    .update(source.content)
    .digest('hex');
}

async function ensureVectorIndex(
  organizationId: string,
  config: ProspectSemanticSearchConfig,
): Promise<void> {
  const session = await getSession(organizationId);
  try {
    const result = await session.run(
      `CALL db.indexes() YIELD label, properties, types, options
       RETURN label, properties, types, options`,
    );
    const existing = result.records.find((record) => {
      const label = record.get('label');
      const properties = record.get('properties') as unknown;
      return label === INDEX_LABEL
        && Array.isArray(properties)
        && properties.includes(INDEX_PROPERTY);
    });
    if (existing) {
      const options = existing.get('options') as Record<string, {
        dimension?: unknown;
      }>;
      const dimension = Number(options?.[INDEX_PROPERTY]?.dimension);
      if (dimension !== config.embeddingDimensions) {
        throw new Error(
          `FalkorDB prospect vectors use ${dimension} dimensions, but the configured embedding model uses ${config.embeddingDimensions}. Re-index with one consistent dimension.`,
        );
      }
      return;
    }
    try {
      await session.run(
        `CREATE VECTOR INDEX FOR (chunk:${INDEX_LABEL}) ON (chunk.${INDEX_PROPERTY}) OPTIONS {dimension: ${config.embeddingDimensions}, similarityFunction: 'cosine', M: 16, efConstruction: 200, efRuntime: 64}`,
      );
    } catch (error) {
      if (!(error instanceof Error) || !/already indexed|already exists/i.test(error.message)) {
        throw error;
      }
    }
  } finally {
    await session.close();
  }
}

async function loadProspectKnowledgeSources(
  organizationId: string,
  prospectId: string,
): Promise<ProspectKnowledgeSource[]> {
  const [prospect, notes, activities, outreach, workspace] = await Promise.all([
    getProspectById(prospectId),
    getProspectNotes(prospectId),
    getProspectActivities(prospectId),
    getProspectOutreach(prospectId),
    getProspectIntelligenceWorkspace(organizationId, prospectId),
  ]);
  if (!prospect) throw new Error(`Prospect not found: ${prospectId}`);
  return buildProspectKnowledgeSources({
    prospect,
    notes,
    activities,
    outreach,
    evidence: workspace.evidence,
  });
}

async function syncProspectKnowledgeIndex(
  organizationId: string,
  prospectId: string,
  config: ProspectSemanticSearchConfig,
): Promise<number> {
  const sources = await loadProspectKnowledgeSources(organizationId, prospectId);
  await ensureVectorIndex(organizationId, config);
  const session = await getSession(organizationId);
  try {
    const existingResult = await session.run(
      `MATCH (:Prospect {id: $prospectId})-[:HAS_KNOWLEDGE]->(chunk:${INDEX_LABEL})
       RETURN chunk.id AS id, chunk.contentHash AS contentHash`,
      { prospectId },
    );
    const existingHashes = new Map(existingResult.records.map((record) => [
      String(record.get('id')),
      String(record.get('contentHash') ?? ''),
    ]));
    const changed = sources.filter((source) => (
      existingHashes.get(`${prospectId}:${source.id}`) !== sourceHash(config, source)
    ));
    const embeddings = await embedTexts(
      config,
      changed.map((source) => source.content),
      config.documentInputType,
    );
    if (changed.length > 0) {
      await session.run(
        `UNWIND $chunks AS item
         MATCH (prospect:Prospect {id: $prospectId})
         MERGE (chunk:${INDEX_LABEL} {id: item.id})
         SET chunk.prospectId = $prospectId,
             chunk.sourceId = item.sourceId,
             chunk.sourceType = item.sourceType,
             chunk.label = item.label,
             chunk.content = item.content,
             chunk.createdAt = item.createdAt,
             chunk.occurredAt = item.occurredAt,
             chunk.targetTab = item.targetTab,
             chunk.targetAnchorId = item.targetAnchorId,
             chunk.targetRecordId = item.targetRecordId,
             chunk.meetingId = item.meetingId,
             chunk.offsetMs = item.offsetMs,
             chunk.contentHash = item.contentHash,
             chunk.embeddingModel = $embeddingModel,
             chunk.embedding = vecf32(item.embedding),
             chunk.indexedAt = localdatetime()
         MERGE (prospect)-[:HAS_KNOWLEDGE]->(chunk)`,
        {
          prospectId,
          embeddingModel: config.embeddingModel,
          chunks: changed.map((source, index) => ({
            id: `${prospectId}:${source.id}`,
            sourceId: source.id,
            sourceType: source.type,
            label: source.label,
            content: source.content,
            createdAt: source.createdAt,
            occurredAt: source.occurredAt,
            targetTab: source.target.tab,
            targetAnchorId: source.target.anchorId,
            targetRecordId: source.target.recordId,
            meetingId: source.target.meetingId ?? null,
            offsetMs: source.target.offsetMs ?? null,
            contentHash: sourceHash(config, source),
            embedding: embeddings[index],
          })),
        },
      );
    }
    await session.run(
      `MATCH (:Prospect {id: $prospectId})-[:HAS_KNOWLEDGE]->(chunk:${INDEX_LABEL})
       WHERE NOT chunk.id IN $currentIds
       DETACH DELETE chunk`,
      { prospectId, currentIds: sources.map((source) => `${prospectId}:${source.id}`) },
    );
    return sources.length;
  } finally {
    await session.close();
  }
}

function searchResult(record: {
  get(name: string): unknown;
}): ProspectSemanticSearchResult {
  const distance = Number(record.get('distance'));
  const occurredAtValue = record.get('occurredAt');
  const createdAt = String(record.get('createdAt'));
  const meetingIdValue = record.get('meetingId');
  const offsetMsValue = record.get('offsetMs');
  return {
    content: String(record.get('content')),
    score: Math.max(-1, Math.min(1, 1 - distance)),
    source: {
      id: String(record.get('sourceId')),
      type: String(record.get('sourceType')) as ProspectInsightSourceRef['type'],
      label: String(record.get('label')),
      createdAt,
      occurredAt: occurredAtValue == null ? null : String(occurredAtValue),
      target: {
        tab: String(record.get('targetTab')) as ProspectInsightSourceRef['target']['tab'],
        anchorId: String(record.get('targetAnchorId')),
        recordId: String(record.get('targetRecordId')),
        meetingId: meetingIdValue == null ? null : String(meetingIdValue),
        offsetMs: offsetMsValue == null ? null : Number(offsetMsValue),
      },
    },
  };
}

export async function semanticSearchProspect(input: {
  organizationId: string;
  prospectId: string;
  query: string;
  limit?: number;
}): Promise<ProspectSemanticSearchResponse> {
  const query = input.query.trim();
  if (query.length < 2 || query.length > 500) {
    throw new Error('Search queries must contain between 2 and 500 characters.');
  }
  const limit = Math.min(10, Math.max(1, Math.floor(input.limit ?? 6)));
  const config = prospectSemanticSearchConfigFromEnvironment();
  if (!config) {
    throw new Error('Prospect semantic search is not configured in this environment.');
  }

  return runWithGraphOrganization(input.organizationId, async () => {
    const [indexedCount, [queryEmbedding]] = await Promise.all([
      syncProspectKnowledgeIndex(input.organizationId, input.prospectId, config),
      embedTexts(config, [query], config.queryInputType),
    ]);
    if (!queryEmbedding) throw new Error('The search query could not be embedded.');
    const session = await getSession(input.organizationId);
    try {
      // Prospect-scoped exact cosine ranking avoids FalkorDB's documented limitation
      // around combining HNSW vector results with property filters. The same
      // vectors are also maintained in FalkorDB's HNSW index for future global use.
      const result = await session.run(
        `MATCH (:Prospect {id: $prospectId})-[:HAS_KNOWLEDGE]->(chunk:${INDEX_LABEL})
         WHERE chunk.embedding IS NOT NULL
         WITH chunk, vec.cosineDistance(chunk.embedding, vecf32($queryEmbedding)) AS distance
         RETURN chunk.sourceId AS sourceId,
                chunk.sourceType AS sourceType,
                chunk.label AS label,
                chunk.content AS content,
                chunk.createdAt AS createdAt,
                chunk.occurredAt AS occurredAt,
                chunk.targetTab AS targetTab,
                chunk.targetAnchorId AS targetAnchorId,
                chunk.targetRecordId AS targetRecordId,
                chunk.meetingId AS meetingId,
                chunk.offsetMs AS offsetMs,
                distance
         ORDER BY distance ASC
         LIMIT $limit`,
        { prospectId: input.prospectId, queryEmbedding, limit },
      );
      return {
        query,
        indexedCount,
        results: result.records.map(searchResult),
      };
    } finally {
      await session.close();
    }
  });
}
