import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign,
} from "node:crypto";
import test from "node:test";
import {
  normalizeSendGridWebhookEvent,
  parseSendGridWebhookEvents,
  verifySendGridWebhook,
} from "../engine/sendgrid-webhook";

test("SendGrid webhook verification binds a fresh timestamp and raw body", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const body = JSON.stringify([
    {
      event: "delivered",
      sg_event_id: "event-1",
      sg_message_id: "message-1.filter0001",
    },
  ]);
  const timestamp = "1785100000";
  const signature = sign(
    "sha256",
    Buffer.from(`${timestamp}${body}`, "utf8"),
    privateKey,
  ).toString("base64");
  const encodedPublicKey = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");

  assert.equal(
    verifySendGridWebhook({
      publicKey: encodedPublicKey,
      body,
      signature,
      timestamp,
      nowSeconds: 1785100000,
    }),
    true,
  );
  assert.equal(
    verifySendGridWebhook({
      publicKey: encodedPublicKey,
      body: `${body} `,
      signature,
      timestamp,
      nowSeconds: 1785100000,
    }),
    false,
  );
  assert.equal(
    verifySendGridWebhook({
      publicKey: encodedPublicKey,
      body,
      signature,
      timestamp,
      nowSeconds: 1785101000,
    }),
    false,
  );
});

test("SendGrid webhook events normalize delivery and suppression signals", () => {
  const events = parseSendGridWebhookEvents(
    JSON.stringify([
      {
        event: "delivered",
        sg_event_id: "event-1",
        sg_message_id: "message-1.filter001",
      },
      {
        event: "spamreport",
        sg_event_id: "event-2",
        sg_message_id: "message-2",
      },
      {
        event: "processed",
        sg_event_id: "event-3",
        sg_message_id: "message-3",
      },
    ]),
  )
    .map(normalizeSendGridWebhookEvent)
    .filter(Boolean);

  assert.deepEqual(events, [
    {
      type: "email.delivered",
      providerMessageId: "message-1",
      receiptId: "sendgrid:event-1",
    },
    {
      type: "email.complained",
      providerMessageId: "message-2",
      receiptId: "sendgrid:event-2",
    },
  ]);
});
