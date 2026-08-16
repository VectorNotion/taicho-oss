/**
 * DI-stubbed tests for the account research orchestrator (no network / no DB).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AccountRecord,
  DimensionDefinition,
  DimensionMatch,
  ObservationRecord,
} from '../domain/qualification';
import {
  runAccountResearch,
  type AccountResearchDeps,
  type DimensionProgress,
} from '../agent/account-research';

const NOW = new Date('2026-08-10T00:00:00Z');
const ACCOUNT: AccountRecord = { id: 'acct-1', name: 'Acme', normalizedName: 'acme', createdAt: '2026-01-01T00:00:00Z' };

function dim(partial: Partial<DimensionDefinition> & { key: string }): DimensionDefinition {
  return {
    id: `dim-${partial.key}`, name: partial.key, dimensionType: 'fit', appliesTo: 'account',
    researchInstruction: `research ${partial.key}`, weight: 1, freshnessWindowDays: 120,
    isActive: true, createdAt: '2026-01-01T00:00:00Z', ...partial,
  };
}

const DIMS: DimensionDefinition[] = [
  dim({ key: 'icp_a', weight: 0.5 }),
  dim({ key: 'icp_b', weight: 0.5, hardExclusionRule: 'building AI internally' }),
  dim({ key: 'hiring_activity', dimensionType: 'timing', halfLifeDays: 45, freshnessWindowDays: 14, weight: 1 }),
  // A prospect dim that must be ignored by account research.
  dim({ key: 'persona_a', appliesTo: 'prospect', weight: 1 }),
];

function obsFor(dimension: DimensionDefinition, researchedAt = NOW.toISOString()): ObservationRecord {
  return {
    id: `obs-${dimension.key}`, dimensionKey: dimension.key,
    shape: dimension.dimensionType === 'timing' ? 'signals' : 'prose',
    observedValue: dimension.dimensionType === 'timing' ? undefined : `observed ${dimension.key}`,
    signals: dimension.dimensionType === 'timing'
      ? [{ signal: 'Posted sales roles', date: '2026-08-10', evidence: ['u'], confidence: 1 }]
      : undefined,
    evidence: [], confidence: 1, researchedAt, runId: 'run-0',
  };
}

interface Rec {
  researched: string[][];
  savedScore: { icpScore: number; timingScore: number; hardExcluded: boolean } | null;
  progress: DimensionProgress[];
  opportunityRefreshes: string[];
}

function makeDeps(config: {
  matchScores?: Record<string, { score: number; hardExclusion?: boolean }>;
  existing?: ObservationRecord[];
  hasRun?: boolean;
}): { deps: Partial<AccountResearchDeps>; rec: Rec } {
  const rec: Rec = { researched: [], savedScore: null, progress: [], opportunityRefreshes: [] };
  const store = [...(config.existing ?? [])];
  const deps: Partial<AccountResearchDeps> = {
    cascade: false,
    getAccountById: async () => ACCOUNT,
    getDimensionDefinitions: async () => DIMS,
    getObservations: async () => store,
    upsertObservation: async (_e, obs) => {
      const rest = { ...obs, id: `obs-${obs.dimensionKey}` };
      const i = store.findIndex((o) => o.dimensionKey === obs.dimensionKey);
      if (i >= 0) store[i] = rest; else store.push(rest);
      return rest;
    },
    researchDimensions: async (lapsed) => {
      rec.researched.push(lapsed.map((x) => x.key));
      return lapsed.map((x) => {
        const { id: ignoredId, ...rest } = obsFor(x);
        void ignoredId;
        return rest;
      });
    },
    evaluateFitMatches: async (fitDims, observations) => {
      const observed = new Set(observations.map((o) => o.dimensionKey));
      return fitDims.filter((x) => observed.has(x.key)).map((x) => {
        const cfg = config.matchScores?.[x.key] ?? { score: 1 };
        return { dimensionKey: x.key, matchScore: cfg.score, effectiveMatch: cfg.score, classification: 'strong_match', hardExclusion: cfg.hardExclusion ?? false, confidence: 1 } satisfies DimensionMatch;
      });
    },
    saveMatches: async () => undefined,
    recordResearchRun: async () => undefined,
    hasAnyResearchRun: async () => config.hasRun ?? false,
    saveAccountScore: async (_id, score) => { rec.savedScore = { icpScore: score.icpScore, timingScore: score.timingScore, hardExcluded: score.hardExcluded }; },
    refreshAccountOpportunityAngles: async (input) => {
      rec.opportunityRefreshes.push(input.account.id);
      return { count: 2 };
    },
    now: () => NOW,
    onDimension: (p) => rec.progress.push(p),
  };
  return { deps, rec };
}

test('runAccountResearch researches account fit+timing only, scores, ignores prospect dims', async () => {
  const { deps, rec } = makeDeps({ matchScores: { icp_a: { score: 0.9 }, icp_b: { score: 0.8 } } });
  const result = await runAccountResearch('acct-1', deps);

  // Researched account fit + timing dims; NOT the prospect dim.
  assert.deepEqual(rec.researched, [['icp_a', 'icp_b', 'hiring_activity']]);
  assert.ok(Math.abs(result.icpScore - 85) < 1e-6, 'icp = mean(0.9,0.8)×100');
  assert.equal(result.timingScore, 100, 'fresh signal → full heat');
  assert.equal(result.hardExcluded, false);
  assert.equal(result.opportunityCount, 2);
  assert.deepEqual(rec.opportunityRefreshes, ['acct-1']);
  assert.equal(rec.savedScore?.icpScore.toFixed(0), '85');
  assert.equal(rec.savedScore?.timingScore, 100);

  // Emitted per-dimension progress (searching + found + matched), never for persona_a.
  const keys = new Set(rec.progress.map((p) => p.dimensionKey));
  assert.ok(keys.has('icp_a') && keys.has('hiring_activity'));
  assert.ok(!keys.has('persona_a'), 'prospect dims never appear in account research');
  assert.ok(rec.progress.some((p) => p.phase === 'matched' && p.dimensionKey === 'icp_a'));
});

test('Catalog-scoped account research does not rewrite account opportunity angles', async () => {
  const { deps, rec } = makeDeps({});
  const result = await runAccountResearch('acct-1', {
    ...deps,
    catalogItemId: 'catalog-1',
    commercialContext: 'Catalog item: Product one',
  });

  assert.equal(result.opportunityCount, null);
  assert.deepEqual(rec.opportunityRefreshes, []);
});

test('hard exclusion on an account fit dimension propagates to the account score', async () => {
  const { rec } = makeDeps({});
  void rec;
  const { deps } = makeDeps({ matchScores: { icp_a: { score: 1 }, icp_b: { score: 1, hardExclusion: true } } });
  const result = await runAccountResearch('acct-1', deps);
  assert.equal(result.hardExcluded, true);
});

test('refresh run only re-researches lapsed account dimensions', async () => {
  const fresh = obsFor(DIMS[0]); // icp_a fresh
  const staleTiming = obsFor(DIMS[2], '2026-07-01T00:00:00Z'); // hiring lapsed (>14d)
  const { deps, rec } = makeDeps({ existing: [fresh, staleTiming], hasRun: true, matchScores: { icp_a: { score: 0.9 }, icp_b: { score: 0.9 } } });
  await runAccountResearch('acct-1', deps);
  // icp_b never observed + hiring lapsed → only those re-researched.
  assert.deepEqual(rec.researched, [['icp_b', 'hiring_activity']]);
});

test('an explicit refresh researches every account dimension even when evidence is fresh', async () => {
  const existing = DIMS.filter((dimension) => dimension.appliesTo === 'account').map((dimension) => obsFor(dimension));
  const { deps, rec } = makeDeps({ existing, hasRun: true });

  await runAccountResearch('acct-1', { ...deps, forceRefresh: true });

  assert.deepEqual(rec.researched, [['icp_a', 'icp_b', 'hiring_activity']]);
});

test('account research fails instead of completing when a requested criterion has no result', async () => {
  const { deps } = makeDeps({});

  await assert.rejects(
    () => runAccountResearch('acct-1', {
      ...deps,
      forceRefresh: true,
      researchDimensions: async (dimensions) => dimensions
        .filter((dimension) => dimension.key !== 'icp_b')
        .map((dimension) => {
          const { id: ignoredId, ...observation } = obsFor(dimension);
          void ignoredId;
          return observation;
        }),
    }),
    /Company research returned no result for: icp_b/,
  );
});

test('cascade researches new prospects and requalifies researched prospects', async () => {
  const { deps } = makeDeps({ matchScores: { icp_a: { score: 1 }, icp_b: { score: 1 } } });
  const started: Array<{ id: string; cascade: boolean }> = [];
  const markers: string[] = [];
  const qualified: string[] = [];
  const researched = new Set(['p-done']);
  await runAccountResearch('acct-1', {
    ...deps,
    cascade: true,
    getAccountProspects: async () => ['p-new', 'p-done', 'p-new2'],
    prospectHasResearch: async (id) => researched.has(id),
    researchProspect: (id, opts) => { started.push({ id, cascade: opts.cascade }); },
    qualifyProspect: async (id) => { qualified.push(id); },
    onProspect: (p) => markers.push(p.prospectId),
  });
  assert.deepEqual(
    started,
    [{ id: 'p-new', cascade: false }, { id: 'p-new2', cascade: false }],
    'researches only unresearched prospects, cascade off (loop-safe)',
  );
  assert.deepEqual(qualified, ['p-done'], 'requalifies existing prospects against the new account score');
  assert.deepEqual(markers, ['p-new', 'p-new2'], 'emits one marker per queued prospect');
});
