import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { recordProductEvent } from '../events/emit';
import { closeJobPools, getJobAdminPool } from '../jobs/pool';
import {
  getNotificationPreferences,
  listUserNotifications,
  setNotificationPreferences,
  setNotificationRecipientStatus,
} from '../intelligence/repository';

const suffix = randomUUID().replaceAll('-', '');
const organizationId = `notify_test_${suffix}`;
const userId = `notify_user_${suffix}`;

before(async () => {
  const pool = getJobAdminPool();
  await pool.query(
    `INSERT INTO organization(id, name, slug, "createdAt") VALUES($1, $2, $3, NOW())`,
    [organizationId, 'Notification Test', organizationId],
  );
  await pool.query(
    `INSERT INTO "user"(id, name, email, "emailVerified") VALUES($1, $2, $3, TRUE)`,
    [userId, 'Notification Test User', `${suffix}@notifications.test`],
  );
  await pool.query(
    `INSERT INTO member(id, "organizationId", "userId", role, "createdAt")
     VALUES($1, $2, $3, 'owner', NOW())`,
    [`notify_member_${suffix}`, organizationId, userId],
  );
});

after(async () => {
  const pool = getJobAdminPool();
  await pool.query('DELETE FROM product_events WHERE organization_id = $1', [organizationId])
    .catch(() => undefined);
  await pool.query('DELETE FROM organization WHERE id = $1', [organizationId])
    .catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE id = $1', [userId])
    .catch(() => undefined);
  await closeJobPools();
});

test('external notifications are durable, idempotent, per-user, and preference-aware', async () => {
  await setNotificationPreferences({
    organizationId,
    userId,
    preferences: [
      { category: '*', enabled: true },
      { category: 'prospects', enabled: true },
      { category: 'content_insights', enabled: false },
    ],
  });
  const preferences = await getNotificationPreferences(
    organizationId,
    userId,
    ['prospects', 'content_insights'],
  );
  assert.equal(preferences.find(({ category }) => category === 'prospects')?.enabled, true);
  assert.equal(preferences.find(({ category }) => category === 'content_insights')?.enabled, false);

  await setNotificationPreferences({
    organizationId,
    userId,
    preferences: [{ category: '*', enabled: false }],
  });
  const masterOff = await getNotificationPreferences(
    organizationId,
    userId,
    ['prospects', 'content_insights'],
  );
  assert.equal(masterOff.find(({ category }) => category === '*')?.enabled, false);
  assert.equal(masterOff.find(({ category }) => category === 'prospects')?.enabled, true);
  assert.equal(masterOff.find(({ category }) => category === 'content_insights')?.enabled, false);
  await setNotificationPreferences({
    organizationId,
    userId,
    preferences: [{ category: '*', enabled: true }],
  });

  const input = {
    organizationId,
    name: 'prospect.created',
    origin: 'external_connector' as const,
    connectorId: 'test-connector',
    externalEventId: 'delivery-1',
    refs: { prospectId: 'prospect-1' },
    payload: { name: 'Aisha', company: 'Northstar' },
  };
  const first = await recordProductEvent(input);
  const duplicate = await recordProductEvent(input);
  assert.equal(first.created, true);
  assert.deepEqual(duplicate, { id: first.id, created: false });

  const inbox = await listUserNotifications(organizationId, userId, { statuses: ['unread'] });
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0]?.eventId, first.id);
  assert.equal(inbox[0]?.category, 'prospects');

  const seen = await setNotificationRecipientStatus(
    organizationId,
    userId,
    inbox[0]!.id,
    'seen',
  );
  assert.equal(seen?.recipientStatus, 'seen');
  assert.equal(
    (await listUserNotifications(organizationId, userId, { statuses: ['unread'] })).length,
    0,
  );

  await recordProductEvent({
    organizationId,
    name: 'prospect.created',
    refs: { prospectId: 'prospect-from-ui' },
    payload: { name: 'Quiet UI prospect' },
  });
  await recordProductEvent({
    organizationId,
    name: 'content.angle.emerged',
    origin: 'external_connector',
    connectorId: 'test-connector',
    externalEventId: 'delivery-2',
    refs: { contentId: 'angle-1' },
    payload: { title: 'Quiet angle', summary: 'The user disabled this category.' },
  });

  const counts = (await getJobAdminPool().query(
    `SELECT
       (SELECT count(*)::int FROM product_events WHERE organization_id = $1) AS events,
       (SELECT count(*)::int FROM attention_items WHERE organization_id = $1) AS attention,
       (SELECT count(*)::int FROM notification_recipients WHERE organization_id = $1) AS recipients,
       (SELECT count(*)::int FROM product_event_projections WHERE organization_id = $1) AS projections`,
    [organizationId],
  )).rows[0];
  assert.deepEqual(counts, { events: 3, attention: 1, recipients: 1, projections: 2 });
});
