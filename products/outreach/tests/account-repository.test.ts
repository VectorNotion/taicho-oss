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
import { saveProspectQualification } from '../data/qualification-repository';
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

test('account rollup: list, counts and detail reflect prospects and qualifications', async () => {
  await clearGraph();
  // Target account with a qualified prospect + an unqualified one.
  const hot = await createProspect({ name: 'Hot Lead', company: 'Northstar', title: 'COO', source: 'manual' });
  const cold = await createProspect({ name: 'Cold Lead', company: 'Northstar', source: 'manual' });
  const northstar = await resolveAccountForProspect(hot);
  await resolveAccountForProspect(cold);
  assert.ok(northstar);
  await saveProspectQualification(hot.id, qualification({ icpScore: 82, personaScore: 91, timingScore: 60, status: 'QUALIFIED' }));

  // A second account with no qualification at all.
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
  assert.equal(quietRow?.icpScore, null, 'no qualification → null score');
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
  assert.equal(detail.prospects.length, 2);
  const hotRow = detail.prospects.find((p) => p.id === hot.id);
  assert.equal(hotRow?.personaScore, 91);
  assert.equal(hotRow?.qualificationStatus, 'QUALIFIED');
  const coldRow = detail.prospects.find((p) => p.id === cold.id);
  assert.equal(coldRow?.personaScore, null);
  assert.equal(coldRow?.qualificationStatus, null);
});
