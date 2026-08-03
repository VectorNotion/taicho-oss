import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const tavilySearchTool = createTool({
  id: 'tavily-search',
  description: 'Search the web for company/industry information',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    topic: z
      .enum(['company', 'news', 'ai', 'competitors', 'industry'])
      .describe('The topic category for this search'),
    maxResults: z.number().optional().default(5).describe('Maximum number of results to return'),
  }),
  outputSchema: z.object({
    topic: z.string(),
    results: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        content: z.string(),
        publishedDate: z.string().nullable().optional(),
        score: z.number().optional(),
      })
    ),
  }),
  execute: async (inputData, context) => {
    const { query, topic, maxResults } = inputData;
    const writer = context?.writer;

    // Stream progress to UI - MUST have 'data' property for data- prefixed types
    await writer?.custom({
      type: 'data-tool-progress',
      data: { topic, status: 'searching', query },
    } as any);

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_raw_content: false,
        include_answer: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Tavily API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    await writer?.custom({
      type: 'data-tool-progress',
      data: { topic, status: 'complete', resultCount: data.results?.length ?? 0 },
    } as any);

    return {
      topic,
      results:
        data.results?.map((r: { title: string; url: string; content: string; published_date?: string; score?: number }) => ({
          title: r.title,
          url: r.url,
          content: r.content,
          publishedDate: r.published_date ?? null,
          score: r.score,
        })) ?? [],
    };
  },
});
