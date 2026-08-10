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
  getAccountProspects,
  normalizeCompanyName,
  resolveAccountForProspect,
} from '../data/account-repository';

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
