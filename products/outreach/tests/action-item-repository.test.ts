import assert from 'node:assert/strict';
import nodeTest, { after } from 'node:test';
import { runWithGraphOrganization } from '@content-automation/platform/data/graph';
import { closeJobPools, getJobAdminPool } from '@content-automation/platform/jobs/pool';
import {
  completeActionItem,
  createActionItem,
  deleteActionItem,
  dismissOpenGeneratedFollowUpForMessage,
  dismissActionItem,
  ensureGeneratedFollowUp,
  ensureFollowUpForProspect,
  getOpenActionItemsForProspects,
  listOpenActionItems,
  updateActionItem,
} from '../data/action-item-repository';
import { FOLLOW_UP_DEFAULT_DAYS } from '../domain/action-items';

const ORGANIZATION_ID = `action-items-test-${process.pid}`;

function test(name: string, body: () => void | Promise<void>) {
  return nodeTest(name, () => runWithGraphOrganization(ORGANIZATION_ID, body));
}

after(async () => {
  await getJobAdminPool()
    .query('DELETE FROM action_items WHERE organization_id = $1', [ORGANIZATION_ID])
    .catch(() => undefined);
  await closeJobPools();
});

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

test('lifecycle: create → snooze → complete', async () => {
  const item = await createActionItem({ title: 'Send intro note', dueAt: inDays(1), prospectId: 'p-1' });
  assert.equal(item.status, 'open');
  assert.equal(item.source, 'manual');
  assert.equal(item.prospectId, 'p-1');

  const snoozed = await updateActionItem(item.id, { dueAt: inDays(4) });
  assert.ok(snoozed && new Date(snoozed.dueAt) > new Date(item.dueAt));

  const done = await completeActionItem(item.id);
  assert.equal(done?.status, 'done');
  assert.ok(done?.completedAt);
});

test('dismiss and delete', async () => {
  const item = await createActionItem({ title: 'Old task', dueAt: inDays(0) });
  const dismissed = await dismissActionItem(item.id);
  assert.equal(dismissed?.status, 'dismissed');
  assert.equal(await deleteActionItem(item.id), true);
  assert.equal(await deleteActionItem(item.id), false);
});

test('listOpenActionItems orders by due date and honors dueBefore', async () => {
  const later = await createActionItem({ title: 'Later', dueAt: inDays(6) });
  const sooner = await createActionItem({ title: 'Sooner', dueAt: inDays(-2) });
  const all = await listOpenActionItems();
  const ids = all.map((entry) => entry.id);
  assert.ok(ids.indexOf(sooner.id) < ids.indexOf(later.id));

  const dueSoon = await listOpenActionItems({ dueBefore: inDays(1) });
  assert.ok(dueSoon.some((entry) => entry.id === sooner.id));
  assert.ok(!dueSoon.some((entry) => entry.id === later.id));
});

test('getOpenActionItemsForProspects groups by prospect', async () => {
  const a = await createActionItem({ title: 'A', dueAt: inDays(1), prospectId: 'p-group-a' });
  await createActionItem({ title: 'B', dueAt: inDays(2), prospectId: 'p-group-b' });
  const grouped = await getOpenActionItemsForProspects(['p-group-a', 'p-group-b', 'p-none']);
  assert.equal(grouped.get('p-group-a')?.[0]?.id, a.id);
  assert.equal(grouped.get('p-group-b')?.length, 1);
  assert.equal(grouped.get('p-none'), undefined);
});

test('ensureFollowUpForProspect creates once, +3 days, and never duplicates', async () => {
  await ensureFollowUpForProspect('p-auto', 'Ada Lovelace');
  await ensureFollowUpForProspect('p-auto', 'Ada Lovelace');
  const grouped = await getOpenActionItemsForProspects(['p-auto']);
  const items = grouped.get('p-auto') ?? [];
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Follow up with Ada Lovelace');
  assert.equal(items[0].source, 'auto_followup');
  const expected = Date.now() + FOLLOW_UP_DEFAULT_DAYS * 86_400_000;
  assert.ok(Math.abs(new Date(items[0].dueAt).getTime() - expected) < 60_000);
});

test('ensureFollowUpForProspect preserves manual items and creates the automatic chain beside them', async () => {
  await createActionItem({ title: 'Deliberate plan', dueAt: inDays(10), prospectId: 'p-manual' });
  await ensureFollowUpForProspect('p-manual', 'Grace Hopper');
  const grouped = await getOpenActionItemsForProspects(['p-manual']);
  const items = grouped.get('p-manual') ?? [];
  assert.equal(items.length, 2);
  assert.ok(items.some((item) => item.title === 'Deliberate plan' && item.source === 'manual'));
  assert.ok(items.some((item) => item.title === 'Follow up with Grace Hopper' && item.source === 'auto_followup'));
});

test('a deleted generated draft dismisses only its open automatic follow-up', async () => {
  const prospectId = `deleted-prospect-${process.pid}`;
  const messageId = `deleted-message-${process.pid}`;
  const generated = await ensureGeneratedFollowUp({
    prospectId,
    prospectName: 'Deleted Draft Prospect',
    messageId,
    medium: 'email',
    generationType: 'initial',
  });
  const manual = await createActionItem({
    title: 'Keep this manual task',
    dueAt: inDays(2),
    prospectId,
  });

  await dismissOpenGeneratedFollowUpForMessage(messageId);

  const open = await listOpenActionItems();
  assert.ok(!open.some(({ id }) => id === generated.id));
  assert.ok(open.some(({ id }) => id === manual.id));
});
