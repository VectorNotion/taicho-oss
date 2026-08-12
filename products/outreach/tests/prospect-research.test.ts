/**
 * DI-stubbed tests for persona-only prospect research (no network / no DB).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  DimensionDefinition,
  DimensionMatch,
  ObservationRecord,
} from '../domain/qualification';
import type { Prospect } from '../domain/types';
import {
  runProspectResearch,
  type ProspectResearchDeps,
} from '../agent/prospect-research';

const NOW = new Date('2026-08-10T00:00:00Z');
const PROSPECT: Prospect = {
  id: 'p1', name: 'Jane Doe', title: 'COO', company: 'Acme', location: 'SF',
  status: 'new', source: 'manual', priority: 'low', tags: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

function dim(partial: Partial<DimensionDefinition> & { key: string }): DimensionDefinition {
  return {
    id: `dim-${partial.key}`, name: partial.key, dimensionType: 'fit', appliesTo: 'prospect',
    researchInstruction: `research ${partial.key}`, weight: 1, freshnessWindowDays: 180,
    isActive: true, createdAt: '2026-01-01T00:00:00Z', ...partial,
  };
}

const DIMS: DimensionDefinition[] = [
  dim({ key: 'authority', weight: 0.5 }),
  dim({ key: 'ownership', weight: 0.5, hardExclusionRule: 'is an IC engineer' }),
  // account dim that prospect research must ignore
  dim({ key: 'icp_a', appliesTo: 'account', weight: 1 }),
];

function obsFor(dimension: DimensionDefinition): ObservationRecord {
  return {
    id: `obs-${dimension.key}`, dimensionKey: dimension.key, shape: 'prose',
    observedValue: `observed ${dimension.key}`, evidence: [], confidence: 1,
    researchedAt: NOW.toISOString(), runId: 'run-0',
  };
}

interface Rec { researched: string[][]; savedScore: { personaScore: number; hardExcluded: boolean } | null; qualified: string[] }

function makeDeps(config: { matchScores?: Record<string, { score: number; hardExclusion?: boolean }> }): { deps: Partial<ProspectResearchDeps>; rec: Rec } {
  const rec: Rec = { researched: [], savedScore: null, qualified: [] };
  const store: ObservationRecord[] = [];
  const deps: Partial<ProspectResearchDeps> = {
    cascade: false,
    getProspectById: async () => PROSPECT,
    getDimensionDefinitions: async () => DIMS,
    getObservations: async () => store,
    upsertObservation: async (_e, obs) => {
      const rest = { ...obs, id: `obs-${obs.dimensionKey}` };
      store.push(rest);
      return rest;
    },
    researchDimensions: async (lapsed) => {
      rec.researched.push(lapsed.map((x) => x.key));
      return lapsed.map((x) => { const { id: _id, ...rest } = obsFor(x); return rest; });
    },
    evaluateFitMatches: async (fitDims, observations) => {
      const observed = new Set(observations.map((o) => o.dimensionKey));
      return fitDims.filter((x) => observed.has(x.key)).map((x) => {
        const cfg = config.matchScores?.[x.key] ?? { score: 1 };
        return { dimensionKey: x.key, matchScore: cfg.score, effectiveMatch: cfg.score, classification: 'strong_match', hardExclusion: cfg.hardExclusion ?? false, confidence: 1 } satisfies DimensionMatch;
      });
    },
    saveMatches: async () => undefined,
    saveProspectScore: async (_id, score) => { rec.savedScore = { personaScore: score.personaScore, hardExcluded: score.hardExcluded }; },
    runQualifyProspect: async (id) => { rec.qualified.push(id); return { status: 'success' }; },
    now: () => NOW,
  };
  return { deps, rec };
}

test('runProspectResearch researches persona dims only, scores, chains qualify', async () => {
  const { deps, rec } = makeDeps({ matchScores: { authority: { score: 0.9 }, ownership: { score: 0.8 } } });
  const result = await runProspectResearch('p1', deps);

  assert.deepEqual(rec.researched, [['authority', 'ownership']], 'account dim ignored');
  assert.ok(Math.abs(result.personaScore - 85) < 1e-6);
  assert.equal(rec.savedScore?.personaScore.toFixed(0), '85');
  assert.equal(result.hardExcluded, false);
  assert.deepEqual(rec.qualified, ['p1'], 'chains qualification');
});

test('hard exclusion on a persona dim propagates to the prospect score', async () => {
  const { deps, rec } = makeDeps({ matchScores: { authority: { score: 1 }, ownership: { score: 1, hardExclusion: true } } });
  const result = await runProspectResearch('p1', deps);
  assert.equal(result.hardExcluded, true);
  assert.equal(rec.savedScore?.hardExcluded, true);
});

test('missing prospect throws', async () => {
  const { deps } = makeDeps({});
  await assert.rejects(() => runProspectResearch('missing', { ...deps, getProspectById: async () => null }), /Prospect not found/);
});

test('cascade researches the account (once, non-recursively) when it is unresearched', async () => {
  const { deps } = makeDeps({});
  const calls: Array<{ id: string; cascade: boolean }> = [];
  await runProspectResearch('p1', {
    ...deps,
    cascade: true,
    getAccountForProspect: async () => ({ id: 'acct-1', name: 'Acme' }),
    accountHasResearch: async () => false,
    researchAccount: async (id, opts) => { calls.push({ id, cascade: opts.cascade }); },
  });
  assert.deepEqual(calls, [{ id: 'acct-1', cascade: false }], 'researches the account with cascade off (loop-safe)');
});

test('cascade skips the account when it has already been researched', async () => {
  const { deps } = makeDeps({});
  let called = false;
  await runProspectResearch('p1', {
    ...deps,
    cascade: true,
    getAccountForProspect: async () => ({ id: 'acct-1', name: 'Acme' }),
    accountHasResearch: async () => true,
    researchAccount: async () => { called = true; },
  });
  assert.equal(called, false, 'no redundant account research');
});
