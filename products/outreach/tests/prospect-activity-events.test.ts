process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? 'redis://localhost:6380';
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? 'outreach_test';

/**
 * `prospect.replied` rides the activity choke point: every path that records a
 * reply (the activities POST route today, an inbox later) writes through
 * `createProspectActivity`.
 */
import assert from 'node:assert/strict';
import nodeTest, { after, before } from 'node:test';
import { randomUUID } from 'node:crypto';
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
import type { ProductEventInsert } from '@content-automation/platform/events/repository';
import {
  createProspect,
  createProspectActivity,
  createOutreachMessage,
  drainTouchpointWrites,
  getProspectActivities,
  updateProspect,
  updateOutreachMessage,
} from '../data/prospect-repository';

const ORGANIZATION_ID = `outreach-activity-events-${process.pid}`;

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
  setProductEventSinkForTests(null);
  await clearGraph();
  await closeDriver();
  // Contact-type touchpoints in these tests auto-create follow-up action
  // items in Postgres; remove them so reruns start clean.
  await drainTouchpointWrites();
  await getJobAdminPool()
    .query('DELETE FROM action_items WHERE organization_id = $1', [ORGANIZATION_ID])
    .catch(() => undefined);
  await closeJobPools();
}));

test('recording a reply_received activity emits prospect.replied, other activity types do not', async () => {
  const recorded: ProductEventInsert[] = [];
  setProductEventSinkForTests(async (event) => {
    recorded.push(event);
    return { id: randomUUID() };
  });
  try {
    const prospect = await createProspect({ name: 'Ada Lovelace', company: 'Analytical', source: 'manual' });
    await drainProductEvents();
    recorded.length = 0; // This test isolates activity events from prospect.created.

    await createProspectActivity(prospect.id, { type: 'call', title: 'Intro call' });
    await drainProductEvents();
    assert.equal(recorded.length, 0, 'only replies emit prospect.replied');

    await createProspectActivity(prospect.id, { type: 'reply_received', title: 'Replied to InMail' });
    await drainProductEvents();
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].name, 'prospect.replied');
    assert.equal(recorded[0].organizationId, ORGANIZATION_ID);
    assert.equal(recorded[0].prospectId, prospect.id);
    assert.deepEqual(recorded[0].payload, { prospectId: prospect.id });
  } finally {
    setProductEventSinkForTests(null);
  }
});

test('marking outreach sent records one durable prospect activity', async () => {
  const prospect = await createProspect({ name: 'Grace Hopper', company: 'Navy', source: 'manual' });
  const message = await createOutreachMessage({
    prospectId: prospect.id,
    medium: 'email',
    subject: 'Technical review',
    content: 'Would Tuesday work for a technical review?',
  });

  await updateOutreachMessage(message.id, { status: 'sent' });
  await updateOutreachMessage(message.id, { status: 'sent' });

  const activities = await getProspectActivities(prospect.id);
  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.type, 'outreach_sent');
  assert.equal(activities[0]?.title, 'Sent: Technical review');
  assert.equal(activities[0]?.notes, 'Would Tuesday work for a technical review?');
  assert.equal(activities[0]?.metadata?.outreachMessageId, message.id);
});

test('changing prospect status records the transition once', async () => {
  const prospect = await createProspect({ name: 'Katherine Johnson', company: 'NASA', source: 'manual' });
  await updateProspect(prospect.id, { status: 'qualified' });
  await updateProspect(prospect.id, { status: 'qualified' });

  const activities = await getProspectActivities(prospect.id);
  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.type, 'status_change');
  assert.equal(activities[0]?.title, 'Status changed to qualified');
  assert.equal(activities[0]?.notes, 'Moved from new to qualified');
});
