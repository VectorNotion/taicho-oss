process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? 'redis://localhost:6380';
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? 'outreach_test';

/**
 * Touchpoints (spec 2026-08-10): marking outreach sent or logging a
 * contact-type activity stamps `lastContactedAt` on the prospect and
 * auto-creates a follow-up action item when none is open.
 */
import assert from 'node:assert/strict';
import nodeTest, { after, before } from 'node:test';
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from '@content-automation/platform/data/graph';
import { closeJobPools, getJobAdminPool } from '@content-automation/platform/jobs/pool';
import {
  drainProductEvents,
  setProductEventSinkForTests,
} from '@content-automation/platform/events/emit';
import {
  createOutreachMessage,
  createProspect,
  createProspectActivity,
  drainTouchpointWrites,
  getProspectById,
  updateOutreachMessage,
} from '../data/prospect-repository';
import { getOpenActionItemsForProspects } from '../data/action-item-repository';

const ORGANIZATION_ID = `touchpoints-test-${process.pid}`;

function test(name: string, body: () => void | Promise<void>) {
  return nodeTest(name, () => runWithGraphOrganization(ORGANIZATION_ID, body));
}

async function clearGraph() {
  const session = await getSession();
  try { await session.run('MATCH (n) DETACH DELETE n'); }
  finally { await session.close(); }
}

before(() => runWithGraphOrganization(ORGANIZATION_ID, async () => {
  // These tests exercise touchpoints, not the event spine — swallow the
  // prospect.created/outreach.sent emits instead of writing product_events.
  setProductEventSinkForTests(async () => ({ id: 'sink' }));
  await clearGraph();
}));
after(async () => {
  await drainProductEvents();
  setProductEventSinkForTests(null);
  await runWithGraphOrganization(ORGANIZATION_ID, clearGraph);
  await getJobAdminPool()
    .query('DELETE FROM action_items WHERE organization_id = $1', [ORGANIZATION_ID])
    .catch(() => undefined);
  await closeDriver();
  await closeJobPools();
});

test('marking outreach sent sets lastContactedAt and creates the auto follow-up', async () => {
  const prospect = await createProspect({ name: 'Ada Lovelace', company: 'Analytical', source: 'manual' });
  assert.equal(prospect.lastContactedAt, undefined);
  const message = await createOutreachMessage({
    prospectId: prospect.id, medium: 'email', subject: 'Hello', content: 'Hi there',
  });

  await updateOutreachMessage(message.id, { status: 'sent' });
  await drainTouchpointWrites();

  const updated = await getProspectById(prospect.id);
  assert.ok(updated?.lastContactedAt, 'lastContactedAt set on send');

  const items = (await getOpenActionItemsForProspects([prospect.id])).get(prospect.id) ?? [];
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'auto_followup');
  assert.equal(items[0].title, 'Follow up with Ada Lovelace');
});

test('contact-type activity sets lastContactedAt; non-contact types do not', async () => {
  const prospect = await createProspect({ name: 'Grace Hopper', company: 'Navy', source: 'manual' });

  await createProspectActivity(prospect.id, { type: 'note', title: 'Background reading' });
  await drainTouchpointWrites();
  assert.equal((await getProspectById(prospect.id))?.lastContactedAt, undefined);

  await createProspectActivity(prospect.id, { type: 'call', title: 'Intro call' });
  await drainTouchpointWrites();
  assert.ok((await getProspectById(prospect.id))?.lastContactedAt);

  const items = (await getOpenActionItemsForProspects([prospect.id])).get(prospect.id) ?? [];
  assert.equal(items.length, 1, 'contact activity triggered the auto follow-up');
});
