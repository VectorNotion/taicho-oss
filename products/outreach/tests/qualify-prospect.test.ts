/**
 * DI-stubbed unit tests for the dimension-based qualify-prospect orchestrator
 * (no network / no DB). All repositories, research and evaluation are injected.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { runWithExecutionContext } from '@content-automation/observability';
import {
  drainProductEvents,
  setProductEventSinkForTests,
} from '@content-automation/platform/events/emit';
import type { ProductEventInsert } from '@content-automation/platform/events/repository';
import { runQualifyProspect, type QualifyProspectDeps } from '../agent/qualify-prospect';
import type {
  DimensionDefinition,
  DimensionMatch,
  ObservationRecord,
} from '../domain/qualification';
import type { Prospect } from '../domain/types';

const NOW = new Date('2026-08-10T00:00:00Z');

const PROSPECT: Prospect = {
  id: 'prospect-1',
  name: 'Jane Doe',
  title: 'COO',
  company: 'Acme',
  location: 'San Francisco',
  status: 'new',
  source: 'manual',
  priority: 'low',
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const ACCOUNT = { id: 'acct-1', name: 'Acme', normalizedName: 'acme', createdAt: '2026-01-01T00:00:00Z' };

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

const DIMS: DimensionDefinition[] = [
  dim({ key: 'icp_a', weight: 0.5 }),
  dim({ key: 'icp_b', weight: 0.5, hardExclusionRule: 'building AI internally' }),
  dim({ key: 'hiring_activity', dimensionType: 'timing', halfLifeDays: 45, freshnessWindowDays: 14, weight: 1 }),
  dim({ key: 'persona_a', appliesTo: 'prospect', weight: 1 }),
];

function observationFor(dimension: DimensionDefinition, researchedAt = NOW.toISOString()): ObservationRecord {
  return {
    id: `obs-${dimension.key}`,
    dimensionKey: dimension.key,
    shape: dimension.dimensionType === 'timing' ? 'signals' : 'prose',
    observedValue: dimension.dimensionType === 'timing' ? undefined : `observed ${dimension.key}`,
    signals:
      dimension.dimensionType === 'timing'
        ? [{ signal: 'Posted sales roles', date: '2026-08-10', evidence: [], confidence: 1 }]
        : undefined,
    evidence: [],
    confidence: 1,
    researchedAt,
    runId: 'run-0',
  };
}

function matchFor(key: string, matchScore: number, hardExclusion = false): DimensionMatch {
  return {
    dimensionKey: key,
    matchScore,
    effectiveMatch: matchScore,
    classification: 'strong_match',
    hardExclusion,
    confidence: 1,
  };
}

interface Recorder {
  researched: string[][];
  runs: Array<{ accountId: string; runType: string; refreshedDimensions: string[] }>;
  savedQualifications: Array<Parameters<QualifyProspectDeps['saveProspectQualification']>[1]>;
  priorities: number[];
}

/**
 * Fully-stubbed deps. `matchScores` decides fit evaluation per dimension key;
 * `existingObservations` pre-populates the observation stores.
 */
function makeDeps(config: {
  prospect?: Prospect | null;
  account?: typeof ACCOUNT | null;
  dims?: DimensionDefinition[];
  matchScores?: Record<string, { score: number; hardExclusion?: boolean }>;
  existingObservations?: { account?: ObservationRecord[]; prospect?: ObservationRecord[] };
  hasRun?: boolean;
}): { deps: Partial<QualifyProspectDeps>; rec: Recorder } {
  const rec: Recorder = { researched: [], runs: [], savedQualifications: [], priorities: [] };
  const stores = {
    account: [...(config.existingObservations?.account ?? [])],
    prospect: [...(config.existingObservations?.prospect ?? [])],
  };
  const dims = config.dims ?? DIMS;

  const deps: Partial<QualifyProspectDeps> = {
    getProspectById: async () => (config.prospect === undefined ? PROSPECT : config.prospect),
    resolveAccountForProspect: async () => (config.account === undefined ? ACCOUNT : config.account),
    getDimensionDefinitions: async () => dims,
    getObservations: async (entity) => stores[entity.kind],
    upsertObservation: async (entity, obs) => {
      stores[entity.kind] = stores[entity.kind].filter((o) => o.dimensionKey !== obs.dimensionKey);
      const record = { ...obs, id: `obs-${obs.dimensionKey}` };
      stores[entity.kind].push(record);
      return record;
    },
    researchDimensions: async (lapsed) => {
      rec.researched.push(lapsed.map((x) => x.key));
      return lapsed.map((x) => {
        const { id: _id, ...rest } = observationFor(x);
        return rest;
      });
    },
    evaluateFitMatches: async (fitDims, observations) => {
      const observed = new Set(observations.map((o) => o.dimensionKey));
      return fitDims
        .filter((x) => x.dimensionType === 'fit' && observed.has(x.key))
        .map((x) => {
          const cfg = config.matchScores?.[x.key] ?? { score: 1 };
          return matchFor(x.key, cfg.score, cfg.hardExclusion ?? false);
        });
    },
    saveMatches: async () => undefined,
    saveProspectQualification: async (_prospectId, result) => {
      rec.savedQualifications.push(result);
    },
    recordResearchRun: async (accountId, run) => {
      rec.runs.push({ accountId, ...run });
    },
    hasAnyResearchRun: async () => config.hasRun ?? false,
    updateProspectPriorityByScore: async (_prospectId, score) => {
      rec.priorities.push(score);
    },
    now: () => NOW,
  };

  return { deps, rec };
}

test('full run: researches everything, QUALIFIED, emits prospect.qualified with scores', async () => {
  const recorded: ProductEventInsert[] = [];
  setProductEventSinkForTests(async (event) => {
    recorded.push(event);
    return { id: randomUUID() };
  });
  try {
    const { deps, rec } = makeDeps({
      matchScores: { icp_a: { score: 0.9 }, icp_b: { score: 0.8 }, persona_a: { score: 0.95 } },
    });
    const result = await runWithExecutionContext(
      { organizationId: 'org-qualify-events', actorId: 'test', actorType: 'service' },
      () => runQualifyProspect('prospect-1', deps),
    );
    await drainProductEvents();

    assert.equal(result.status, 'success');
    assert.equal(result.qualification?.status, 'QUALIFIED');
    assert.ok(Math.abs((result.qualification?.icpScore ?? 0) - 85) < 1e-6, 'icp = mean(0.9,0.8)×100');
    assert.equal(result.qualification?.personaScore, 95);
    assert.equal(result.qualification?.timingScore, 100, 'fresh signal → full heat');

    // First research call covers all lapsed account dims, second the prospect dims.
    assert.deepEqual(rec.researched, [['icp_a', 'icp_b', 'hiring_activity'], ['persona_a']]);
    assert.equal(rec.runs.length, 1);
    assert.equal(rec.runs[0].runType, 'full');
    assert.deepEqual(rec.priorities, [85]);

    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].name, 'prospect.qualified');
    assert.equal(recorded[0].prospectId, 'prospect-1');
    assert.equal(recorded[0].payload.status, 'QUALIFIED');
    assert.equal(recorded[0].payload.personaScore, 95);
  } finally {
    setProductEventSinkForTests(null);
  }
});

test('refresh run: only lapsed dimensions are re-researched', async () => {
  const freshIcpA = observationFor(DIMS[0]); // fresh (researched now)
  const staleTiming = observationFor(DIMS[2], '2026-07-01T00:00:00Z'); // 40d > 14d window
  const freshPersona = observationFor(DIMS[3]);

  const { deps, rec } = makeDeps({
    existingObservations: { account: [freshIcpA, staleTiming], prospect: [freshPersona] },
    hasRun: true,
    matchScores: { icp_a: { score: 0.9 }, icp_b: { score: 0.9 }, persona_a: { score: 0.9 } },
  });

  const result = await runQualifyProspect('prospect-1', deps);
  assert.equal(result.status, 'success');

  // icp_b was never observed, hiring_activity lapsed; icp_a and persona_a are fresh.
  assert.deepEqual(rec.researched, [['icp_b', 'hiring_activity']]);
  assert.equal(rec.runs[0].runType, 'refresh');
  assert.deepEqual(rec.runs[0].refreshedDimensions, ['icp_b', 'hiring_activity']);
});

test('hard exclusion wins regardless of scores', async () => {
  const { deps, rec } = makeDeps({
    matchScores: { icp_a: { score: 1 }, icp_b: { score: 1, hardExclusion: true }, persona_a: { score: 1 } },
  });
  const result = await runQualifyProspect('prospect-1', deps);
  assert.equal(result.qualification?.status, 'HARD_EXCLUDED');
  assert.equal(rec.savedQualifications[0].status, 'HARD_EXCLUDED');
});

test('high ICP + low persona → CONTACT_DISCOVERY_REQUIRED', async () => {
  const { deps } = makeDeps({
    matchScores: { icp_a: { score: 0.9 }, icp_b: { score: 0.9 }, persona_a: { score: 0.2 } },
  });
  const result = await runQualifyProspect('prospect-1', deps);
  assert.equal(result.qualification?.status, 'CONTACT_DISCOVERY_REQUIRED');
});

test('low ICP → UNQUALIFIED even with a perfect persona', async () => {
  const { deps } = makeDeps({
    matchScores: { icp_a: { score: 0.3 }, icp_b: { score: 0.3 }, persona_a: { score: 1 } },
  });
  const result = await runQualifyProspect('prospect-1', deps);
  assert.equal(result.qualification?.status, 'UNQUALIFIED');
});

test('no company → REVIEW with reason, no account research', async () => {
  const { deps, rec } = makeDeps({
    account: null,
    matchScores: { persona_a: { score: 0.9 } },
  });
  const result = await runQualifyProspect('prospect-1', deps);
  assert.equal(result.qualification?.status, 'REVIEW');
  assert.match(result.qualification?.reviewReason ?? '', /no company/);
  assert.equal(result.qualification?.icpScore, 0);
  assert.equal(rec.runs.length, 0, 'no account → no research run');
  assert.deepEqual(rec.researched, [['persona_a']], 'only prospect research happens');
});

test('timing never gates: zero timing heat still QUALIFIED', async () => {
  const coldTiming = observationFor(DIMS[2], NOW.toISOString());
  coldTiming.signals = []; // no signals at all
  const { deps } = makeDeps({
    existingObservations: { account: [coldTiming] },
    matchScores: { icp_a: { score: 0.9 }, icp_b: { score: 0.9 }, persona_a: { score: 0.9 } },
  });
  const result = await runQualifyProspect('prospect-1', deps);
  assert.equal(result.qualification?.timingScore, 0);
  assert.equal(result.qualification?.status, 'QUALIFIED');
});

test('missing prospect throws', async () => {
  const { deps } = makeDeps({ prospect: null });
  await assert.rejects(() => runQualifyProspect('missing', deps), /Prospect not found/);
});
