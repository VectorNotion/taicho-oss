/**
 * extract_topics action (§6) — Mastra orchestrator.
 *
 * Ported from the deleted LangGraph `extract_topics` node
 * (`graph/src/agent/nodes/extract_topics.py`). Flow:
 *   read existing topics (incl. dismissed) + entities-by-project-count
 *   → LLM topic extraction (temp 0.3, structured output)
 *   → dedup (exact name + optional semantic) → create + link.
 *
 * Semantic dedup: when OPENAI_API_KEY is set, topic texts are embedded via the
 * OpenAI embeddings REST API (text-embedding-3-small) and compared with cosine
 * similarity ≥ 0.85 against both existing topics AND topics created earlier in
 * the same batch. Without the key it falls back to name-only dedup (logged).
 *
 * All external effects (the agent call, embeddings, and the repositories) are
 * injected via the optional `{ deps }` parameter for network/db-free unit tests.
 */
import {
  getTopics,
  createTopic,
  linkTopicToEntities,
  linkTopicToResearch,
} from '../../data/topic-repository';
import { getEntitiesByProjectCount } from '../../data/project-repository';
import type {
  CreateTopicInput,
  Topic,
  TopicsResponse,
} from '../../domain/topic';
import {
  createTopicsAgent,
  extractedTopicsSchema,
  type ExtractedTopics,
} from './topics-agent';
import { streamingStructuredGenerate, type StreamEmit } from '@content-automation/platform/agents/streaming';
import { observeWorkflowStep, traceable } from '@content-automation/observability';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface ExtractTopicsResult {
  topicsCreated: number;
  topicsDeduped: number;
}

/** Cosine-similarity threshold above which topics are treated as duplicates. */
export const SIMILARITY_THRESHOLD = 0.85;

/** Entity-type weights used to rank entities in the prompt. */
const ENTITY_TYPE_WEIGHTS: Record<string, number> = {
  AIComponent: 2.0,
  Feature: 2.0,
  BusinessValue: 1.0,
};

// ---------------------------------------------------------------------------
// Injectable dependency seams
// ---------------------------------------------------------------------------

export interface EntityRow {
  entityType: string;
  name: string;
  id: string;
  projectNames: string[];
  projectCount: number;
}

export interface GenerateTopicsInput {
  entitiesFormatted: string;
  existingTopicNames: string;
}

export interface TopicsRepos {
  getTopics: (includeDismissed: boolean) => Promise<TopicsResponse>;
  getEntitiesByProjectCount: () => Promise<EntityRow[]>;
  createTopic: (data: CreateTopicInput) => Promise<Topic | null>;
  linkTopicToEntities: (topicId: string, entityNames: string[]) => Promise<void>;
  linkTopicToResearch: (topicId: string, topicName: string) => Promise<void>;
}

export interface TopicsDeps {
  generateTopics: (input: GenerateTopicsInput) => Promise<ExtractedTopics>;
  /** Batch-embed texts. Undefined ⇒ no semantic dedup (name-only fallback). */
  embed?: (texts: string[]) => Promise<number[][]>;
  repos: TopicsRepos;
}

// ---------------------------------------------------------------------------
// Default (real) implementations of the seams
// ---------------------------------------------------------------------------

/** Default extraction: local topics agent, structured output, temp 0.3. */
async function defaultGenerateTopics(
  input: GenerateTopicsInput
): Promise<ExtractedTopics> {
  const agent = createTopicsAgent(input.entitiesFormatted, input.existingTopicNames);
  const prompt = 'Extract content topics from the project entities above.';
  return traceable(
    async () => {
      const result = await agent.generate(prompt, {
        structuredOutput: { schema: extractedTopicsSchema },
        modelSettings: { temperature: 0.3 },
      });
      return result.object as ExtractedTopics;
    },
    {
      name: 'content.topics.extract',
      kind: 'generation',
      processInputs: () => ({ ...input, prompt, temperature: 0.3 }),
    },
  )();
}

export function streamingGenerateTopics(emit: StreamEmit): TopicsDeps['generateTopics'] {
  return async (input) => {
    const agent = createTopicsAgent(input.entitiesFormatted, input.existingTopicNames);
    const generate = streamingStructuredGenerate(emit, {
      agentStream: async ({ prompt, schema, temperature }) => {
        const stream = await agent.stream(prompt, {
          structuredOutput: { schema },
          modelSettings: { temperature, maxOutputTokens: 32768 },
          providerOptions: { openrouter: { reasoning: { effort: 'medium' } } },
        });
        return stream.fullStream as never;
      },
    });
    return generate({
      agentId: 'topics-agent',
      agentName: 'Topics Agent',
      instructions: '',
      prompt: 'Extract content topics from the project entities above.',
      schema: extractedTopicsSchema,
      temperature: 0.3,
    });
  };
}

/** Inline OpenAI embeddings (text-embedding-3-small) via the REST API. */
async function defaultEmbed(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured — cannot embed topics');
  }

  return traceable(
    async () => {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI embeddings error: ${response.status} - ${errText}`);
      }

      const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
      return data.data.map((row) => row.embedding);
    },
    {
      name: 'content.topics.embed',
      kind: 'embedding',
      processInputs: () => ({ model: 'text-embedding-3-small', texts, count: texts.length }),
      processOutputs: (output) => ({ vectorCount: output.length, dimensions: output[0]?.length ?? 0 }),
    },
  )();
}

export function makeDefaultTopicsDeps(): TopicsDeps {
  return {
    generateTopics: defaultGenerateTopics,
    embed: process.env.OPENAI_API_KEY ? defaultEmbed : undefined,
    repos: {
      getTopics,
      getEntitiesByProjectCount,
      createTopic,
      linkTopicToEntities,
      linkTopicToResearch,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers (ported from the Python node)
// ---------------------------------------------------------------------------

/** Format entities for the prompt with weighted scores (top 100). */
export function formatEntitiesForPrompt(entities: EntityRow[]): string {
  const formatted = entities.slice(0, 100).map((entity) => {
    const entityType = entity.entityType || 'Unknown';
    const name = entity.name || '';
    const projectCount = entity.projectCount || 0;
    const projectNames = entity.projectNames || [];

    const weight = ENTITY_TYPE_WEIGHTS[entityType] ?? 1.0;
    const weightedScore = projectCount * weight;

    let projectsStr = projectNames.slice(0, 5).join(', ');
    if (projectNames.length > 5) {
      projectsStr += ` (+${projectNames.length - 5} more)`;
    }

    return `- [${entityType}] ${name} (projects: ${projectCount}, weighted: ${weightedScore.toFixed(
      1
    )}) → ${projectsStr}`;
  });

  return formatted.length ? formatted.join('\n') : 'No entities found.';
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

interface ExistingEmbedding {
  name: string;
  vector: number[];
}

function findSimilarTopic(
  vector: number[],
  existing: ExistingEmbedding[]
): { isDuplicate: boolean; similarTo: string; similarity: number } {
  let maxSimilarity = 0;
  let mostSimilar = '';
  for (const e of existing) {
    const similarity = cosineSimilarity(vector, e.vector);
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      mostSimilar = e.name;
    }
  }
  return {
    isDuplicate: maxSimilarity >= SIMILARITY_THRESHOLD,
    similarTo: mostSimilar,
    similarity: maxSimilarity,
  };
}

/** Normalize an LLM topic name for exact-match dedup (matches the Python). */
function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/ /g, '-');
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

async function runExtractTopicsInternal(
  { deps }: { deps?: TopicsDeps } = {}
): Promise<ExtractTopicsResult> {
  const d = deps ?? makeDefaultTopicsDeps();
  const useEmbeddings = typeof d.embed === 'function';

  if (!useEmbeddings) {
    console.log(
      '[extract_topics] OPENAI_API_KEY not set — using name-only deduplication (no semantic dedup)'
    );
  }

  // 1. Existing topics (incl. dismissed) for dedup.
  const existingTopics = await observeWorkflowStep('content.topics.load_existing', {
    kind: 'data',
    input: { includeDismissed: true },
    processOutput: (output) => ({ existingTopicCount: (output as Topic[]).length }),
  }, async () => (await d.repos.getTopics(true)).topics);
  const existingNames = existingTopics.map((t) => t.name.toLowerCase());
  const existingNamesStr = existingNames.length
    ? existingNames.join(', ')
    : 'none';

  // 1b. Embeddings for existing topics (semantic dedup baseline).
  const existingEmbeddings: ExistingEmbedding[] = [];
  if (useEmbeddings && existingTopics.length > 0) {
    const texts = existingTopics.map((t) => `${t.name} - ${t.description}`);
    const vectors = await d.embed!(texts);
    existingTopics.forEach((t, i) => {
      existingEmbeddings.push({ name: t.name, vector: vectors[i] });
    });
  }

  // 2. Entities ordered by project count.
  const entities = await observeWorkflowStep('content.topics.load_entities', {
    kind: 'data',
    input: { orderBy: 'project_count', limit: 100 },
    processOutput: (output) => ({ entityCount: (output as EntityRow[]).length }),
  }, () => d.repos.getEntitiesByProjectCount());
  if (entities.length === 0) {
    return { topicsCreated: 0, topicsDeduped: 0 };
  }

  // 3. Format + 4. extract.
  const entitiesFormatted = formatEntitiesForPrompt(entities);
  const extracted = await d.generateTopics({
    entitiesFormatted,
    existingTopicNames: existingNamesStr,
  });

  if (!extracted.topics || extracted.topics.length === 0) {
    return { topicsCreated: 0, topicsDeduped: 0 };
  }

  // 4b. Embed the new topics in one batch.
  let newEmbeddings: number[][] = [];
  if (useEmbeddings) {
    const newTexts = extracted.topics.map((t) => `${t.name} - ${t.description}`);
    newEmbeddings = await d.embed!(newTexts);
  }

  // 5. Dedup + create.
  let topicsCreated = 0;
  let topicsDeduped = 0;

  for (let i = 0; i < extracted.topics.length; i++) {
    const topic = extracted.topics[i];
    const normalizedName = normalizeName(topic.name);

    // Exact-name dedup (existing set + within-batch created).
    if (existingNames.includes(normalizedName)) {
      topicsDeduped++;
      continue;
    }

    // Semantic dedup (existing set + within-batch created).
    if (useEmbeddings) {
      const newVector = newEmbeddings[i];
      const { isDuplicate, similarTo, similarity } = findSimilarTopic(
        newVector,
        existingEmbeddings
      );
      if (isDuplicate) {
        topicsDeduped++;
        console.log(
          `[extract_topics] Skipping semantically duplicate topic "${topic.name}"; similar to "${similarTo}" (${similarity.toFixed(
            2
          )})`
        );
        continue;
      }
    }

    // Create (createTopic MERGEs on name, so a null return is also a dup).
    const created = await d.repos.createTopic({
      name: normalizedName,
      displayName: topic.display_name,
      description: topic.description,
      source: 'llm_extracted',
    });

    if (created) {
      topicsCreated++;
      existingNames.push(normalizedName);
      if (useEmbeddings) {
        existingEmbeddings.push({
          name: normalizedName,
          vector: newEmbeddings[i],
        });
      }
      await d.repos.linkTopicToEntities(created.id, topic.source_entities);
      await d.repos.linkTopicToResearch(created.id, normalizedName);
    } else {
      topicsDeduped++;
    }
  }

  return { topicsCreated, topicsDeduped };
}

export const runExtractTopics = traceable(runExtractTopicsInternal, {
  name: 'content.topics.extract_workflow',
  kind: 'workflow',
  processInputs: () => ({ useConfiguredDependencies: true }),
});
