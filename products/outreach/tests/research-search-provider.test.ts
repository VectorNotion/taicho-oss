import assert from 'node:assert/strict';
import test from 'node:test';
import { outreachSearchProvider, searchTavily } from '../agent/tavily-tool';

const environmentKeys = [
  'OUTREACH_SEARCH_PROVIDER',
  'SEARCH_PROVIDER',
  'RESEARCH_EXTRACTOR_BASE_URL',
  'TAVILY_API_KEY',
] as const;

function restoreEnvironment(previous: Map<string, string | undefined>) {
  for (const key of environmentKeys) {
    const value = previous.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('open-source lead research defaults to Tavily', { concurrency: false }, async (t) => {
  const previous = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    restoreEnvironment(previous);
    globalThis.fetch = originalFetch;
  });
  delete process.env.OUTREACH_SEARCH_PROVIDER;
  delete process.env.SEARCH_PROVIDER;
  process.env.TAVILY_API_KEY = 'test-tavily-key';
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.tavily.com/search');
    assert.equal(JSON.parse(String(init?.body)).query, 'Acme funding');
    return new Response(JSON.stringify({
      request_id: 'tavily-request',
      results: [{ title: 'Acme', url: 'https://example.com/acme', content: 'Evidence' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  assert.equal(outreachSearchProvider(), 'tavily');
  const result = await searchTavily({ topic: 'company', query: 'Acme funding', maxResults: 3 });
  assert.equal(result.requestId, 'tavily-request');
  assert.equal(result.results[0]?.content, 'Evidence');
});

test('hosted lead research maps extracted Markdown to the Tavily-compatible contract', { concurrency: false }, async (t) => {
  const previous = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    restoreEnvironment(previous);
    globalThis.fetch = originalFetch;
  });
  process.env.OUTREACH_SEARCH_PROVIDER = 'research-extractor';
  process.env.SEARCH_PROVIDER = 'firecrawl';
  process.env.RESEARCH_EXTRACTOR_BASE_URL = 'http://127.0.0.1:13003/';
  delete process.env.TAVILY_API_KEY;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'http://127.0.0.1:13003/v1/research');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      query: 'Acme leadership',
      limit: 2,
      extractLimit: 2,
    });
    return new Response(JSON.stringify({
      requestId: 'extractor-request',
      durationMs: 321,
      search: { returned: 2, selected: 2 },
      extraction: { succeeded: 1, failed: 1, qualityPassing: 1 },
      results: [
        {
          title: 'Search title',
          url: 'https://example.com/leadership',
          snippet: 'Search snippet',
          score: 0.9,
          extraction: {
            title: 'Extracted title',
            markdown: 'Extracted page evidence',
            published: '2026-08-30',
            qualityPass: true,
            error: null,
          },
        },
        {
          title: 'Fallback title',
          url: 'https://example.com/fallback',
          snippet: 'Snippet survives an isolated extraction failure',
          extraction: { markdown: '', error: 'Blocked by origin' },
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  assert.equal(outreachSearchProvider(), 'research-extractor', 'outreach-specific setting wins');
  const result = await searchTavily({ topic: 'company', query: 'Acme leadership', maxResults: 2 });
  assert.equal(result.requestId, 'extractor-request');
  assert.deepEqual(result.telemetry, {
    durationMs: 321,
    pagesFound: 2,
    pagesRead: 1,
    pagesFailed: 1,
    attempts: 1,
  });
  assert.deepEqual(result.results.map(({ extractionStatus }) => extractionStatus), ['extracted', 'failed']);
  assert.deepEqual(result.results.map(({ title, content }) => ({ title, content })), [
    { title: 'Extracted title', content: 'Extracted page evidence' },
    { title: 'Fallback title', content: 'Snippet survives an isolated extraction failure' },
  ]);
});

test('hosted provider fails clearly when the extractor endpoint is missing', { concurrency: false }, async (t) => {
  const previous = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  t.after(() => restoreEnvironment(previous));
  process.env.OUTREACH_SEARCH_PROVIDER = 'research-extractor';
  delete process.env.RESEARCH_EXTRACTOR_BASE_URL;

  await assert.rejects(
    () => searchTavily({ topic: 'company', query: 'Acme', maxResults: 1 }),
    /Research extractor search is not configured/,
  );
});

test('hosted provider retries immediate pod capacity responses through a fresh connection', { concurrency: false }, async (t) => {
  const previous = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    restoreEnvironment(previous);
    globalThis.fetch = originalFetch;
  });
  process.env.OUTREACH_SEARCH_PROVIDER = 'research-extractor';
  process.env.RESEARCH_EXTRACTOR_BASE_URL = 'http://research-extractor.test';
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    assert.equal(new Headers(init?.headers).get('connection'), 'close');
    if (calls === 1) {
      return new Response(JSON.stringify({
        code: 'CAPACITY_EXHAUSTED',
        error: 'This extractor worker is at capacity; retry on another worker',
        retryable: true,
      }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } });
    }
    return new Response(JSON.stringify({
      requestId: 'retried-request',
      workerId: 'extractor-pod-b',
      durationMs: 25,
      search: { returned: 1, selected: 1 },
      extraction: { succeeded: 1, failed: 0, qualityPassing: 1 },
      results: [{
        title: 'Result',
        url: 'https://example.com/result',
        extraction: { title: 'Result', markdown: 'Evidence', error: null },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await searchTavily({ topic: 'company', query: 'Acme', maxResults: 1 });
  assert.equal(calls, 2);
  assert.equal(result.requestId, 'retried-request');
  assert.equal(result.telemetry?.attempts, 2);
  assert.equal(result.telemetry?.workerId, 'extractor-pod-b');
});

test('hosted provider exposes the final network cause after bounded retries', { concurrency: false }, async (t) => {
  const previous = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    restoreEnvironment(previous);
    globalThis.fetch = originalFetch;
  });
  process.env.OUTREACH_SEARCH_PROVIDER = 'research-extractor';
  process.env.RESEARCH_EXTRACTOR_BASE_URL = 'http://research-extractor.test';
  globalThis.fetch = async () => {
    const socket = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
    throw new TypeError('fetch failed', { cause: socket });
  };

  await assert.rejects(
    () => searchTavily({ topic: 'company', query: 'Acme', maxResults: 1 }),
    /fetch failed; caused by: UND_ERR_SOCKET: other side closed.*after 3 attempts/,
  );
});
