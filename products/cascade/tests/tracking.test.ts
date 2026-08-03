import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test, { after } from "node:test";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";
import { LogMailer } from "../engine/mailer";
import { runSendLoop } from "../engine/send-loop";
import { runTick } from "../engine/tick";
import { createCascadeHttpServer } from "../engine/http";
import { signToken } from "../engine/tokens";
import { signResendWebhook } from "../engine/resend-webhook";
import {
  configureDeliveryProvider,
  deliveryWebhookUrl,
  listDeliverySettings,
} from "../data/delivery-settings-repository";
import { signMailchimpWebhook } from "../engine/mailchimp-webhook";

const previousResendWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
const resendWebhookSecret = `whsec_${Buffer.from("cascade-resend-test-key-material").toString("base64")}`;
process.env.RESEND_WEBHOOK_SECRET = resendWebhookSecret;
after(() => {
  if (previousResendWebhookSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
  else process.env.RESEND_WEBHOOK_SECRET = previousResendWebhookSecret;
});

function signedResendRequest(
  body: string,
  eventId: string,
  timestamp?: string,
) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...signResendWebhook({
        secret: resendWebhookSecret,
        eventId,
        timestamp,
        body,
      }),
    },
    body,
  };
}

async function seedSentEmail(pool: Pool, email: string) {
  const { funnel } = await createFunnel(pool, {
    name: `f-${email}`,
    steps: [{ type: "email", config: { subject: "hi", body: `see <a href="https://example.com/page">it</a>` } }],
  });
  const contact = await createContact(pool, { email });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);
  await runTick(pool);
  const mailer = new LogMailer();
  await runSendLoop(pool, mailer);
  const send = await pool.query(`SELECT id, provider_message_id FROM sends WHERE enrollment_id = $1`, [enrollment.id]);
  return { funnel, contact, enrollment, sendId: send.rows[0].id, providerId: send.rows[0].provider_message_id };
}

async function withServer(pool: Pool, fn: (base: string) => Promise<void>) {
  const server = createCascadeHttpServer(pool);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
}

test("open pixel records an open event and serves a gif", async () => {
  const pool = await freshSchema();
  const { sendId, enrollment } = await seedSentEmail(pool, "open@example.com");
  await withServer(pool, async (base) => {
    const res = await fetch(`${base}/o/${signToken({ t: "open", s: sendId, o: "legacy" })}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/gif");
  });
  const events = await pool.query(
    `SELECT count(*)::int AS n FROM events WHERE enrollment_id = $1 AND type = 'open'`,
    [enrollment.id],
  );
  assert.equal(events.rows[0].n, 1);
});

test("click redirect records click and redirects to the target", async () => {
  const pool = await freshSchema();
  const { sendId, enrollment } = await seedSentEmail(pool, "click@example.com");
  await withServer(pool, async (base) => {
    const token = signToken({
      t: "click",
      s: sendId,
      u: "https://example.com/page",
      o: "legacy",
    });
    const res = await fetch(`${base}/c/${token}`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "https://example.com/page");
  });
  const events = await pool.query(`SELECT type FROM events WHERE enrollment_id = $1 ORDER BY id`, [enrollment.id]);
  assert.deepEqual(events.rows.map((r) => r.type), ["sent", "click"]);
});

test("interest click records both click and interest events", async () => {
  const pool = await freshSchema();
  const { sendId, enrollment } = await seedSentEmail(pool, "interest@example.com");
  await withServer(pool, async (base) => {
    const token = signToken({
      t: "click",
      s: sendId,
      u: "https://example.com/book",
      i: 1,
      o: "legacy",
    });
    const res = await fetch(`${base}/c/${token}`, { redirect: "manual" });
    assert.equal(res.status, 302);
  });
  const events = await pool.query(`SELECT type FROM events WHERE enrollment_id = $1 ORDER BY id`, [enrollment.id]);
  assert.deepEqual(events.rows.map((r) => r.type), ["sent", "click", "interest"]);
});

test("bounce webhook suppresses the contact and stops enrollments", async () => {
  const pool = await freshSchema();
  const { providerId, contact } = await seedSentEmail(pool, "bounce@example.com");
  // Re-enroll so there's an active enrollment to stop (first one completed).
  const { funnel: f2 } = await createFunnel(pool, {
    name: "f2-bounce",
    steps: [{ type: "delay", config: { seconds: 3600 } }],
  });
  const active = await enrollContact(pool, f2.id, contact.id);

  await withServer(pool, async (base) => {
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: providerId } });
    const request = signedResendRequest(body, "evt_bounce_1");
    const res = await fetch(`${base}/webhooks/resend`, request);
    assert.equal(res.status, 200);
    const replay = await fetch(`${base}/webhooks/resend`, request);
    assert.equal(replay.status, 202);
  });

  const c = await pool.query(`SELECT subscription_status FROM contacts WHERE id = $1`, [contact.id]);
  assert.equal(c.rows[0].subscription_status, "suppressed");
  const e = await pool.query(`SELECT state FROM enrollments WHERE id = $1`, [active.id]);
  assert.equal(e.rows[0].state, "stopped");
  const events = await pool.query(`SELECT count(*)::int AS n FROM events WHERE contact_id = $1 AND type = 'bounce'`, [
    contact.id,
  ]);
  assert.equal(events.rows[0].n, 1);
});

test("unknown provider ids are ignored without error", async () => {
  const pool = await freshSchema();
  await withServer(pool, async (base) => {
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_missing" } });
    const res = await fetch(
      `${base}/webhooks/resend`,
      signedResendRequest(body, "evt_missing_1"),
    );
    assert.equal(res.status, 202);
  });
});

test("Resend webhook rejects unsigned, stale, and oversized requests", async () => {
  const pool = await freshSchema();
  await withServer(pool, async (base) => {
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_missing" } });
    const unsigned = await fetch(`${base}/webhooks/resend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert.equal(unsigned.status, 401);

    const stale = await fetch(
      `${base}/webhooks/resend`,
      signedResendRequest(body, "evt_stale_1", "1000"),
    );
    assert.equal(stale.status, 401);

    const oversizedBody = JSON.stringify({ value: "x".repeat(1024 * 1024) });
    const oversized = await fetch(
      `${base}/webhooks/resend`,
      signedResendRequest(oversizedBody, "evt_large_1"),
    );
    assert.equal(oversized.status, 413);
  });
});

test("workspace Resend webhook verifies its encrypted secret and reports receipt health", async () => {
  const pool = await freshSchema();
  const { providerId } = await seedSentEmail(
    pool,
    "workspace-resend@example.com",
  );
  const provider = await configureDeliveryProvider(pool, {
    provider: "resend",
    apiKey: "re_workspace_key",
    webhookSecret: resendWebhookSecret,
  });
  await pool.query(
    `UPDATE sends SET delivery_provider_id=$1 WHERE provider_message_id=$2`,
    [provider.id, providerId],
  );

  await withServer(pool, async (base) => {
    const body = JSON.stringify({
      type: "email.delivered",
      data: { email_id: providerId },
    });
    const eventId = "evt_workspace_resend_1";
    const request = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...signResendWebhook({
          secret: resendWebhookSecret,
          eventId,
          body,
        }),
      },
      body,
    };
    const response = await fetch(
      `${base}/webhooks/delivery/${provider.id}`,
      request,
    );
    assert.equal(response.status, 200);
    const replay = await fetch(
      `${base}/webhooks/delivery/${provider.id}`,
      request,
    );
    assert.equal(replay.status, 202);
  });

  const settings = await listDeliverySettings(pool);
  assert.equal(settings.providers[0].webhookStatus, "receiving");
  assert.ok(settings.providers[0].webhookLastReceivedAt);
});

test("Mailchimp signed spam webhook suppresses the matching contact", async () => {
  const pool = await freshSchema();
  const { providerId, contact } = await seedSentEmail(
    pool,
    "workspace-mailchimp@example.com",
  );
  const webhookSecret = "mailchimp-workspace-webhook-secret";
  const provider = await configureDeliveryProvider(pool, {
    provider: "mailchimp",
    apiKey: "mailchimp-workspace-key",
    webhookSecret,
  });
  await pool.query(
    `UPDATE sends SET delivery_provider_id=$1 WHERE provider_message_id=$2`,
    [provider.id, providerId],
  );
  const fields = new URLSearchParams({
    mandrill_events: JSON.stringify([
      {
        event: "spam",
        ts: 1785100000,
        msg: { _id: providerId },
      },
    ]),
  });
  const signature = signMailchimpWebhook({
    secret: webhookSecret,
    url: deliveryWebhookUrl(provider.id),
    fields,
  });

  await withServer(pool, async (base) => {
    const response = await fetch(
      `${base}/webhooks/delivery/${provider.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Mandrill-Signature": signature,
        },
        body: fields.toString(),
      },
    );
    assert.equal(response.status, 200);
  });

  const result = await pool.query(
    `SELECT subscription_status FROM contacts WHERE id=$1`,
    [contact.id],
  );
  assert.equal(result.rows[0].subscription_status, "suppressed");
});

test("SendGrid signed spam webhook suppresses the matching contact", async () => {
  const pool = await freshSchema();
  const { providerId, contact } = await seedSentEmail(
    pool,
    "workspace-sendgrid@example.com",
  );
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const webhookPublicKey = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const provider = await configureDeliveryProvider(pool, {
    provider: "sendgrid",
    apiKey: "SG.workspace-key",
    webhookSecret: webhookPublicKey,
  });
  await pool.query(
    `UPDATE sends SET delivery_provider_id=$1 WHERE provider_message_id=$2`,
    [provider.id, providerId],
  );
  const body = JSON.stringify([
    {
      event: "spamreport",
      sg_event_id: "sendgrid-event-1",
      sg_message_id: `${providerId}.filter001`,
    },
  ]);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = sign(
    "sha256",
    Buffer.from(`${timestamp}${body}`, "utf8"),
    privateKey,
  ).toString("base64");

  await withServer(pool, async (base) => {
    const response = await fetch(
      `${base}/webhooks/delivery/${provider.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Twilio-Email-Event-Webhook-Signature": signature,
          "X-Twilio-Email-Event-Webhook-Timestamp": timestamp,
        },
        body,
      },
    );
    assert.equal(response.status, 200);
  });

  const result = await pool.query(
    `SELECT subscription_status FROM contacts WHERE id=$1`,
    [contact.id],
  );
  assert.equal(result.rows[0].subscription_status, "suppressed");
});
