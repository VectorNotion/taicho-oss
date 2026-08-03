/**
 * do_research action (§1) — Mastra orchestrator.
 *
 * Ported from the deleted LangGraph `do_research` node
 * (`graph/src/agent/nodes/do_research.py`). Flow:
 *   pick sources (by ids | all enabled | none → combined active-topics query)
 *   → Tavily search per source
 *   → per-source LLM extraction (temp 0.3, structured output)
 *   → persist each item (URL dedup + COVERS_TOPIC linking).
 *
 * Tavily is called via an inline fetch to https://api.tavily.com/search with
 * the exact §1 parameters (topic:"news", search_depth:"advanced", time_range,
 * max_results:5, include_raw_content:"markdown", include_domains for website
 * sources). Outreach's tavily tool is intentionally NOT imported.
 *
 * All external effects (Tavily search, the agent call, and the repositories)
 * are injected via the optional `{ deps }` parameter so the orchestrator can be
 * unit-tested with no network and no database. The defaults wire the real
 * implementations.
 */
import { getSettings } from '@content-automation/platform/settings/repository';
import type { Settings } from '@content-automation/platform/settings/types';
import { getTopics } from '../../data/topic-repository';
import {
  getEnabledResearchSources,
  getResearchSourceById,
  createResearchItemFromAgent,
  linkResearchToMatchingTopics,
  type CreateResearchItemFromAgentInput,
} from '../../data/research-repository';
import type { ResearchSource } from '../../domain/research';
import type { Topic, TopicsResponse } from '../../domain/topic';
import {
  createResearchAgent,
  extractedResearchItemsSchema,
  type ExtractedResearchItems,
} from './research-agent';
import { streamingStructuredGenerate, type StreamEmit } from '@content-automation/platform/agents/streaming';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface DoResearchPayload {
  sourceIds?: string[];
  timeRange?: string;
}

export interface DoResearchResult {
  itemsCreated: number;
  itemsDeduped: number;
  sourcesSearched: number;
}

// ---------------------------------------------------------------------------
// Injectable dependency seams
// ---------------------------------------------------------------------------

export interface TavilySearchParams {
  query: string;
  timeRange: string;
  maxResults?: number;
  includeDomains?: string[];
}

export interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
}

export interface TavilySearchResponse {
  /** LLM-ready formatted content string (empty when no usable results). */
  content: string;
  /** Raw result rows, used to attribute per-item source URLs. */
  results: TavilyResult[];
}

export interface GenerateItemsInput {
  sourceName: string;
  searchResults: string;
  mission: string;
  identity: string;
}

export interface ResearchRepos {
  getSettings: () => Promise<Settings>;
  getTopics: (includeDismissed: boolean) => Promise<TopicsResponse>;
  getEnabledResearchSources: () => Promise<ResearchSource[]>;
  getResearchSourceById: (id: string) => Promise<ResearchSource | null>;
  createResearchItemFromAgent: (
    input: CreateResearchItemFromAgentInput
  ) => Promise<{ id: string; deduped: boolean }>;
  linkResearchToMatchingTopics: (
    itemId: string,
    tags: string[]
  ) => Promise<void>;
}

export interface ResearchDeps {
  search: (params: TavilySearchParams) => Promise<TavilySearchResponse>;
  generateItems: (input: GenerateItemsInput) => Promise<ExtractedResearchItems>;
  repos: ResearchRepos;
}

// ---------------------------------------------------------------------------
// Default (real) implementations of the seams
// ---------------------------------------------------------------------------

const CONTENT_TRUNCATE_CHARS = 10000;

/**
 * Inline Tavily search — §1 parameters. Throws a clear error when
 * TAVILY_API_KEY is missing (real path only; unit tests inject a stub). HTTP
 * failures soft-fail to empty results, matching the Python node's resilience.
 */
async function defaultSearch(
  params: TavilySearchParams
): Promise<TavilySearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error(
      'TAVILY_API_KEY is not configured — do_research cannot run without it'
    );
  }

  const body: Record<string, unknown> = {
    api_key: apiKey,
    query: params.query,
    topic: 'news',
    search_depth: 'advanced',
    time_range: params.timeRange,
    max_results: params.maxResults ?? 5,
    include_raw_content: 'markdown',
  };
  if (params.includeDomains && params.includeDomains.length > 0) {
    body.include_domains = params.includeDomains;
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.warn(
      `[do_research] Tavily search failed for "${params.query}": ${response.status} - ${errText}`
    );
    return { content: '', results: [] };
  }

  const data = (await response.json()) as { results?: TavilyResult[] };
  const results = data.results ?? [];

  const formattedParts = results.map((r) => {
    let content = r.raw_content || r.content || '';
    if (content.length > CONTENT_TRUNCATE_CHARS) {
      content = content.slice(0, CONTENT_TRUNCATE_CHARS) + '... [truncated]';
    }
    return `Title: ${r.title ?? 'Untitled'}\nURL: ${r.url ?? ''}\nContent: ${content}`;
  });

  return { content: formattedParts.join('\n\n---\n\n'), results };
}

/** Default extraction: local research agent, structured output, temp 0.3. */
async function defaultGenerateItems(
  input: GenerateItemsInput
): Promise<ExtractedResearchItems> {
  const agent = createResearchAgent(input.mission, input.identity);
  const result = await agent.generate(
    `Source: ${input.sourceName}\n\nSearch Results:\n${input.searchResults}`,
    {
      structuredOutput: { schema: extractedResearchItemsSchema },
      modelSettings: { temperature: 0.3 },
    }
  );
  return result.object as ExtractedResearchItems;
}

export function streamingGenerateItems(emit: StreamEmit): ResearchDeps['generateItems'] {
  return async (input) => {
    const progressId = `source-${input.sourceName}`;
    emit({ type: 'data-progress', id: progressId, data: { label: `Extracting from ${input.sourceName}`, state: 'running' } });
    const agent = createResearchAgent(input.mission, input.identity);
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
    const result = await generate({
      agentId: 'research-agent',
      agentName: 'Research Agent',
      instructions: '',
      prompt: `Source: ${input.sourceName}\n\nSearch Results:\n${input.searchResults}`,
      schema: extractedResearchItemsSchema,
      temperature: 0.3,
    });
    emit({ type: 'data-progress', id: progressId, data: { label: `Extracted from ${input.sourceName}`, state: 'done' } });
    return result;
  };
}

export function makeDefaultResearchDeps(): ResearchDeps {
  return {
    search: defaultSearch,
    generateItems: defaultGenerateItems,
    repos: {
      getSettings,
      getTopics,
      getEnabledResearchSources,
      getResearchSourceById,
      createResearchItemFromAgent,
      linkResearchToMatchingTopics,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers (ported from the Python node)
// ---------------------------------------------------------------------------

/** Combine active-topic names into one Tavily query (`A OR B OR C`). */
export function buildTopicsQuery(topics: Topic[]): string {
  if (!topics.length) return '';
  const names = topics
    .map((t) => t.displayName || t.name)
    .filter((n): n is string => Boolean(n));
  return names.join(' OR ');
}

/** Strip scheme + trailing slashes to get a bare domain for include_domains. */
function extractDomain(url: string): string {
  return url
    .replace('https://', '')
    .replace('http://', '')
    .replace(/\/+$/, '');
}

interface CollectedItem {
  title: string;
  content: string;
  sourceUrl: string;
  sourceId: string | null;
  tags: string[];
  priority: 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runDoResearch(
  payload: DoResearchPayload,
  { deps }: { deps?: ResearchDeps } = {}
): Promise<DoResearchResult> {
  const d = deps ?? makeDefaultResearchDeps();
  const timeRange = payload.timeRange || 'day';

  const settings = await d.repos.getSettings();
  const topicsResponse = await d.repos.getTopics(false);
  const activeTopics = topicsResponse.topics;
  const topicsQuery = buildTopicsQuery(activeTopics);

  // 1. Source selection: explicit ids → all enabled → (fallback below).
  let sources: ResearchSource[];
  if (payload.sourceIds && payload.sourceIds.length > 0) {
    sources = [];
    for (const sid of payload.sourceIds) {
      const source = await d.repos.getResearchSourceById(sid);
      if (source) sources.push(source);
    }
  } else {
    sources = await d.repos.getEnabledResearchSources();
  }

  const collected: CollectedItem[] = [];
  let sourcesSearched = 0;

  // 2. Per-source Tavily search + extraction.
  for (const source of sources) {
    let content = '';
    let results: TavilyResult[] = [];

    if (source.type === 'search_term') {
      // The `url` field holds the search term for search_term sources.
      ({ content, results } = await d.search({
        query: source.url,
        timeRange,
        maxResults: 5,
      }));
    } else if (source.type === 'website') {
      // Search active topics within this website's domain; skip if no topics.
      if (!topicsQuery) continue;
      ({ content, results } = await d.search({
        query: topicsQuery,
        timeRange,
        maxResults: 5,
        includeDomains: [extractDomain(source.url)],
      }));
    }

    if (!content) continue; // empty-results short-circuit
    sourcesSearched++;

    const extracted = await d.generateItems({
      sourceName: source.name,
      searchResults: content,
      mission: settings.mission,
      identity: settings.identity,
    });

    extracted.items.forEach((item, i) => {
      const itemSourceUrl =
        i < results.length ? results[i].url ?? source.url : source.url;
      collected.push({
        title: item.title,
        content: item.content,
        sourceUrl: itemSourceUrl,
        sourceId: source.id,
        tags: item.tags,
        priority: item.priority,
      });
    });
  }

  // 3. Combined active-topics fallback: no sources but active topics exist.
  if (sources.length === 0 && activeTopics.length > 0 && topicsQuery) {
    const { content, results } = await d.search({
      query: topicsQuery,
      timeRange,
      maxResults: 5,
    });

    if (content) {
      sourcesSearched++;
      const extracted = await d.generateItems({
        sourceName: 'Topic Search',
        searchResults: content,
        mission: settings.mission,
        identity: settings.identity,
      });

      extracted.items.forEach((item, i) => {
        // No owning source; attribute to the matching Tavily result URL.
        const itemSourceUrl = i < results.length ? results[i].url : undefined;
        if (!itemSourceUrl) return; // cannot persist/dedup without a URL
        collected.push({
          title: item.title,
          content: item.content,
          sourceUrl: itemSourceUrl,
          sourceId: null,
          tags: item.tags,
          priority: item.priority,
        });
      });
    }
  }

  // 4. Persist: URL dedup lives in createResearchItemFromAgent; only newly
  //    created items get COVERS_TOPIC links.
  let itemsCreated = 0;
  let itemsDeduped = 0;

  for (const item of collected) {
    const { id, deduped } = await d.repos.createResearchItemFromAgent({
      title: item.title,
      content: item.content,
      sourceUrl: item.sourceUrl,
      sourceId: item.sourceId,
      tags: item.tags,
      priority: item.priority,
    });

    if (deduped) {
      itemsDeduped++;
    } else {
      itemsCreated++;
      await d.repos.linkResearchToMatchingTopics(id, item.tags);
    }
  }

  return { itemsCreated, itemsDeduped, sourcesSearched };
}
