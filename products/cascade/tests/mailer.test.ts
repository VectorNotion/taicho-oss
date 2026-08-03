import assert from "node:assert/strict";
import test from "node:test";
import {
  DeterministicE2eMailer,
  DisabledMailer,
  LogMailer,
  MailchimpTransactionalMailer,
  ResendMailer,
  SendGridMailer,
  selectMailer,
} from "../engine/mailer";
import type { OutgoingEmail } from "../engine/mailer";

const EMAIL: OutgoingEmail = {
  to: "a@example.com",
  from: "Cascade <c@mail.example.com>",
  subject: "s1",
  html: "<p>hi</p>",
  text: "hi",
  headers: { "List-Unsubscribe": "<https://x/u/t>" },
};

test("LogMailer captures sends and returns unique provider ids", async () => {
  const mailer = new LogMailer();
  const a = await mailer.send(EMAIL);
  const b = await mailer.send({ ...EMAIL, to: "b@example.com" });
  assert.equal(mailer.sent.length, 2);
  assert.equal(mailer.sent[1].to, "b@example.com");
  assert.notEqual(a.providerMessageId, b.providerMessageId);
});

test("ResendMailer posts the payload and returns the provider id", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
  }) as typeof fetch;

  const mailer = new ResendMailer({ apiKey: "key-1", fetchImpl });
  const res = await mailer.send(EMAIL);

  assert.equal(res.providerMessageId, "re_123");
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body.to, ["a@example.com"]);
  assert.equal(body.headers["List-Unsubscribe"], "<https://x/u/t>");
  assert.equal((calls[0].init.headers as any).Authorization, "Bearer key-1");
});

test("ResendMailer throws on non-ok responses", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 422 })) as typeof fetch;
  const mailer = new ResendMailer({ apiKey: "key-1", fetchImpl });
  await assert.rejects(() => mailer.send(EMAIL), /resend 422/);
});

test("MailchimpTransactionalMailer posts finished content and returns the message id", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify([
        {
          email: "a@example.com",
          status: "sent",
          _id: "mandrill-123",
        },
      ]),
      { status: 200 },
    );
  }) as typeof fetch;
  const mailer = new MailchimpTransactionalMailer({
    apiKey: "mailchimp-key",
    fetchImpl,
  });

  const result = await mailer.send(EMAIL);

  assert.equal(result.providerMessageId, "mandrill-123");
  assert.equal(
    calls[0].url,
    "https://mandrillapp.com/api/1.0/messages/send.json",
  );
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.key, "mailchimp-key");
  assert.equal(body.message.from_email, "c@mail.example.com");
  assert.equal(body.message.from_name, "Cascade");
  assert.deepEqual(body.message.to, [
    { email: "a@example.com", type: "to" },
  ]);
  assert.equal(
    body.message.headers["List-Unsubscribe"],
    "<https://x/u/t>",
  );
});

test("MailchimpTransactionalMailer rejects failed provider results", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify([
        {
          email: "a@example.com",
          status: "rejected",
          reject_reason: "invalid-sender",
          _id: "mandrill-123",
        },
      ]),
      { status: 200 },
    )) as typeof fetch;
  const mailer = new MailchimpTransactionalMailer({
    apiKey: "mailchimp-key",
    fetchImpl,
  });
  await assert.rejects(() => mailer.send(EMAIL), /delivery rejected/);
});

test("SendGridMailer sends finished content and returns the response message id", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: any, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(null, {
      status: 202,
      headers: { "X-Message-Id": "sendgrid-123" },
    });
  }) as typeof fetch;
  const mailer = new SendGridMailer({
    apiKey: "SG.test",
    fetchImpl,
  });

  const result = await mailer.send(EMAIL);

  assert.equal(result.providerMessageId, "sendgrid-123");
  assert.equal(calls[0].url, "https://api.sendgrid.com/v3/mail/send");
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body.from, {
    email: "c@mail.example.com",
    name: "Cascade",
  });
  assert.equal(body.personalizations[0].to[0].email, "a@example.com");
  assert.deepEqual(
    body.content.map((item: { type: string }) => item.type),
    ["text/plain", "text/html"],
  );
});

test("deterministic E2E transport succeeds normally and exposes a reserved failure recipient", async () => {
  const mailer = new DeterministicE2eMailer();
  const first = await mailer.send(EMAIL);
  const second = await mailer.send({ ...EMAIL, to: "b@example.com" });
  assert.notEqual(first.providerMessageId, second.providerMessageId);
  const afterRestart = await new DeterministicE2eMailer().send(EMAIL);
  assert.notEqual(first.providerMessageId, afterRestart.providerMessageId);
  assert.match(afterRestart.providerMessageId, /^e2e-[0-9a-f-]{36}$/);
  await assert.rejects(
    () => mailer.send({ ...EMAIL, to: "transport-failure@example.test" }),
    /Deterministic E2E transport failure/,
  );
});

test("selectMailer allows the E2E transport only outside production", () => {
  const previousMode = process.env.CASCADE_MAILER_MODE;
  const previousNodeEnvironment = process.env.NODE_ENV;
  try {
    process.env.CASCADE_MAILER_MODE = "e2e";
    process.env.NODE_ENV = "test";
    assert.ok(selectMailer() instanceof DeterministicE2eMailer);
    process.env.NODE_ENV = "production";
    assert.throws(() => selectMailer(), /forbidden in production/);
  } finally {
    if (previousMode === undefined) delete process.env.CASCADE_MAILER_MODE;
    else process.env.CASCADE_MAILER_MODE = previousMode;
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
  }
});

test("selectMailer falls back to LogMailer without an api key", () => {
  const previousApiKey = process.env.RESEND_API_KEY;
  const previousNodeEnvironment = process.env.NODE_ENV;
  try {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "test";
    assert.ok(selectMailer() instanceof LogMailer);
  } finally {
    if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousApiKey;
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
  }
});

test("selectMailer fails closed without an api key in production", async () => {
  const previousApiKey = process.env.RESEND_API_KEY;
  const previousNodeEnvironment = process.env.NODE_ENV;
  try {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "production";
    const mailer = selectMailer();
    assert.ok(mailer instanceof DisabledMailer);
    await assert.rejects(() => mailer.send(EMAIL), /Email delivery is unavailable/);
  } finally {
    if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousApiKey;
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
  }
});
