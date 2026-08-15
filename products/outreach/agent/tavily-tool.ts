import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { annotateWorkflow } from '@content-automation/observability';
import { captureResearchProviderUsage } from './provider-usage-capture';

const TAVILY_SEARCH_TIMEOUT_MS = 20_000;

const tavilySearchInputSchema = z.object({
  query: z.string().describe('Search query'),
  topic: z
    .enum(['company', 'news', 'ai', 'competitors', 'industry'])
    .describe('The topic category for this search'),
  maxResults: z.number().optional().default(5).describe('Maximum number of results to return'),
});

const tavilySearchOutputSchema = z.object({
  topic: z.string(),
  requestId: z.string().optional(),
  usage: z.object({ credits: z.number() }).optional(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
      publishedDate: z.string().nullable().optional(),
      score: z.number().optional(),
    })
  ),
});

export type TavilySearchInput = z.input<typeof tavilySearchInputSchema>;
export type TavilySearchOutput = z.output<typeof tavilySearchOutputSchema>;

export async function searchTavily(
  input: TavilySearchInput,
  signal?: AbortSignal,
  usageContext?: {
    runId: string;
    entityKind: 'account' | 'prospect';
    entityId?: string;
    dimensionKey: string;
  },
): Promise<TavilySearchOutput> {
  if (!process.env.TAVILY_API_KEY) throw new Error('Tavily search is not configured.');
  const parsed = tavilySearchInputSchema.parse(input);
  const searchSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(TAVILY_SEARCH_TIMEOUT_MS)])
    : AbortSignal.timeout(TAVILY_SEARCH_TIMEOUT_MS);
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: parsed.query,
      max_results: parsed.maxResults,
      search_depth: 'basic',
      include_raw_content: false,
      include_answer: false,
      include_usage: true,
    }),
    signal: searchSignal,
  });

  if (!response.ok) throw new Error(`Tavily search returned ${response.status}.`);
  const data = await response.json() as {
    request_id?: string;
    usage?: { credits?: number };
    results?: Array<{
      title: string;
      url: string;
      content: string;
      published_date?: string;
      score?: number;
    }>;
  };
  const output = tavilySearchOutputSchema.parse({
    topic: parsed.topic,
    requestId: data.request_id,
    usage: typeof data.usage?.credits === 'number' ? { credits: data.usage.credits } : undefined,
    results: data.results?.map((result) => ({
      title: result.title,
      url: result.url,
      content: result.content,
      publishedDate: result.published_date ?? null,
      score: result.score,
    })) ?? [],
  });
  if (usageContext) {
    await captureResearchProviderUsage({
      provider: 'tavily',
      operation: 'search',
      runId: usageContext.runId,
      entityKind: usageContext.entityKind,
      entityId: usageContext.entityId,
      dimensionKey: usageContext.dimensionKey,
      requestId: output.requestId,
      providerCredits: output.usage?.credits,
    });
  }
  annotateWorkflow({
    provider: 'tavily',
    'taicho.provider.request_ref': output.requestId,
    'taicho.usage.credits': output.usage?.credits,
    'taicho.research.evidence_count': output.results.length,
  });
  return output;
}

export const tavilySearchTool = createTool({
  id: 'tavily-search',
  description: 'Search the web for company/industry information',
  inputSchema: tavilySearchInputSchema,
  outputSchema: tavilySearchOutputSchema,
  execute: async (inputData, context) => {
    const { query, topic } = inputData;
    const writer = context?.writer;

    // Stream progress to UI - MUST have 'data' property for data- prefixed types
    await writer?.custom({
      type: 'data-tool-progress',
      data: { topic, status: 'searching', query },
    } as any);

    const data = await searchTavily(inputData, context?.abortSignal);

    await writer?.custom({
      type: 'data-tool-progress',
      data: { topic, status: 'complete', resultCount: data.results.length },
    } as any);

    return data;
  },
});
