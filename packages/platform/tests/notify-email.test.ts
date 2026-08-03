process.env.CASCADE_SCHEMA = 'cascade_notify_test';
process.env.CASCADE_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closeCascadePools, getCascadePool } from '@/products/cascade/data/pool';
import { dropCascadeSchema, ensureCascadeSchema } from '@/products/cascade/data/schema';
import { connectDeliveryProvider } from '@/products/cascade/data/delivery-settings-repository';
import { resolveWorkspaceDeliveryRuntime } from '@/products/cascade/delivery/runtime';
import { LogMailer, type Mailer, type OutgoingEmail } from '@/products/cascade/engine/mailer';
import type { DeliveryProviderClient, ProviderDomainState } from '@/products/cascade/delivery/provider-client';
import { sendNotificationEmail } from '../notify/email';

const organizationId = 'notify-test-org';

/** Provider stub in the shape of products/cascade/tests/delivery-settings.test.ts. */
class VerifiedStubClient implements DeliveryProviderClient {
  private readonly state: ProviderDomainState = { providerDomainId: 'domain-1', status: 'verified' };
  async checkConnection(): Promise<void> {}
  async configureDomain(): Promise<ProviderDomainState> { return this.state; }
  async checkDomain(): Promise<ProviderDomainState> { return this.state; }
}

/** Scratch-schema reset in the shape of products/cascade/tests/helpers.ts. */
async function freshSchema() {
  const pool = getCascadePool(organizationId);
  await dropCascadeSchema(pool);
  await ensureCascadeSchema(pool);
  return pool;
}

const sender = { id: 'sender-1', name: 'Taicho', email: 'notify@taicho.dev' };

after(async () => { await closeCascadePools(); });

test('an organization without a configured provider degrades to none and never throws', async () => {
  await freshSchema();
  const result = await sendNotificationEmail({
    organizationId, to: 'owner@example.com', subject: 'Hello', text: 'Body',
  });
  assert.deepEqual(result, { delivered: false, provider: 'none' });
});

test('a configured runtime delivers finished HTML through the Cascade mailer', async () => {
  const mailer = new LogMailer();
  const result = await sendNotificationEmail(
    {
      organizationId, to: 'owner@example.com', subject: 'Run finished',
      text: 'First line\n\nSecond & <b>third</b>',
    },
    { resolveRuntime: async () => ({ mailer, provider: 'resend', sender }) },
  );
  assert.deepEqual(result, { delivered: true, provider: 'resend' });
  assert.equal(mailer.sent.length, 1);
  const email = mailer.sent[0];
  assert.equal(email.to, 'owner@example.com');
  assert.equal(email.from, 'Taicho <notify@taicho.dev>');
  assert.equal(email.subject, 'Run finished');
  assert.equal(email.text, 'First line\n\nSecond & <b>third</b>');
  assert.match(email.html, /<p>First line<\/p>/);
  assert.match(email.html, /Second &amp; &lt;b&gt;third&lt;\/b&gt;/);
  assert.doesNotMatch(email.html, /<b>third<\/b>/);
});

test('caller-supplied HTML is passed through untouched', async () => {
  const mailer = new LogMailer();
  await sendNotificationEmail(
    { organizationId, to: 'owner@example.com', subject: 'S', text: 'plain', html: '<p>ready-made</p>' },
    { resolveRuntime: async () => ({ mailer, provider: 'sendgrid', sender }) },
  );
  assert.equal(mailer.sent[0].html, '<p>ready-made</p>');
});

test('transport failures propagate so the flow executor can retry', async () => {
  const failing: Mailer = {
    async send(_email: OutgoingEmail): Promise<{ providerMessageId: string }> {
      throw new Error('provider 500: delivery failed');
    },
  };
  await assert.rejects(
    sendNotificationEmail(
      { organizationId, to: 'owner@example.com', subject: 'S', text: 'T' },
      { resolveRuntime: async () => ({ mailer: failing, provider: 'resend', sender }) },
    ),
    /provider 500/,
  );
});

test('real resolution surfaces the provider name once delivery is configured', async () => {
  const pool = await freshSchema();
  await connectDeliveryProvider(
    pool,
    { provider: 'resend', apiKey: 're_notify_test_key', senderName: 'Taicho', senderEmail: 'notify@taicho.dev' },
    { client: new VerifiedStubClient() },
  );
  const runtime = await resolveWorkspaceDeliveryRuntime(pool);
  assert.equal(runtime.provider, 'resend');
  assert.equal(runtime.sender?.email, 'notify@taicho.dev');
});
