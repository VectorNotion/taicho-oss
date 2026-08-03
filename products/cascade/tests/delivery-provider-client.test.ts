import assert from "node:assert/strict";
import test from "node:test";
import { createDeliveryProviderClient } from "../delivery/provider-client";

test("Resend provider client checks credentials and configures domains", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: any, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (init.method === "POST") {
      return new Response(
        JSON.stringify({
          id: "domain-1",
          name: "mail.example.com",
          status: "pending",
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as typeof fetch;
  const client = createDeliveryProviderClient(
    "resend",
    { apiKey: "re_test" },
    fetchImpl,
  );

  await client.checkConnection();
  const domain = await client.configureDomain("mail.example.com");

  assert.equal(domain.providerDomainId, "domain-1");
  assert.equal(domain.status, "pending");
  assert.equal(calls[0].url, "https://api.resend.com/domains");
  assert.equal(
    (calls[0].init.headers as Record<string, string>).Authorization,
    "Bearer re_test",
  );
  assert.equal(
    JSON.parse(String(calls[2].init.body)).name,
    "mail.example.com",
  );
});

test("Mailchimp provider client pings and verifies SPF/DKIM sender domains", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: any, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    if (String(url).endsWith("/users/ping.json")) {
      return new Response(JSON.stringify("PONG!"), { status: 200 });
    }
    if (String(url).endsWith("/senders/domains.json")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (String(url).endsWith("/senders/add-domain.json")) {
      return new Response(
        JSON.stringify({ domain: "mail.example.com" }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        domain: "mail.example.com",
        verified_at: "2026-07-27T00:00:00Z",
        valid_signing: true,
        spf: { valid: true },
        dkim: { valid: true },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const client = createDeliveryProviderClient(
    "mailchimp",
    { apiKey: "mandrill-key" },
    fetchImpl,
  );

  await client.checkConnection();
  const domain = await client.configureDomain("mail.example.com");

  assert.equal(domain.status, "verified");
  assert.equal(
    calls[0].url,
    "https://mandrillapp.com/api/1.0/users/ping.json",
  );
  assert.equal(
    calls[1].url,
    "https://mandrillapp.com/api/1.0/senders/domains.json",
  );
  assert.deepEqual(calls[2].body, {
    key: "mandrill-key",
    domain: "mail.example.com",
  });
  assert.equal(
    calls[3].url,
    "https://mandrillapp.com/api/1.0/senders/check-domain.json",
  );
});

test("SendGrid provider client automates domains and signed event webhooks", async () => {
  const calls: Array<{
    url: string;
    method: string;
    body?: Record<string, unknown>;
  }> = [];
  const fetchImpl = (async (url: any, init: RequestInit = {}) => {
    const target = String(url);
    const method = init.method ?? "GET";
    const body = init.body
      ? JSON.parse(String(init.body)) as Record<string, unknown>
      : undefined;
    calls.push({ url: target, method, body });
    if (target.endsWith("/scopes")) {
      return new Response(JSON.stringify({ scopes: ["mail.send"] }));
    }
    if (target.endsWith("/whitelabel/domains") && method === "GET") {
      return new Response(JSON.stringify([]));
    }
    if (target.endsWith("/whitelabel/domains") && method === "POST") {
      return new Response(
        JSON.stringify({
          id: 42,
          domain: "mail.example.com",
          valid: false,
        }),
        { status: 201 },
      );
    }
    if (target.endsWith("/user/webhooks/event/settings/all")) {
      return new Response(JSON.stringify([]));
    }
    if (
      target.endsWith("/user/webhooks/event/settings")
      && method === "POST"
    ) {
      return new Response(JSON.stringify({ id: "webhook-42" }), {
        status: 201,
      });
    }
    return new Response(
      JSON.stringify({ public_key: "sendgrid-public-key" }),
    );
  }) as typeof fetch;
  const client = createDeliveryProviderClient(
    "sendgrid",
    { apiKey: "SG.test" },
    fetchImpl,
  );

  await client.checkConnection();
  const domain = await client.configureDomain("mail.example.com");
  const webhook = await client.configureWebhook?.(
    "https://example.com/webhooks/delivery/provider-1",
  );

  assert.deepEqual(domain, {
    providerDomainId: "42",
    status: "pending",
  });
  assert.equal(webhook?.verificationSecret, "sendgrid-public-key");
  assert.deepEqual(calls[2].body, {
    domain: "mail.example.com",
    automatic_security: true,
  });
  assert.equal(
    calls[4].url,
    "https://api.sendgrid.com/v3/user/webhooks/event/settings",
  );
  assert.equal(
    calls[5].url,
    "https://api.sendgrid.com/v3/user/webhooks/event/settings/signed/webhook-42",
  );
});
