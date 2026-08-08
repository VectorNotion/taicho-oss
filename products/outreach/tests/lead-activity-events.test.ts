process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? 'redis://localhost:6380';
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? 'outreach_test';

/**
 * `lead.replied` rides the activity choke point: every path that records a
 * reply (the activities POST route today, an inbox later) writes through
 * `createLeadActivity`.
 */
import assert from 'node:assert/strict';
import nodeTest, { after, before } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from '@content-automation/platform/data/graph';
import {
  drainProductEvents,
  setProductEventSinkForTests,
} from '@content-automation/platform/events/emit';
import type { ProductEventInsert } from '@content-automation/platform/events/repository';
import {
  createLead,
  createLeadActivity,
  createOutreachMessage,
  getLeadActivities,
  updateLead,
  updateOutreachMessage,
} from '../data/lead-repository';

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
}));

test('recording a reply_received activity emits lead.replied, other activity types do not', async () => {
  const recorded: ProductEventInsert[] = [];
  setProductEventSinkForTests(async (event) => {
    recorded.push(event);
    return { id: randomUUID() };
  });
  try {
    const lead = await createLead({ name: 'Ada Lovelace', company: 'Analytical', source: 'manual' });
    await drainProductEvents();
    recorded.length = 0; // This test isolates activity events from lead.created.

    await createLeadActivity(lead.id, { type: 'call', title: 'Intro call' });
    await drainProductEvents();
    assert.equal(recorded.length, 0, 'only replies emit lead.replied');

    await createLeadActivity(lead.id, { type: 'reply_received', title: 'Replied to InMail' });
    await drainProductEvents();
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].name, 'lead.replied');
    assert.equal(recorded[0].organizationId, ORGANIZATION_ID);
    assert.equal(recorded[0].leadId, lead.id);
    assert.deepEqual(recorded[0].payload, { leadId: lead.id });
  } finally {
    setProductEventSinkForTests(null);
  }
});

test('marking outreach sent records one durable lead activity', async () => {
  const lead = await createLead({ name: 'Grace Hopper', company: 'Navy', source: 'manual' });
  const message = await createOutreachMessage({
    leadId: lead.id,
    medium: 'email',
    subject: 'Technical review',
    content: 'Would Tuesday work for a technical review?',
  });

  await updateOutreachMessage(message.id, { status: 'sent' });
  await updateOutreachMessage(message.id, { status: 'sent' });

  const activities = await getLeadActivities(lead.id);
  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.type, 'outreach_sent');
  assert.equal(activities[0]?.title, 'Sent: Technical review');
  assert.equal(activities[0]?.notes, 'Would Tuesday work for a technical review?');
  assert.equal(activities[0]?.metadata?.outreachMessageId, message.id);
});

test('changing lead status records the transition once', async () => {
  const lead = await createLead({ name: 'Katherine Johnson', company: 'NASA', source: 'manual' });
  await updateLead(lead.id, { status: 'qualified' });
  await updateLead(lead.id, { status: 'qualified' });

  const activities = await getLeadActivities(lead.id);
  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.type, 'status_change');
  assert.equal(activities[0]?.title, 'Status changed to qualified');
  assert.equal(activities[0]?.notes, 'Moved from new to qualified');
});
