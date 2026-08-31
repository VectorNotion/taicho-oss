import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { annotateWorkflow } from '@content-automation/observability';
import { captureResearchProviderUsage } from './provider-usage-capture';

const TAVILY_SEARCH_TIMEOUT_MS = 20_000;
const RESEARCH_EXTRACTOR_TIMEOUT_MS = 180_000;
const RESEARCH_EXTRACTOR_MAX_ATTEMPTS = 3;
const RESEARCH_EXTRACTOR_RETRY_BASE_DELAY_MS = 150;
const SCRAPED_CONTENT_MAX_CHARS = 6_000;
const SCRAPED_FULL_CONTENT_MAX_CHARS = 60_000;

export type OutreachSearchProvider =
  | 'tavily'
  | 'research-extractor'
  | 'firecrawl'
  | 'searxng';

export function outreachSearchProvider(): OutreachSearchProvider {
  const configured = (
    process.env.OUTREACH_SEARCH_PROVIDER
    || process.env.SEARCH_PROVIDER
    || 'tavily'
  ).trim().toLowerCase();
  if (
    configured === 'tavily'
    || configured === 'research-extractor'
    || configured === 'firecrawl'
    || configured === 'searxng'
  ) {
    return configured;
  }
  throw new Error(`Unsupported outreach search provider: ${configured}`);
}

const tavilySearchInputSchema = z.object({
  query: z.string().describe('Search query'),
  topic: z
    .enum(['company', 'news', 'ai', 'competitors', 'industry'])
    .describe('The topic category for this search'),
  maxResults: z.number().optional().default(5).describe('Maximum number of results to return'),
  /** Vector research: return full scraped content instead of the usual capped slice. */
  fullContent: z.boolean().optional(),
});

const tavilySearchOutputSchema = z.object({
  topic: z.string(),
  requestId: z.string().optional(),
  usage: z.object({ credits: z.number() }).optional(),
  telemetry: z.object({
    durationMs: z.number().optional(),
    pagesFound: z.number(),
    pagesRead: z.number(),
    pagesFailed: z.number(),
    attempts: z.number().int().positive().optional(),
    workerId: z.string().optional(),
  }).optional(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
      publishedDate: z.string().nullable().optional(),
      score: z.number().optional(),
      extractionStatus: z.enum(['extracted', 'snippet', 'failed']).optional(),
      extractionError: z.string().optional(),
    })
  ),
});

export type TavilySearchInput = z.input<typeof tavilySearchInputSchema>;
export type TavilySearchOutput = z.output<typeof tavilySearchOutputSchema>;

/**
 * Lead research has its own provider selector so hosted Taicho can use the
 * internal extractor without changing content research or the open-source
 * Tavily default. SEARCH_PROVIDER remains a compatibility fallback.
 */
async function searchSearxng(
  parsed: z.output<typeof tavilySearchInputSchema>,
  searchSignal: AbortSignal,
): Promise<TavilySearchOutput> {
  const base = process.env.SEARXNG_BASE_URL?.replace(/\/+$/, '');
  if (!base) throw new Error('SearXNG search is not configured.');
  const url = `${base}/search?q=${encodeURIComponent(parsed.query)}&format=json`;
  const response = await fetch(url, { signal: searchSignal });
  if (!response.ok) throw new Error(`SearXNG search returned ${response.status}.`);
  const data = await response.json() as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      publishedDate?: string | null;
      score?: number;
    }>;
  };
  return tavilySearchOutputSchema.parse({
    topic: parsed.topic,
    results: (data.results ?? [])
      .filter((result) => result.url && result.title)
      .slice(0, parsed.maxResults)
      .map((result) => ({
        title: result.title ?? '',
        url: result.url ?? '',
        content: result.content ?? '',
        publishedDate: result.publishedDate ?? null,
        score: result.score,
      })),
  });
}

/**
 * Firecrawl (self-hosted) — the full Tavily contract: SearXNG finds the
 * pages, Firecrawl scrapes them, and each result carries extracted page
 * content instead of a two-line SERP snippet. Content is capped per result
 * so a long LinkedIn profile cannot blow up the LLM context.
 */
const FIRECRAWL_SEARCH_TIMEOUT_MS = 90_000;

async function searchFirecrawl(
  parsed: z.output<typeof tavilySearchInputSchema>,
  searchSignal: AbortSignal,
): Promise<TavilySearchOutput> {
  const base = process.env.FIRECRAWL_BASE_URL?.replace(/\/+$/, '');
  if (!base) throw new Error('Firecrawl search is not configured.');
  const response = await fetch(`${base}/v1/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY || 'self-hosted'}`,
    },
    body: JSON.stringify({
      query: parsed.query,
      limit: parsed.maxResults,
      scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
    }),
    signal: searchSignal,
  });
  if (!response.ok) throw new Error(`Firecrawl search returned ${response.status}.`);
  const data = await response.json() as {
    success?: boolean;
    data?: Array<{
      title?: string;
      url?: string;
      description?: string;
      markdown?: string;
    }>;
  };
  return tavilySearchOutputSchema.parse({
    topic: parsed.topic,
    results: (data.data ?? [])
      .filter((result) => result.url && result.title)
      .map((result) => ({
        title: result.title ?? '',
        url: result.url ?? '',
        content: (result.markdown || result.description || '').slice(
          0, parsed.fullContent ? SCRAPED_FULL_CONTENT_MAX_CHARS : SCRAPED_CONTENT_MAX_CHARS,
        ),
        publishedDate: null,
      })),
  });
}

async function searchResearchExtractor(
  parsed: z.output<typeof tavilySearchInputSchema>,
  searchSignal: AbortSignal,
): Promise<TavilySearchOutput> {
  const base = process.env.RESEARCH_EXTRACTOR_BASE_URL?.replace(/\/+$/, '');
  if (!base) throw new Error('Research extractor search is not configured.');
  const { response, attempts } = await fetchResearchExtractor(`${base}/v1/research`, {
    query: parsed.query,
    limit: parsed.maxResults,
    extractLimit: parsed.maxResults,
  }, searchSignal);
  const data = await response.json() as {
    requestId?: string;
    workerId?: string;
    durationMs?: number;
    search?: { returned?: number; selected?: number };
    extraction?: { succeeded?: number; failed?: number; qualityPassing?: number };
    results?: Array<{
      title?: string;
      url?: string;
      snippet?: string;
      publishedDate?: string | null;
      score?: number | null;
      extraction?: null | {
        title?: string;
        markdown?: string;
        published?: string;
        qualityPass?: boolean;
        error?: string | null;
      };
    }>;
  };
  const output = tavilySearchOutputSchema.parse({
    topic: parsed.topic,
    requestId: data.requestId,
    telemetry: {
      durationMs: data.durationMs,
      pagesFound: data.search?.returned ?? data.results?.length ?? 0,
      pagesRead: data.extraction?.succeeded ?? 0,
      pagesFailed: data.extraction?.failed ?? 0,
      attempts,
      ...(data.workerId ? { workerId: data.workerId } : {}),
    },
    results: (data.results ?? [])
      .filter((result) => result.url && (result.extraction?.title || result.title))
      .slice(0, parsed.maxResults)
      .map((result) => ({
        title: result.extraction?.title || result.title || '',
        url: result.url || '',
        content: (result.extraction?.markdown || result.snippet || '').slice(
          0, parsed.fullContent ? SCRAPED_FULL_CONTENT_MAX_CHARS : SCRAPED_CONTENT_MAX_CHARS,
        ),
        publishedDate: result.extraction?.published || result.publishedDate || null,
        score: result.score ?? undefined,
        extractionStatus: result.extraction?.error
          ? 'failed'
          : result.extraction?.markdown
            ? 'extracted'
            : 'snippet',
        extractionError: result.extraction?.error || undefined,
      })),
  });
  annotateWorkflow({
    provider: 'research-extractor',
    'taicho.provider.request_ref': output.requestId,
    'taicho.research.evidence_count': output.results.length,
    'taicho.research.quality_evidence_count': data.extraction?.qualityPassing,
    'taicho.research.provider_duration_ms': data.durationMs,
    'taicho.research.provider_attempts': attempts,
    'taicho.research.provider_worker': data.workerId,
  });
  return output;
}

class ResearchExtractorRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly upstreamCode?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ResearchExtractorRequestError';
  }
}

function extractorErrorDetails(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    if ((typeof current === 'object' || typeof current === 'function') && seen.has(current)) break;
    seen.add(current);
    const record = typeof current === 'object' && current !== null
      ? current as { message?: unknown; code?: unknown; cause?: unknown }
      : {};
    const message = current instanceof Error
      ? current.message
      : typeof record.message === 'string'
        ? record.message
        : String(current);
    const code = typeof record.code === 'string' ? record.code : '';
    const part = code && !message.includes(code) ? `${code}: ${message}` : message;
    if (part && !parts.includes(part)) parts.push(part);
    current = record.cause;
  }
  return parts.join('; caused by: ')
    .replace(/https?:\/\/[^@\s]+@/g, 'http://[redacted]@')
    .slice(0, 1_000) || 'unknown network failure';
}

function retryDelay(response: Response | undefined, attempt: number): number {
  const retryAfter = Number(response?.headers.get('retry-after'));
  const requestedMs = Number.isFinite(retryAfter) && retryAfter >= 0
    ? retryAfter * 1_000
    : RESEARCH_EXTRACTOR_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
  return Math.min(2_000, requestedMs) + Math.floor(Math.random() * 151);
}

async function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Research extractor request was aborted.');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error
        ? signal.reason
        : new Error('Research extractor request was aborted.'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function responseFailure(response: Response): Promise<ResearchExtractorRequestError> {
  const payload = await response.json().catch(() => null) as null | {
    code?: unknown;
    error?: unknown;
    retryable?: unknown;
    requestId?: unknown;
  };
  const upstreamMessage = typeof payload?.error === 'string' ? payload.error : response.statusText || 'request rejected';
  const upstreamCode = typeof payload?.code === 'string' ? payload.code : undefined;
  const requestId = typeof payload?.requestId === 'string' ? `; request ${payload.requestId}` : '';
  const retryable = payload?.retryable === true || [429, 502, 503, 504].includes(response.status);
  return new ResearchExtractorRequestError(
    `Research extractor returned HTTP ${response.status}${upstreamCode ? ` (${upstreamCode})` : ''}: ${upstreamMessage}${requestId}`,
    retryable,
    response.status,
    upstreamCode,
  );
}

async function fetchResearchExtractor(
  url: string,
  body: { query: string; limit: number; extractLimit: number },
  signal: AbortSignal,
): Promise<{ response: Response; attempts: number }> {
  let latestError: ResearchExtractorRequestError | null = null;

  for (let attempt = 1; attempt <= RESEARCH_EXTRACTOR_MAX_ATTEMPTS; attempt += 1) {
    let response: Response | undefined;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // A Kubernetes Service selects a pod per connection. Closing each
          // batch connection lets concurrent queries and retries be balanced
          // across extractor replicas instead of sticking to one pod.
          Connection: 'close',
        },
        body: JSON.stringify(body),
        signal,
      });
      if (response.ok) return { response, attempts: attempt };
      latestError = await responseFailure(response);
      if (!latestError.retryable) throw latestError;
    } catch (error) {
      if (signal.aborted) throw signal.reason instanceof Error
        ? signal.reason
        : new Error('Research extractor request was aborted.');
      if (error instanceof ResearchExtractorRequestError) {
        latestError = error;
        if (!error.retryable) throw error;
      } else {
        latestError = new ResearchExtractorRequestError(
          `Research extractor network request failed: ${extractorErrorDetails(error)}`,
          true,
          undefined,
          undefined,
          { cause: error },
        );
      }
    }

    if (attempt === RESEARCH_EXTRACTOR_MAX_ATTEMPTS) break;
    await waitForRetry(retryDelay(response, attempt), signal);
  }

  throw new ResearchExtractorRequestError(
    `${latestError?.message || 'Research extractor request failed'} after ${RESEARCH_EXTRACTOR_MAX_ATTEMPTS} attempts.`,
    false,
    latestError?.status,
    latestError?.upstreamCode,
    latestError ? { cause: latestError } : undefined,
  );
}

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
  const parsed = tavilySearchInputSchema.parse(input);
  const provider = outreachSearchProvider();
  if (provider === 'research-extractor') {
    const extractorSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(RESEARCH_EXTRACTOR_TIMEOUT_MS)])
      : AbortSignal.timeout(RESEARCH_EXTRACTOR_TIMEOUT_MS);
    return searchResearchExtractor(parsed, extractorSignal);
  }
  if (provider === 'firecrawl') {
    const firecrawlSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(FIRECRAWL_SEARCH_TIMEOUT_MS)])
      : AbortSignal.timeout(FIRECRAWL_SEARCH_TIMEOUT_MS);
    return searchFirecrawl(parsed, firecrawlSignal);
  }
  const providerSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(TAVILY_SEARCH_TIMEOUT_MS)])
    : AbortSignal.timeout(TAVILY_SEARCH_TIMEOUT_MS);
  if (provider === 'searxng') {
    return searchSearxng(parsed, providerSignal);
  }
  if (!process.env.TAVILY_API_KEY) throw new Error('Tavily search is not configured.');
  const searchSignal = providerSignal;
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
