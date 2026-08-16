/**
 * DI-stubbed tests for dimension research (Shape A/B extraction) and the fit
 * match evaluator. No network — search and completion are injected.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { DimensionDefinition } from '../domain/qualification';
import {
  buildDimensionQuery,
  buildSynthesisPrompt,
  researchDimensions,
  type DimensionResearchDeps,
} from '../agent/dimension-research';
import { evaluateFitMatches } from '../agent/match-evaluator';

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

test('researchDimensions maps fit → prose and timing → signals, dates untouched', async () => {
  const calls: string[] = [];
  const deps: DimensionResearchDeps = {
    search: async (input) => { calls.push(input.query); return stubSearch(input); },
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

  const prose = records.find((r) => r.dimensionKey === 'internal_ai_capability');
  assert.equal(prose?.shape, 'prose');
  assert.equal(prose?.observedValue, 'No AI team found.');
  assert.equal(prose?.confidence, 0.91);
  assert.equal(prose?.researchedAt, NOW.toISOString());
  assert.equal(prose?.runId, 'run-1');

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

test('evaluateFitMatches skips dimensions without observations and timing dimensions', async () => {
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
  assert.equal(matches.length, 1);
  assert.equal(matches[0].dimensionKey, FIT_DIM.key);
  assert.ok(!prompt.includes('unobserved'), 'unobserved dim not sent to the model');
  assert.ok(!prompt.includes('hiring_activity'), 'timing dim never evaluated semantically');
});
