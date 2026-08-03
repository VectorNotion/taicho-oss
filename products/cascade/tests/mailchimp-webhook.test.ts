import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMailchimpWebhookEvent,
  parseMailchimpWebhookEvents,
  signMailchimpWebhook,
  verifyMailchimpWebhook,
} from "../engine/mailchimp-webhook";

test("Mailchimp webhook signatures bind the exact URL and sorted form fields", () => {
  const fields = new URLSearchParams({
    mandrill_events: JSON.stringify([
      { event: "hard_bounce", ts: 123, msg: { _id: "message-1" } },
    ]),
  });
  const signature = signMailchimpWebhook({
    secret: "mailchimp-webhook-secret",
    url: "https://app.example.com/webhooks/delivery/provider-1",
    fields,
  });
  assert.equal(
    verifyMailchimpWebhook({
      secret: "mailchimp-webhook-secret",
      url: "https://app.example.com/webhooks/delivery/provider-1",
      fields,
      signature,
    }),
    true,
  );
  assert.equal(
    verifyMailchimpWebhook({
      secret: "mailchimp-webhook-secret",
      url: "https://other.example.com/webhooks/delivery/provider-1",
      fields,
      signature,
    }),
    false,
  );
});

test("Mailchimp webhook events normalize delivery and suppression signals", () => {
  const fields = new URLSearchParams({
    mandrill_events: JSON.stringify([
      { event: "send", ts: 100, msg: { _id: "message-1" } },
      { event: "spam", ts: 101, msg: { _id: "message-2" } },
      { event: "soft_bounce", ts: 102, msg: { _id: "message-3" } },
      { event: "unknown", ts: 103, msg: { _id: "message-4" } },
    ]),
  });
  const events = parseMailchimpWebhookEvents(fields)
    .map(normalizeMailchimpWebhookEvent)
    .filter(Boolean);
  assert.deepEqual(events, [
    {
      type: "email.delivered",
      providerMessageId: "message-1",
      receiptId:
        "mailchimp:2a3a374441d79e432f8e7d1b893536b762abab7ce5a59bcc3c0d2b029e015124",
    },
    {
      type: "email.complained",
      providerMessageId: "message-2",
      receiptId:
        "mailchimp:d460117023971860cc94ecb1fa460386402117a20a707d3a7e38cf036f76322f",
    },
  ]);
});
