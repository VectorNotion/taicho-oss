/**
 * Unit tests for the do_research (§1) and extract_topics (§6) Mastra actions.
 *
 * No network, no database: Tavily search, the agent extraction call, OpenAI
 * embeddings, and every repository function are injected as stubs via the
 * orchestrators' `{ deps }` seam.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runDoResearch,
  type ResearchDeps,
  type TavilySearchParams,
  type TavilySearchResponse,
  type GenerateItemsInput,
} from '../agent/actions/research';
import type { ExtractedResearchItems } from '../agent/actions/research-agent';
import {
  runExtractTopics,
  type TopicsDeps,
  type EntityRow,
  type GenerateTopicsInput,
} from '../agent/actions/topics';
import type { ExtractedTopics } from '../agent/actions/topics-agent';
import type { CreateResearchItemFromAgentInput } from '../data/research-repository';
import type { ResearchSource, ResearchSourceType } from '../domain/research';
import type { Topic, CreateTopicInput, TopicsResponse } from '../domain/topic';
import type { Settings } from '@/packages/platform/settings/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SETTINGS: Settings = {
  id: 'global',
  mission: 'MISSION',
  identity: 'IDENTITY',
  voice: 'VOICE',
  updatedAt: '2026-01-01',
};

function makeTopic(p: Partial<Topic> & { name: string }): Topic {
  return {
    id: p.id ?? `topic-${p.name}`,
    name: p.name,
    displayName: p.displayName ?? p.name,
    description: p.description ?? '',
    status: p.status ?? 'active',
    source: p.source ?? 'llm_extracted',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    dismissedAt: null,
    mentionCount: 0,
  };
}

function makeTopicsResponse(topics: Topic[]): TopicsResponse {
  return {
    topics,
    total: topics.length,
    activeCount: topics.filter((t) => t.status === 'active').length,
    dismissedCount: topics.filter((t) => t.status === 'dismissed').length,
  };
}

function makeSource(
  p: Partial<ResearchSource> & { id: string; type: ResearchSourceType }
): ResearchSource {
  return {
    id: p.id,
    name: p.name ?? p.id,
    type: p.type,
    url: p.url ?? 'https://example.com',
    enabled: p.enabled ?? true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

function items(...titles: string[]): ExtractedResearchItems {
  return {
    items: titles.map((title) => ({
      title,
      content: `${title} content`,
      tags: ['tag-a', 'tag-b'],
      priority: 'medium' as const,
    })),
  };
}

function searchWith(...urls: string[]): TavilySearchResponse {
  return {
    content: urls.length ? `formatted:${urls.join(',')}` : '',
    results: urls.map((url) => ({ title: 't', url, content: 'c' })),
  };
}

// ---------------------------------------------------------------------------
// Research deps builder
// ---------------------------------------------------------------------------

interface ResearchCalls {
  byId: string[];
  enabledCalled: boolean;
  searchParams: TavilySearchParams[];
  generateItemsCalls: GenerateItemsInput[];
  persisted: CreateResearchItemFromAgentInput[];
  linked: Array<{ id: string; tags: string[] }>;
}

function makeResearchDeps(cfg: {
  topics?: Topic[];
  enabledSources?: ResearchSource[];
  sourcesById?: Record<string, ResearchSource>;
  search: (p: TavilySearchParams) => TavilySearchResponse;
  generateItems?: (i: GenerateItemsInput) => ExtractedResearchItems;
  persist?: (input: CreateResearchItemFromAgentInput, index: number) => {
    id: string;
    deduped: boolean;
  };
}): { deps: ResearchDeps; calls: ResearchCalls } {
  const calls: ResearchCalls = {
    byId: [],
    enabledCalled: false,
    searchParams: [],
    generateItemsCalls: [],
    persisted: [],
    linked: [],
  };

  const deps: ResearchDeps = {
    search: async (p) => {
      calls.searchParams.push(p);
      return cfg.search(p);
    },
    generateItems: async (i) => {
      calls.generateItemsCalls.push(i);
      return cfg.generateItems ? cfg.generateItems(i) : items();
    },
    repos: {
      getSettings: async () => SETTINGS,
      getTopics: async () => makeTopicsResponse(cfg.topics ?? []),
      getEnabledResearchSources: async () => {
        calls.enabledCalled = true;
        return cfg.enabledSources ?? [];
      },
      getResearchSourceById: async (id) => {
        calls.byId.push(id);
        return cfg.sourcesById?.[id] ?? null;
      },
      createResearchItemFromAgent: async (input) => {
        const index = calls.persisted.length;
        calls.persisted.push(input);
        return cfg.persist
          ? cfg.persist(input, index)
          : { id: `id-${index}`, deduped: false };
      },
      linkResearchToMatchingTopics: async (id, tags) => {
        calls.linked.push({ id, tags });
      },
    },
  };

  return { deps, calls };
}

// ---------------------------------------------------------------------------
// do_research tests
// ---------------------------------------------------------------------------

test('do_research: source-mode = explicit ids fetches by id, never enabled', async () => {
  const s1 = makeSource({ id: 's1', type: 'search_term', url: 'agents' });
  const s2 = makeSource({ id: 's2', type: 'search_term', url: 'rag' });
  const { deps, calls } = makeResearchDeps({
    sourcesById: { s1, s2 },
    search: () => searchWith('https://a.com'),
    generateItems: () => items('finding'),
  });

  const result = await runDoResearch({ sourceIds: ['s1', 's2'] }, { deps });

  assert.deepEqual(calls.byId, ['s1', 's2']);
  assert.equal(calls.enabledCalled, false);
  assert.equal(result.sourcesSearched, 2);
  assert.equal(result.itemsCreated, 2);
  assert.equal(result.itemsDeduped, 0);
  // search_term sources query on their url field
  assert.equal(calls.searchParams[0].query, 'agents');
  assert.equal(calls.searchParams[1].query, 'rag');
});

test('do_research: source-mode = enabled when no ids given', async () => {
  const src = makeSource({ id: 'e1', type: 'search_term', url: 'llm-ops' });
  const { deps, calls } = makeResearchDeps({
    enabledSources: [src],
    search: () => searchWith('https://a.com'),
    generateItems: () => items('finding'),
  });

  const result = await runDoResearch({}, { deps });

  assert.equal(calls.enabledCalled, true);
  assert.deepEqual(calls.byId, []);
  assert.equal(result.sourcesSearched, 1);
  assert.equal(result.itemsCreated, 1);
});

test('do_research: source-mode = none → combined active-topics query', async () => {
  const { deps, calls } = makeResearchDeps({
    topics: [
      makeTopic({ name: 'ai-agents', displayName: 'AI Agents' }),
      makeTopic({ name: 'graph-rag', displayName: 'Graph RAG' }),
    ],
    enabledSources: [],
    search: () => searchWith('https://news.com/x'),
    generateItems: () => items('trend'),
  });

  const result = await runDoResearch({}, { deps });

  // exactly one combined search, querying the OR-joined topic display names
  assert.equal(calls.searchParams.length, 1);
  assert.equal(calls.searchParams[0].query, 'AI Agents OR Graph RAG');
  assert.equal(calls.searchParams[0].includeDomains, undefined);
  assert.equal(result.sourcesSearched, 1);
  assert.equal(result.itemsCreated, 1);
  // combined-mode items carry no owning source
  assert.equal(calls.persisted[0].sourceId, null);
});

test('do_research: dedup counting splits created vs deduped', async () => {
  const src = makeSource({ id: 'e1', type: 'search_term', url: 'topic' });
  const { deps, calls } = makeResearchDeps({
    enabledSources: [src],
    search: () => searchWith('https://a.com', 'https://b.com'),
    generateItems: () => items('first', 'second'),
    // first item is new, second is a URL duplicate
    persist: (_input, index) => ({
      id: `id-${index}`,
      deduped: index === 1,
    }),
  });

  const result = await runDoResearch({}, { deps });

  assert.equal(result.itemsCreated, 1);
  assert.equal(result.itemsDeduped, 1);
  // only the newly-created item gets topic links
  assert.equal(calls.linked.length, 1);
  assert.equal(calls.linked[0].id, 'id-0');
});

test('do_research: empty search results short-circuit extraction', async () => {
  const src = makeSource({ id: 'e1', type: 'search_term', url: 'topic' });
  const { deps, calls } = makeResearchDeps({
    enabledSources: [src],
    search: () => searchWith(), // empty content + no results
    generateItems: () => items('should-not-happen'),
  });

  const result = await runDoResearch({}, { deps });

  assert.equal(calls.searchParams.length, 1);
  assert.equal(calls.generateItemsCalls.length, 0);
  assert.equal(calls.persisted.length, 0);
  assert.deepEqual(result, {
    itemsCreated: 0,
    itemsDeduped: 0,
    sourcesSearched: 0,
  });
});

test('do_research: website source is skipped when there are no active topics', async () => {
  const src = makeSource({
    id: 'w1',
    type: 'website',
    url: 'https://blog.example.com',
  });
  const { deps, calls } = makeResearchDeps({
    topics: [],
    enabledSources: [src],
    search: () => searchWith('https://a.com'),
  });

  const result = await runDoResearch({}, { deps });

  assert.equal(calls.searchParams.length, 0);
  assert.equal(result.sourcesSearched, 0);
});

test('do_research: website source queries topics within its domain', async () => {
  const src = makeSource({
    id: 'w1',
    type: 'website',
    url: 'https://blog.example.com/',
  });
  const { deps, calls } = makeResearchDeps({
    topics: [makeTopic({ name: 'ai-agents', displayName: 'AI Agents' })],
    enabledSources: [src],
    search: () => searchWith('https://blog.example.com/post'),
    generateItems: () => items('finding'),
  });

  await runDoResearch({}, { deps });

  assert.equal(calls.searchParams[0].query, 'AI Agents');
  assert.deepEqual(calls.searchParams[0].includeDomains, ['blog.example.com']);
});

// ---------------------------------------------------------------------------
// Topics deps builder
// ---------------------------------------------------------------------------

interface TopicsCalls {
  getTopicsCalled: boolean;
  generateTopicsCalls: GenerateTopicsInput[];
  embedCalls: string[][];
  createTopicCalls: CreateTopicInput[];
  linkedEntities: Array<{ id: string; names: string[] }>;
  linkedResearch: Array<{ id: string; name: string }>;
}

function makeEntity(p: Partial<EntityRow> & { name: string }): EntityRow {
  return {
    entityType: p.entityType ?? 'Feature',
    name: p.name,
    id: p.id ?? `e-${p.name}`,
    projectNames: p.projectNames ?? ['ProjectA'],
    projectCount: p.projectCount ?? 1,
  };
}

function makeTopicsDeps(cfg: {
  existingTopics?: Topic[];
  entities?: EntityRow[];
  generateTopics: (i: GenerateTopicsInput) => ExtractedTopics;
  embed?: (texts: string[]) => number[][];
  createTopic?: (data: CreateTopicInput) => Topic | null;
}): { deps: TopicsDeps; calls: TopicsCalls } {
  const calls: TopicsCalls = {
    getTopicsCalled: false,
    generateTopicsCalls: [],
    embedCalls: [],
    createTopicCalls: [],
    linkedEntities: [],
    linkedResearch: [],
  };

  const deps: TopicsDeps = {
    generateTopics: async (i) => {
      calls.generateTopicsCalls.push(i);
      return cfg.generateTopics(i);
    },
    embed: cfg.embed
      ? async (texts) => {
          calls.embedCalls.push(texts);
          return cfg.embed!(texts);
        }
      : undefined,
    repos: {
      getTopics: async () => {
        calls.getTopicsCalled = true;
        return makeTopicsResponse(cfg.existingTopics ?? []);
      },
      getEntitiesByProjectCount: async () => cfg.entities ?? [],
      createTopic: async (data) => {
        calls.createTopicCalls.push(data);
        if (cfg.createTopic) return cfg.createTopic(data);
        return makeTopic({
          name: data.name,
          displayName: data.displayName,
          description: data.description,
        });
      },
      linkTopicToEntities: async (id, names) => {
        calls.linkedEntities.push({ id, names });
      },
      linkTopicToResearch: async (id, name) => {
        calls.linkedResearch.push({ id, name });
      },
    },
  };

  return { deps, calls };
}

function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(' '));
  };
  const restore = () => {
    console.log = original;
  };
  return fn().then(
    (result) => {
      restore();
      return { result, logs };
    },
    (err) => {
      restore();
      throw err;
    }
  );
}

// ---------------------------------------------------------------------------
// extract_topics tests
// ---------------------------------------------------------------------------

test('extract_topics: empty entities short-circuit before the LLM call', async () => {
  const { deps, calls } = makeTopicsDeps({
    entities: [],
    generateTopics: () => ({ topics: [] }),
  });

  const result = await runExtractTopics({ deps });

  assert.equal(calls.generateTopicsCalls.length, 0);
  assert.deepEqual(result, { topicsCreated: 0, topicsDeduped: 0 });
});

test('extract_topics: semantic dedup catches a near-duplicate within the batch', async () => {
  const { deps, calls } = makeTopicsDeps({
    existingTopics: [],
    entities: [makeEntity({ name: 'Multi-Agent Orchestration', entityType: 'AIComponent' })],
    generateTopics: () => ({
      topics: [
        {
          name: 'multi-agent-systems',
          display_name: 'Multi-Agent Systems',
          description: 'Coordinating multiple agents',
          source_entities: ['Multi-Agent Orchestration'],
          confidence: 0.9,
        },
        {
          name: 'multi-agent-orchestration',
          display_name: 'Multi-Agent Orchestration',
          description: 'Orchestrating multiple agents',
          source_entities: ['Multi-Agent Orchestration'],
          confidence: 0.85,
        },
      ],
    }),
    // Two near-parallel vectors → cosine ≈ 0.99 ≥ 0.85
    embed: (texts) =>
      texts.map((t) =>
        t.startsWith('multi-agent-systems') ? [1, 0] : [0.99, 0.14]
      ),
  });

  const result = await runExtractTopics({ deps });

  assert.equal(result.topicsCreated, 1);
  assert.equal(result.topicsDeduped, 1);
  // only the first (non-duplicate) topic is created + linked
  assert.equal(calls.createTopicCalls.length, 1);
  assert.equal(calls.createTopicCalls[0].name, 'multi-agent-systems');
  assert.equal(calls.linkedEntities.length, 1);
  assert.equal(calls.linkedResearch.length, 1);
});

test('extract_topics: no-OPENAI_API_KEY falls back to name-only dedup with a notice', async () => {
  const { deps, calls } = makeTopicsDeps({
    existingTopics: [makeTopic({ name: 'existing-topic' })],
    entities: [makeEntity({ name: 'Some Feature' })],
    generateTopics: () => ({
      topics: [
        {
          name: 'existing-topic',
          display_name: 'Existing Topic',
          description: 'dup by exact name',
          source_entities: [],
          confidence: 0.9,
        },
        {
          name: 'brand-new-topic',
          display_name: 'Brand New Topic',
          description: 'genuinely new',
          source_entities: ['Some Feature'],
          confidence: 0.9,
        },
      ],
    }),
    // no embed → fallback path
  });

  const { result, logs } = await captureLogs(() => runExtractTopics({ deps }));

  assert.equal(result.topicsCreated, 1);
  assert.equal(result.topicsDeduped, 1);
  assert.equal(calls.embedCalls.length, 0);
  assert.equal(calls.createTopicCalls.length, 1);
  assert.equal(calls.createTopicCalls[0].name, 'brand-new-topic');
  assert.ok(
    logs.some((l) => l.includes('OPENAI_API_KEY not set')),
    'expected a name-only dedup fallback notice'
  );
});
