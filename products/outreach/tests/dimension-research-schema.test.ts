/**
 * DI-stubbed tests for dimension research (Shape A/B extraction) and the fit
 * match evaluator. No network — search and completion are injected.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type { DimensionDefinition } from '../domain/qualification';
import {
  buildDimensionQuery,
  buildSynthesisPrompt,
  cleanResearchIdentity,
  defaultCompleteJson,
  normalizeDimensionSynthesis,
  researchDimensions,
  type DimensionResearchDeps,
} from '../agent/dimension-research';
import { evaluateFitMatches } from '../agent/match-evaluator';
import type { ResearchActivity } from '../agent/dimension-progress';

const NOW = new Date('2026-08-10T00:00:00Z');

function dim(partial: Partial<DimensionDefinition> & { key: string }): DimensionDefinition {
  return {
    id: `dim-${partial.key}`,
    name: partial.key,
    dimensionType: 'fit',
    appliesTo: 'account',
    researchInstruction: `research ${partial.key}`,
    weight: 1,
    freshnessWindowDays: 120,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

const FIT_DIM = dim({
  key: 'internal_ai_capability',
  idealValue: 'Little or no AI capability.',
  hardExclusionRule: 'Hiring substantive AI/ML roles.',
});
const TIMING_DIM = dim({ key: 'hiring_activity', dimensionType: 'timing', halfLifeDays: 45, freshnessWindowDays: 14 });

const stubSearch: NonNullable<DimensionResearchDeps['search']> = async (input) => ({
  topic: input.topic,
  results: [
    { title: 'r', url: `https://example.test/${input.query.replaceAll(' ', '-')}`, content: 'evidence text', publishedDate: null },
  ],
});

test('structured research completion disables reasoning and preserves the full JSON budget', { concurrency: false }, async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"observations":[],"timingObservations":[]}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await defaultCompleteJson({
    schemaName: 'dimension_observations',
    schema: z.object({ observations: z.array(z.unknown()), timingObservations: z.array(z.unknown()) }),
    system: 'Return JSON.',
    prompt: 'Research all dimensions.',
  });
  assert.equal(requestBody.max_tokens, 16_384);
  assert.deepEqual(requestBody.response_format, { type: 'json_object' });
  assert.deepEqual(requestBody.reasoning, { effort: 'none' });
  const messages = requestBody.messages as Array<{ role: string; content: string }>;
  assert.match(messages[0]?.content ?? '', /<response_schema name="dimension_observations">/);
  assert.match(messages[0]?.content ?? '', /"timingObservations"/);
  assert.match(messages[0]?.content ?? '', /Preserve every property name and array shape exactly/);
});

test('researchDimensions maps fit → prose and timing → signals, dates untouched', async () => {
  const calls: string[] = [];
  const activities: ResearchActivity[] = [];
  const deps: DimensionResearchDeps = {
    search: async (input) => { calls.push(input.query); return stubSearch(input); },
    onActivity: (activity) => activities.push(activity),
    completeJson: async () => ({
      observations: [
        { dimensionKey: 'internal_ai_capability', observedValue: 'No AI team found.', evidence: ['https://example.test/e1'], confidence: 0.91 },
      ],
      timingObservations: [
        {
          dimensionKey: 'hiring_activity',
          signals: [
            { signal: 'Posted 3 Sales Manager openings', date: '2026-07-28', evidence: ['https://example.test/j1'], confidence: 0.9 },
            { signal: 'Undated rumor', date: 'unknown', evidence: [], confidence: 0.5 },
            { signal: 'Overconfident', date: '2026-08-01T12:00:00Z', evidence: [], confidence: 3 },
          ],
        },
      ],
    }),
  };

  const records = await researchDimensions([FIT_DIM, TIMING_DIM], { kind: 'account', name: 'Acme Corp' }, 'run-1', NOW, deps);

  assert.equal(calls.length, 2, 'one search per dimension');
  assert.equal(activities.filter(({ type }) => type === 'query_started').length, 2);
  assert.equal(activities.filter(({ type }) => type === 'query_completed').length, 2);
  const queryReceipt = activities.find(({ type, dimensionKey }) => type === 'query_completed' && dimensionKey === FIT_DIM.key);
  assert.equal(queryReceipt?.query, 'Acme Corp internal_ai_capability');
  assert.equal(queryReceipt?.pagesFound, 1);
  assert.equal(queryReceipt?.pagesRead, 1);
  assert.equal(queryReceipt?.pages?.[0]?.url, 'https://example.test/Acme-Corp-internal_ai_capability');
  assert.equal(queryReceipt?.pages?.[0]?.contentPreview, 'evidence text');
  assert.deepEqual(
    activities.filter(({ type }) => type.startsWith('synthesis_')).map(({ type }) => type),
    ['synthesis_started', 'synthesis_completed'],
  );

  const prose = records.find((r) => r.dimensionKey === 'internal_ai_capability');
  assert.equal(prose?.shape, 'prose');
  assert.equal(prose?.observedValue, 'No AI team found.');
  assert.equal(prose?.confidence, 0.91);
  assert.equal(prose?.researchedAt, NOW.toISOString());
  assert.equal(prose?.runId, 'run-1');
  assert.equal(prose?.sourceDocuments?.[0]?.content, 'evidence text', 'raw search content is retained for graph evidence');

  const signals = records.find((r) => r.dimensionKey === 'hiring_activity');
  assert.equal(signals?.shape, 'signals');
  assert.equal(signals?.signals?.length, 2, 'undated signal dropped');
  assert.equal(signals?.signals?.[0].date, '2026-07-28', 'date passed through untouched');
  assert.equal(signals?.signals?.[1].date, '2026-08-01', 'datetime trimmed to date');
  assert.equal(signals?.signals?.[1].confidence, 1, 'confidence clamped to [0,1]');
});

test('synthesis prompt carries instructions and the no-recency-judgment rule', () => {
  const prompt = buildSynthesisPrompt(
    [FIT_DIM, TIMING_DIM],
    [
      { dimensionKey: FIT_DIM.key, results: [] },
      { dimensionKey: TIMING_DIM.key, results: [] },
    ],
    { kind: 'account', name: 'Acme Corp' },
    NOW,
  );
  assert.ok(prompt.includes('research internal_ai_capability'));
  assert.ok(prompt.includes('research hiring_activity'));
  assert.ok(/do not judge recency/i.test(prompt.replace(/\n/g, ' ')), 'recency rule present');
  assert.ok(prompt.includes('2026-08-10'), 'today injected');
  assert.match(prompt, /observations array must contain exactly 1 items/i);
  assert.match(prompt, /timingObservations array must contain exactly 1 items/i);
});

test('research identity removes opaque fixture/import tokens from queries', () => {
  assert.equal(cleanResearchIdentity('Anthropic OUT004-20260830120959'), 'Anthropic');
  assert.equal(
    buildDimensionQuery(FIT_DIM, {
      kind: 'prospect',
      name: 'Dario Amodei',
      title: 'Chief Executive Officer',
      company: 'Anthropic OUT004-20260830120959',
    }),
    'Dario Amodei Chief Executive Officer Anthropic internal_ai_capability',
  );
});

test('synthesis normalization preserves useful items and retains missing criteria as insufficient evidence', () => {
  const normalized = normalizeDimensionSynthesis({
    observations: [{
      dimensionKey: 'Internal AI Capability',
      observedValue: 'A small internal team is documented.',
      evidence: ['https://example.test/team'],
      confidence: 0.8,
    }],
    timingObservations: [],
  }, [FIT_DIM, TIMING_DIM]);

  assert.equal(normalized.synthesis.observations[0]?.dimensionKey, FIT_DIM.key, 'display-name key repaired to canonical key');
  assert.equal(normalized.synthesis.observations[0]?.observedValue, 'A small internal team is documented.');
  assert.deepEqual(normalized.synthesis.timingObservations, [{ dimensionKey: TIMING_DIM.key, signals: [] }]);
  assert.ok(normalized.warnings.some((warning) => warning.includes('retained as insufficient evidence')));
});

test('Catalog context guides search relevance and is explicitly non-evidence', () => {
  const commercialContext = [
    'Catalog item: Automation advisory (service)',
    'Customer outcomes: A prioritized automation roadmap.',
  ].join('\n');
  const query = buildDimensionQuery(FIT_DIM, {
    kind: 'account',
    name: 'Acme Corp',
    commercialContext,
  });
  assert.match(query, /relevance to Automation advisory/);

  const prompt = buildSynthesisPrompt(
    [FIT_DIM],
    [{ dimensionKey: FIT_DIM.key, results: [] }],
    { kind: 'account', name: 'Acme Corp', commercialContext },
    NOW,
  );
  assert.ok(prompt.includes('Customer outcomes: A prioritized automation roadmap.'));
  assert.match(prompt, /It is not evidence/i);
});

test('empty dimension list short-circuits without calling anything', async () => {
  const records = await researchDimensions([], { kind: 'account', name: 'X' }, 'run', NOW, {
    search: async () => { throw new Error('must not search'); },
    completeJson: async () => { throw new Error('must not complete'); },
  });
  assert.deepEqual(records, []);
});

test('evaluateFitMatches: effective match multiplies freshness-decayed confidence', async () => {
  const staleDim = dim({ key: 'stale', idealValue: 'ideal', freshnessWindowDays: 14 });
  const observations = [
    {
      id: 'o1', dimensionKey: 'internal_ai_capability', shape: 'prose' as const,
      observedValue: 'No AI team.', evidence: [], confidence: 0.9,
      researchedAt: NOW.toISOString(), runId: 'run-1',
    },
    {
      id: 'o2', dimensionKey: 'stale', shape: 'prose' as const,
      observedValue: 'Old fact.', evidence: [], confidence: 0.8,
      // 28 days old with a 14-day window → one window past lapse → ×e^-1.
      researchedAt: '2026-07-13T00:00:00Z', runId: 'run-0',
    },
  ];

  const matches = await evaluateFitMatches([FIT_DIM, staleDim], observations, NOW, {
    completeJson: async () => ({
      matches: [
        { dimensionKey: 'internal_ai_capability', matchScore: 0.94, classification: 'strong_match', hardExclusionTriggered: true, rationale: 'r' },
        { dimensionKey: 'stale', matchScore: 1, classification: 'strong_match', hardExclusionTriggered: true, rationale: 'r' },
      ],
    }),
  });

  const fresh = matches.find((m) => m.dimensionKey === 'internal_ai_capability');
  assert.ok(fresh);
  assert.equal(fresh.confidence, 0.9);
  assert.ok(Math.abs(fresh.effectiveMatch - 0.94 * 0.9) < 1e-9);
  assert.equal(fresh.hardExclusion, true, 'dimension has a rule → exclusion honored');

  const stale = matches.find((m) => m.dimensionKey === 'stale');
  assert.ok(stale);
  assert.ok(Math.abs(stale.confidence - 0.8 * Math.exp(-1)) < 1e-9, 'freshness decay applied');
  assert.equal(stale.hardExclusion, false, 'no rule on dimension → exclusion ignored');
});

test('evaluateFitMatches marks missing fit observations as insufficient and excludes timing dimensions', async () => {
  let prompt = '';
  const matches = await evaluateFitMatches(
    [FIT_DIM, dim({ key: 'unobserved' }), TIMING_DIM],
    [
      { id: 'o1', dimensionKey: FIT_DIM.key, shape: 'prose', observedValue: 'x', evidence: [], confidence: 1, researchedAt: NOW.toISOString(), runId: 'r' },
      { id: 'o2', dimensionKey: TIMING_DIM.key, shape: 'signals', signals: [], evidence: [], confidence: 1, researchedAt: NOW.toISOString(), runId: 'r' },
    ],
    NOW,
    {
      completeJson: async (args) => {
        prompt = args.prompt;
        return {
          matches: [
            { dimensionKey: FIT_DIM.key, matchScore: 0.5, classification: 'partial_match', hardExclusionTriggered: false, rationale: 'r' },
          ],
        };
      },
    },
  );
  assert.equal(matches.length, 2);
  assert.equal(matches[0].dimensionKey, FIT_DIM.key);
  assert.equal(matches.find((match) => match.dimensionKey === 'unobserved')?.classification, 'insufficient_evidence');
  assert.ok(!prompt.includes('unobserved'), 'unobserved dim not sent to the model');
  assert.ok(!prompt.includes('hiring_activity'), 'timing dim never evaluated semantically');
});

test('evaluateFitMatches preserves valid model items when a sibling item is malformed', async () => {
  const malformedDim = dim({ key: 'malformed_match', idealValue: 'Documented ownership.' });
  const observations = [FIT_DIM, malformedDim].map((dimension, index) => ({
    id: `o-${index}`,
    dimensionKey: dimension.key,
    shape: 'prose' as const,
    observedValue: 'Evidence-backed observation.',
    evidence: ['https://example.test/evidence'],
    confidence: 0.9,
    researchedAt: NOW.toISOString(),
    runId: 'run-partial-match',
  }));

  const matches = await evaluateFitMatches([FIT_DIM, malformedDim], observations, NOW, {
    completeJson: async () => ({
      matches: [
        { dimensionKey: FIT_DIM.key, matchScore: 0.8, classification: 'strong_match', hardExclusionTriggered: false, rationale: 'supported' },
        { dimensionKey: malformedDim.key, matchScore: 7, classification: 'strong_match', hardExclusionTriggered: false, rationale: 'invalid score' },
      ],
    }),
  });

  assert.equal(matches.find((match) => match.dimensionKey === FIT_DIM.key)?.classification, 'strong_match');
  assert.equal(matches.find((match) => match.dimensionKey === malformedDim.key)?.classification, 'insufficient_evidence');
});
