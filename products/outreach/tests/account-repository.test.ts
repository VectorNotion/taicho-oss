process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? 'redis://localhost:6380';
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? 'outreach_test';

import assert from 'node:assert/strict';
import nodeTest, { after, before } from 'node:test';
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from '@content-automation/platform/data/graph';
import { createLead } from '../data/lead-repository';
import {
  getAccountById,
  getAccountLeads,
  normalizeCompanyName,
  resolveAccountForLead,
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

test('resolveAccountForLead MERGEs one account per normalized company and links leads', async () => {
  const lead1 = await createLead({ name: 'Jane Smith', company: 'Acme Corp', source: 'manual' });
  const lead2 = await createLead({ name: 'John Roe', company: '  ACME  Corp ', source: 'manual' });

  const account1 = await resolveAccountForLead(lead1);
  const account2 = await resolveAccountForLead(lead2);

  assert.ok(account1);
  assert.equal(account1.name, 'Acme Corp');
  assert.equal(account1.normalizedName, 'acme corp');
  assert.equal(account2?.id, account1.id, 'same normalized company → same account');

  const leads = await getAccountLeads(account1.id);
  assert.deepEqual(leads.sort(), [lead1.id, lead2.id].sort());

  const fetched = await getAccountById(account1.id);
  assert.equal(fetched?.normalizedName, 'acme corp');
});

test('resolveAccountForLead returns null without a company', async () => {
  const lead = await createLead({ name: 'No Company', source: 'manual' });
  assert.equal(await resolveAccountForLead(lead), null);
  assert.equal(await resolveAccountForLead({ id: 'x', company: '   ' }), null);
});

test('resolving repeatedly is idempotent (one BELONGS_TO edge)', async () => {
  const lead = await createLead({ name: 'Repeat', company: 'Repeat Co', source: 'manual' });
  await resolveAccountForLead(lead);
  const account = await resolveAccountForLead(lead);
  assert.ok(account);

  const session = await getSession();
  try {
    const result = await session.run(
      `MATCH (l:Lead {id: $leadId})-[r:BELONGS_TO]->(a:Account {id: $accountId}) RETURN count(r) AS edges`,
      { leadId: lead.id, accountId: account.id },
    );
    assert.equal(result.records[0].get('edges').toNumber(), 1);
  } finally {
    await session.close();
  }
});
