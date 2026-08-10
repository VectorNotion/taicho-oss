process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? 'redis://localhost:6380';
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? 'outreach_test';

import assert from 'node:assert/strict';
import nodeTest, { after, before } from 'node:test';
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from '@content-automation/platform/data/graph';
import { createProspect } from '../data/prospect-repository';
import { resolveAccountForProspect } from '../data/account-repository';
import {
  getAccountScore,
  getMatches,
  getObservations,
  getProspectQualification,
  getProspectScore,
  getTouchList,
  hasAnyResearchRun,
  recordResearchRun,
  saveAccountScore,
  saveMatches,
  saveProspectQualification,
  saveProspectScore,
  upsertObservation,
} from '../data/qualification-repository';
import type {
  DimensionMatch,
  ProspectQualificationResult,
} from '../domain/qualification';

const ORGANIZATION_ID = `outreach-qualification-test-organization-${process.pid}`;

function inOrganization<T>(callback: () => T): T {
  return runWithGraphOrganization(ORGANIZATION_ID, callback);
}

function test(name: string, body: () => void | Promise<void>) {
  return nodeTest(name, () => inOrganization(body));
}

async function clearGraph() {
  const session = await getSession();
  try { await session.run('MATCH (n) DETACH DELETE n'); }
  finally { await session.close(); }
}

before(() => inOrganization(clearGraph));
after(() => inOrganization(async () => {
  await clearGraph();
  await closeDriver();
}));

test('account score round-trips including timing breakdown and replaces on write', async () => {
  const prospect = await createProspect({ name: 'A', company: 'ScoreCo', source: 'manual' });
  const account = await resolveAccountForProspect(prospect);
  assert.ok(account);

  assert.equal(await getAccountScore(account.id), null);
  await saveAccountScore(account.id, {
    icpScore: 82.5, icpScoreConfident: 80, timingScore: 60, hardExcluded: false,
    reviewReason: 'thin evidence',
    timingBreakdown: [{ dimensionKey: 'hiring_activity', dimensionValue: 0.7, signalCount: 3 }],
    computedAt: '2026-08-10T00:00:00.000Z',
  });
  const first = await getAccountScore(account.id);
  assert.equal(first?.icpScore, 82.5);
  assert.equal(first?.icpScoreConfident, 80);
  assert.equal(first?.timingScore, 60);
  assert.equal(first?.hardExcluded, false);
  assert.equal(first?.reviewReason, 'thin evidence');
  assert.deepEqual(first?.timingBreakdown, [{ dimensionKey: 'hiring_activity', dimensionValue: 0.7, signalCount: 3 }]);

  await saveAccountScore(account.id, {
    icpScore: 40, icpScoreConfident: 40, timingScore: 0, hardExcluded: true, timingBreakdown: [],
    computedAt: '2026-08-11T00:00:00.000Z',
  });
  const second = await getAccountScore(account.id);
  assert.equal(second?.icpScore, 40);
  assert.equal(second?.hardExcluded, true);
  assert.equal(second?.reviewReason, undefined);

  // Exactly one score node per account.
  const session = await getSession();
  try {
    const result = await session.run(
      `MATCH (a:Account {id: $id})-[:HAS_SCORE]->(s:AccountScore) RETURN count(s) AS c`,
      { id: account.id },
    );
    assert.equal(result.records[0].get('c').toNumber(), 1);
  } finally {
    await session.close();
  }
});

test('prospect score round-trips and replaces on write', async () => {
  const prospect = await createProspect({ name: 'P', company: 'PScore', source: 'manual' });
  assert.equal(await getProspectScore(prospect.id), null);
  await saveProspectScore(prospect.id, { personaScore: 74, personaScoreConfident: 70, hardExcluded: false, computedAt: '2026-08-10T00:00:00.000Z' });
  assert.equal((await getProspectScore(prospect.id))?.personaScore, 74);
  await saveProspectScore(prospect.id, { personaScore: 11, personaScoreConfident: 11, hardExcluded: true, reviewReason: 'builder conflict', computedAt: '2026-08-11T00:00:00.000Z' });
  const updated = await getProspectScore(prospect.id);
  assert.equal(updated?.personaScore, 11);
  assert.equal(updated?.hardExcluded, true);
  assert.equal(updated?.reviewReason, 'builder conflict');
});

function qualification(partial: Partial<ProspectQualificationResult>): ProspectQualificationResult {
  return {
    status: 'QUALIFIED',
    icpScore: 90,
    personaScore: 80,
    timingScore: 40,
    icpMatches: [],
    personaMatches: [],
    timingBreakdown: [],
    computedAt: '2026-08-10T00:00:00.000Z',
    ...partial,
  };
}

test('observations round-trip both shapes and upsert replaces same-key only', async () => {
  const prospect = await createProspect({ name: 'Obs Prospect', company: 'Obs Co', source: 'manual' });
  const account = await resolveAccountForProspect(prospect);
  assert.ok(account);
  const entity = { kind: 'account' as const, id: account.id };

  const prose = await upsertObservation(entity, {
    dimensionKey: 'internal_ai_capability',
    shape: 'prose',
    observedValue: 'No dedicated AI team identified.',
    evidence: ['https://example.test/jobs'],
    confidence: 0.91,
    researchedAt: '2026-08-01T00:00:00.000Z',
    runId: 'run-1',
  });
  assert.equal(prose.shape, 'prose');
  assert.equal(prose.signals, undefined);

  await upsertObservation(entity, {
    dimensionKey: 'hiring_activity',
    shape: 'signals',
    signals: [
      { signal: 'Posted 3 Sales Manager openings', date: '2026-07-28', evidence: ['https://example.test/j1'], confidence: 0.9 },
      { signal: 'Posted Ops Coordinator opening', date: '2026-05-14', evidence: ['https://example.test/j2'], confidence: 0.85 },
    ],
    evidence: ['https://example.test/j1', 'https://example.test/j2'],
    confidence: 0.9,
    researchedAt: '2026-08-01T00:00:00.000Z',
    runId: 'run-1',
  });

  // Replace the prose observation; the signals one must survive.
  await upsertObservation(entity, {
    dimensionKey: 'internal_ai_capability',
    shape: 'prose',
    observedValue: 'Small AI team of 2 identified.',
    evidence: [],
    confidence: 0.8,
    researchedAt: '2026-08-09T00:00:00.000Z',
    runId: 'run-2',
  });

  const all = await getObservations(entity);
  assert.equal(all.length, 2);
  const ai = all.find((o) => o.dimensionKey === 'internal_ai_capability');
  const hiring = all.find((o) => o.dimensionKey === 'hiring_activity');
  assert.equal(ai?.observedValue, 'Small AI team of 2 identified.');
  assert.equal(ai?.runId, 'run-2');
  assert.equal(hiring?.signals?.length, 2);
  assert.equal(hiring?.signals?.[0].date, '2026-07-28');
  assert.deepEqual(hiring?.evidence, ['https://example.test/j1', 'https://example.test/j2']);
});

test('matches replace-all per entity and round-trip', async () => {
  const prospect = await createProspect({ name: 'Match Prospect', company: 'Match Co', source: 'manual' });
  const entity = { kind: 'prospect' as const, id: prospect.id };

  const first: DimensionMatch[] = [
    { dimensionKey: 'decision_authority', matchScore: 0.94, effectiveMatch: 0.86, classification: 'strong_match', hardExclusion: false, confidence: 0.91 },
  ];
  await saveMatches(entity, first);
  const second: DimensionMatch[] = [
    { dimensionKey: 'decision_authority', matchScore: 0.5, effectiveMatch: 0.4, classification: 'partial_match', hardExclusion: false, confidence: 0.8 },
    { dimensionKey: 'problem_ownership', matchScore: 0.9, effectiveMatch: 0.9, classification: 'strong_match', hardExclusion: true, confidence: 1 },
  ];
  await saveMatches(entity, second);

  const fetched = await getMatches(entity);
  assert.equal(fetched.length, 2);
  assert.deepEqual(fetched, second);
});

test('prospect qualification round-trips including reviewReason', async () => {
  const prospect = await createProspect({ name: 'Qual Prospect', company: 'Qual Co', source: 'manual' });

  assert.equal(await getProspectQualification(prospect.id), null);

  const full = qualification({
    status: 'REVIEW',
    reviewReason: 'low-confidence dimension(s) economic_capacity are decisive',
    icpMatches: [
      { dimensionKey: 'economic_capacity', matchScore: 1, effectiveMatch: 0.45, classification: 'strong_match', hardExclusion: false, confidence: 0.45 },
    ],
    timingBreakdown: [{ dimensionKey: 'hiring_activity', dimensionValue: 0.7, signalCount: 3 }],
  });
  await saveProspectQualification(prospect.id, full);
  const fetched = await getProspectQualification(prospect.id);
  assert.deepEqual(fetched, full);

  // Replacement, and reviewReason clears when absent.
  await saveProspectQualification(prospect.id, qualification({ status: 'QUALIFIED' }));
  const replaced = await getProspectQualification(prospect.id);
  assert.equal(replaced?.status, 'QUALIFIED');
  assert.equal(replaced?.reviewReason, undefined);
});

test('research runs record and detect', async () => {
  const prospect = await createProspect({ name: 'Run Prospect', company: 'Run Co', source: 'manual' });
  const account = await resolveAccountForProspect(prospect);
  assert.ok(account);

  assert.equal(await hasAnyResearchRun(account.id), false);
  const run = await recordResearchRun(account.id, { runType: 'full', refreshedDimensions: ['hiring_activity'] });
  assert.equal(run.runType, 'full');
  assert.deepEqual(run.refreshedDimensions, ['hiring_activity']);
  assert.equal(await hasAnyResearchRun(account.id), true);
});

test('touch list: QUALIFIED only, ordered by timing score desc', async () => {
  await clearGraph();
  const hot = await createProspect({ name: 'Hot', company: 'Hot Co', source: 'manual' });
  const warm = await createProspect({ name: 'Warm', company: 'Warm Co', source: 'manual' });
  const cold = await createProspect({ name: 'Cold', company: 'Cold Co', source: 'manual' });
  const excluded = await createProspect({ name: 'Excluded', company: 'Ex Co', source: 'manual' });

  await saveProspectQualification(hot.id, qualification({ timingScore: 90 }));
  await saveProspectQualification(warm.id, qualification({ timingScore: 50 }));
  await saveProspectQualification(cold.id, qualification({ timingScore: 0 }));
  await saveProspectQualification(excluded.id, qualification({ status: 'HARD_EXCLUDED', timingScore: 99 }));

  const list = await getTouchList(2);
  assert.deepEqual(list.map((entry) => entry.name), ['Hot', 'Warm']);
  assert.equal(list[0].timingScore, 90);

  const all = await getTouchList(25);
  assert.deepEqual(all.map((entry) => entry.name), ['Hot', 'Warm', 'Cold'], 'cold stays in the pool; excluded never enters');
});
