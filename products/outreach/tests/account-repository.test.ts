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
import {
  getAccountById,
  getAccountCounts,
  getAccountDetail,
  getAccountProspects,
  getAccountsPage,
  normalizeCompanyName,
  resolveAccountForProspect,
} from '../data/account-repository';
import {
  saveAccountScore,
  saveMatches,
  saveProspectQualification,
  saveProspectScore,
  upsertObservation,
} from '../data/qualification-repository';
import type { ProspectQualificationResult } from '../domain/qualification';

const ORGANIZATION_ID = `outreach-account-test-organization-${process.pid}`;

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

test('normalizeCompanyName trims, lowercases and collapses whitespace', () => {
  assert.equal(normalizeCompanyName('  Acme   Corp '), 'acme corp');
  assert.equal(normalizeCompanyName('ACME CORP'), 'acme corp');
});

test('resolveAccountForProspect MERGEs one account per normalized company and links prospects', async () => {
  const prospect1 = await createProspect({ name: 'Jane Smith', company: 'Acme Corp', source: 'manual' });
  const prospect2 = await createProspect({ name: 'John Roe', company: '  ACME  Corp ', source: 'manual' });

  const account1 = await resolveAccountForProspect(prospect1);
  const account2 = await resolveAccountForProspect(prospect2);

  assert.ok(account1);
  assert.equal(account1.name, 'Acme Corp');
  assert.equal(account1.normalizedName, 'acme corp');
  assert.equal(account2?.id, account1.id, 'same normalized company → same account');

  const prospects = await getAccountProspects(account1.id);
  assert.deepEqual(prospects.sort(), [prospect1.id, prospect2.id].sort());

  const fetched = await getAccountById(account1.id);
  assert.equal(fetched?.normalizedName, 'acme corp');
});

test('resolveAccountForProspect returns null without a company', async () => {
  const prospect = await createProspect({ name: 'No Company', source: 'manual' });
  assert.equal(await resolveAccountForProspect(prospect), null);
  assert.equal(await resolveAccountForProspect({ id: 'x', company: '   ' }), null);
});

test('resolving repeatedly is idempotent (one BELONGS_TO edge)', async () => {
  const prospect = await createProspect({ name: 'Repeat', company: 'Repeat Co', source: 'manual' });
  await resolveAccountForProspect(prospect);
  const account = await resolveAccountForProspect(prospect);
  assert.ok(account);

  const session = await getSession();
  try {
    const result = await session.run(
      `MATCH (l:Prospect {id: $prospectId})-[r:BELONGS_TO]->(a:Account {id: $accountId}) RETURN count(r) AS edges`,
      { prospectId: prospect.id, accountId: account.id },
    );
    assert.equal(result.records[0].get('edges').toNumber(), 1);
  } finally {
    await session.close();
  }
});

function qualification(partial: Partial<ProspectQualificationResult>): ProspectQualificationResult {
  return {
    status: 'QUALIFIED', icpScore: 90, personaScore: 80, timingScore: 40,
    icpMatches: [], personaMatches: [], timingBreakdown: [],
    computedAt: '2026-08-10T00:00:00.000Z', ...partial,
  };
}

test('account rollup: list, counts and detail reflect account scores and prospects', async () => {
  await clearGraph();
  // Target account: research wrote its ICP/timing score; one prospect qualified.
  const hot = await createProspect({ name: 'Hot Lead', company: 'Northstar', title: 'COO', source: 'manual' });
  const cold = await createProspect({ name: 'Cold Lead', company: 'Northstar', source: 'manual' });
  const northstar = await resolveAccountForProspect(hot);
  await resolveAccountForProspect(cold);
  assert.ok(northstar);
  await saveAccountScore(northstar.id, {
    icpScore: 82, icpScoreConfident: 82, timingScore: 60, hardExcluded: false,
    timingBreakdown: [{ dimensionKey: 'hiring_activity', dimensionValue: 0.6, signalCount: 2 }],
    computedAt: '2026-08-10T00:00:00.000Z',
  });
  await upsertObservation({ kind: 'account', id: northstar.id }, {
    dimensionKey: 'internal_ai_capability', shape: 'prose', observedValue: 'No AI team.',
    evidence: ['https://ex.test/a'], confidence: 0.9, researchedAt: '2026-08-10T00:00:00.000Z', runId: 'r1',
  });
  await upsertObservation({ kind: 'account', id: northstar.id }, {
    dimensionKey: 'hiring_activity', shape: 'signals',
    signals: [{ signal: 'Posted 2 AE roles', date: '2026-08-01', evidence: ['https://ex.test/j'], confidence: 0.9 }],
    evidence: ['https://ex.test/j'], confidence: 0.9, researchedAt: '2026-08-10T00:00:00.000Z', runId: 'r1',
  });
  await saveMatches({ kind: 'account', id: northstar.id }, [
    { dimensionKey: 'internal_ai_capability', matchScore: 0.9, effectiveMatch: 0.81, classification: 'strong_match', hardExclusion: false, confidence: 0.9 },
  ]);
  await saveProspectScore(hot.id, { personaScore: 91, personaScoreConfident: 91, hardExcluded: false, computedAt: '2026-08-10T00:00:00.000Z' });
  await saveProspectQualification(hot.id, qualification({ icpScore: 82, personaScore: 91, timingScore: 60, status: 'QUALIFIED' }));

  // A second account with no score at all.
  const other = await createProspect({ name: 'Nobody', company: 'Quietco', source: 'manual' });
  await resolveAccountForProspect(other);

  const counts = await getAccountCounts();
  assert.equal(counts.total, 2);
  assert.equal(counts.targets, 1, 'Northstar ICP 82 ≥ 70');
  assert.equal(counts.qualified, 1);
  assert.equal(counts.warm, 1, 'Northstar timing 60 > 0');

  const page = await getAccountsPage({}, { page: 1, pageSize: 10 });
  assert.equal(page.total, 2);
  const northstarRow = page.accounts.find((a) => a.name === 'Northstar');
  assert.ok(northstarRow);
  assert.equal(northstarRow.prospectCount, 2);
  assert.equal(northstarRow.qualifiedCount, 1);
  assert.equal(northstarRow.icpScore, 82);
  assert.equal(northstarRow.isTarget, true);
  const quietRow = page.accounts.find((a) => a.name === 'Quietco');
  assert.equal(quietRow?.icpScore, null, 'no account score → null');
  assert.equal(quietRow?.isTarget, false);

  // Segment filters.
  assert.equal((await getAccountsPage({ segment: 'targets' }, { page: 1, pageSize: 10 })).total, 1);
  assert.equal((await getAccountsPage({ segment: 'qualified' }, { page: 1, pageSize: 10 })).total, 1);
  assert.deepEqual(
    (await getAccountsPage({ search: 'quiet' }, { page: 1, pageSize: 10 })).accounts.map((a) => a.name),
    ['Quietco'],
  );

  const detail = await getAccountDetail(northstar.id);
  assert.ok(detail);
  assert.equal(detail.name, 'Northstar');
  assert.equal(detail.icpScore, 82);
  assert.equal(detail.timingScore, 60);
  // Observations + evidence surfaced (spec §17 "what we found").
  const aiObs = detail.icpObservations.find((o) => o.dimensionKey === 'internal_ai_capability');
  assert.equal(aiObs?.observedValue, 'No AI team.');
  assert.deepEqual(aiObs?.evidence, ['https://ex.test/a']);
  assert.equal(aiObs?.matchScore, 0.9, 'observation joined with its match');
  const hiring = detail.timingSignals.find((t) => t.dimensionKey === 'hiring_activity');
  assert.equal(hiring?.signals.length, 1);
  assert.equal(hiring?.signals[0].date, '2026-08-01');
  assert.equal(hiring?.dimensionValue, 0.6, 'timing signal joined with decayed value');
  assert.equal(detail.prospects.length, 2);
  const hotRow = detail.prospects.find((p) => p.id === hot.id);
  assert.equal(hotRow?.personaScore, 91);
  assert.equal(hotRow?.qualificationStatus, 'QUALIFIED');
  const coldRow = detail.prospects.find((p) => p.id === cold.id);
  assert.equal(coldRow?.personaScore, null);
});

test('accounts sort by ICP, timing, prospects, qualified and name', async () => {
  await clearGraph();
  // Alpha: ICP 90, timing 10, 1 prospect (qualified).
  const a = await createProspect({ name: 'A person', company: 'Alpha', source: 'manual' });
  const alpha = await resolveAccountForProspect(a);
  assert.ok(alpha);
  await saveAccountScore(alpha.id, { icpScore: 90, icpScoreConfident: 90, timingScore: 10, hardExcluded: false, timingBreakdown: [], computedAt: '2026-08-10T00:00:00.000Z' });
  await saveProspectQualification(a.id, qualification({ status: 'QUALIFIED' }));
  // Beta: ICP 60, timing 95, 2 prospects (0 qualified).
  const b1 = await createProspect({ name: 'B one', company: 'Beta', source: 'manual' });
  const b2 = await createProspect({ name: 'B two', company: 'Beta', source: 'manual' });
  const beta = await resolveAccountForProspect(b1);
  await resolveAccountForProspect(b2);
  assert.ok(beta);
  await saveAccountScore(beta.id, { icpScore: 60, icpScoreConfident: 60, timingScore: 95, hardExcluded: false, timingBreakdown: [], computedAt: '2026-08-10T00:00:00.000Z' });

  const names = async (sort: 'icp' | 'timing' | 'qualified' | 'prospects' | 'name') =>
    (await getAccountsPage({ sort }, { page: 1, pageSize: 10 })).accounts.map((x) => x.name);

  assert.deepEqual(await names('icp'), ['Alpha', 'Beta'], 'best ICP first');
  assert.deepEqual(await names('timing'), ['Beta', 'Alpha'], 'hottest timing first');
  assert.deepEqual(await names('prospects'), ['Beta', 'Alpha'], 'most prospects first');
  assert.deepEqual(await names('qualified'), ['Alpha', 'Beta'], 'most qualified first');
  assert.deepEqual(await names('name'), ['Alpha', 'Beta'], 'alphabetical');
});
