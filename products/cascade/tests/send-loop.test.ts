import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";
import { LogMailer } from "../engine/mailer";
import type { Mailer, OutgoingEmail } from "../engine/mailer";
import { runSendLoop } from "../engine/send-loop";
import { runTick } from "../engine/tick";
import { publicUrl } from "../engine/compose";
import {
  checkDeliveryProvider,
  configureDeliveryDomain,
  configureDeliveryProvider,
  createSenderIdentity,
  resolveDefaultDeliveryConfiguration,
  setDefaultDelivery,
} from "../data/delivery-settings-repository";
import type { DeliveryProviderClient } from "../delivery/provider-client";

async function seedQueuedSend(pool: any, email = "s@example.com") {
  const { funnel } = await createFunnel(pool, {
    name: `f-${email}`,
    steps: [{ type: "email", config: { subject: "hi", body: `visit <a href="https://example.com/page">the page</a> now` } }],
  });
  const contact = await createContact(pool, { email });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);
  await runTick(pool);
  return { funnel, contact, enrollment };
}

test("send loop composes, sends, and finalizes a queued send", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { enrollment } = await seedQueuedSend(pool);

  const res = await runSendLoop(pool, mailer);
  assert.deepEqual([res.sent, res.failed, res.skipped], [1, 0, 0]);
  assert.equal(mailer.sent.length, 1);
  assert.ok(mailer.sent[0].html.includes(`${publicUrl()}/c/`), "links rewritten before transport");
  assert.ok(mailer.sent[0].headers["List-Unsubscribe-Post"]);

  const send = await pool.query(`SELECT status, provider_message_id FROM sends WHERE enrollment_id = $1`, [
    enrollment.id,
  ]);
  assert.equal(send.rows[0].status, "sent");
  assert.ok(send.rows[0].provider_message_id);
});

test("unsubscribe between enqueue and transport skips the send", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { contact, enrollment } = await seedQueuedSend(pool, "late-unsub@example.com");
  await pool.query(`UPDATE contacts SET subscription_status = 'unsubscribed' WHERE id = $1`, [contact.id]);

  const res = await runSendLoop(pool, mailer);
  assert.deepEqual([res.sent, res.skipped], [0, 1]);
  assert.equal(mailer.sent.length, 0);
  const send = await pool.query(`SELECT status FROM sends WHERE enrollment_id = $1`, [enrollment.id]);
  assert.equal(send.rows[0].status, "skipped");
});

test("transport failures retry up to 5 attempts then fail", async () => {
  const pool = await freshSchema();
  const failing: Mailer = {
    async send(_e: OutgoingEmail) {
      throw new Error("provider down");
    },
  };
  const { enrollment } = await seedQueuedSend(pool, "fail@example.com");

  for (let i = 0; i < 5; i++) await runSendLoop(pool, failing);

  const send = await pool.query(`SELECT status, attempts FROM sends WHERE enrollment_id = $1`, [enrollment.id]);
  assert.equal(send.rows[0].status, "failed");
  assert.equal(send.rows[0].attempts, 5);
  const events = await pool.query(`SELECT count(*)::int AS n FROM events WHERE enrollment_id = $1`, [enrollment.id]);
  assert.equal(events.rows[0].n, 0);
});

test("send loop applies the workspace-configured provider and verified sender", async () => {
  const pool = await freshSchema();
  const provider = await configureDeliveryProvider(pool, {
    provider: "resend",
    apiKey: "re_workspace_key",
  });
  const providerClient: DeliveryProviderClient = {
    async checkConnection() {},
    async configureDomain() {
      return { providerDomainId: "domain-1", status: "verified" };
    },
    async checkDomain() {
      return { providerDomainId: "domain-1", status: "verified" };
    },
  };
  await configureDeliveryDomain(
    pool,
    {
      providerConnectionId: provider.id,
      domain: "mail.example.com",
    },
    { client: providerClient },
  );
  const sender = await createSenderIdentity(pool, {
    providerConnectionId: provider.id,
    name: "Workspace Sender",
    email: "hello@mail.example.com",
  });
  await checkDeliveryProvider(pool, provider.id, { client: providerClient });
  await setDefaultDelivery(pool, {
    providerConnectionId: provider.id,
    senderIdentityId: sender.id,
  });
  const configured = await resolveDefaultDeliveryConfiguration(pool);
  assert.ok(configured);

  const { enrollment } = await seedQueuedSend(
    pool,
    "configured-sender@example.com",
  );
  const mailer = new LogMailer();
  const result = await runSendLoop(pool, mailer, {
    providerConnectionId: configured.providerConnectionId,
    sender: configured.sender,
  });

  assert.equal(result.sent, 1);
  assert.equal(
    mailer.sent[0].from,
    "Workspace Sender <hello@mail.example.com>",
  );
  const send = await pool.query(
    `SELECT delivery_provider_id,sender_identity_id
       FROM sends WHERE enrollment_id=$1`,
    [enrollment.id],
  );
  assert.deepEqual(send.rows[0], {
    delivery_provider_id: provider.id,
    sender_identity_id: sender.id,
  });
});
