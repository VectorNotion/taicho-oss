import assert from "node:assert/strict";
import test from "node:test";
import {
  checkDeliveryProvider,
  connectDeliveryProvider,
  configureDeliveryDomain,
  configureDeliveryProvider,
  createSenderIdentity,
  findDeliveryWebhookConfiguration,
  listDeliverySettings,
  resolveDefaultDeliveryConfiguration,
  setDefaultDelivery,
} from "../data/delivery-settings-repository";
import type {
  DeliveryProviderClient,
  ProviderDomainState,
} from "../delivery/provider-client";
import { freshSchema } from "./helpers";

class StubProviderClient implements DeliveryProviderClient {
  connectionChecks = 0;
  webhookSetups = 0;
  status: ProviderDomainState = {
    providerDomainId: "provider-domain-1",
    status: "pending",
  };

  async checkConnection(): Promise<void> {
    this.connectionChecks += 1;
  }

  async configureDomain(): Promise<ProviderDomainState> {
    return this.status;
  }

  async checkDomain(): Promise<ProviderDomainState> {
    return this.status;
  }

  async configureWebhook(): Promise<{ verificationSecret: string }> {
    this.webhookSetups += 1;
    return { verificationSecret: "automatic-webhook-verification-key" };
  }
}

test("delivery credentials are encrypted, redacted, and tenant-bound", async () => {
  const pool = await freshSchema();
  const priorKey = process.env.CASCADE_CREDENTIAL_ENCRYPTION_KEY;
  process.env.CASCADE_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString(
    "base64",
  );
  try {
    const configured = await configureDeliveryProvider(pool, {
      provider: "resend",
      apiKey: "re_secret_delivery_key",
      webhookSecret: "whsec_secret_delivery_key",
    });
    const stored = await pool.query<{
      credential_ciphertext: string;
      credential_key_version: string;
    }>(
      `SELECT credential_ciphertext,credential_key_version
         FROM delivery_provider_connections
        WHERE id=$1`,
      [configured.id],
    );
    assert.equal(
      stored.rows[0].credential_ciphertext.includes("re_secret_delivery_key"),
      false,
    );
    assert.equal(stored.rows[0].credential_key_version, "v1");

    const summary = await listDeliverySettings(pool);
    assert.equal(summary.providers[0].credentialConfigured, true);
    assert.equal(summary.providers[0].webhookSecretConfigured, true);
    assert.equal(
      "apiKey" in (summary.providers[0] as unknown as Record<string, unknown>),
      false,
    );

    const webhook = await findDeliveryWebhookConfiguration(
      pool,
      configured.id,
    );
    assert.equal(webhook?.webhookSecret, "whsec_secret_delivery_key");
    assert.equal(webhook?.organizationId, "legacy");
  } finally {
    if (priorKey === undefined) {
      delete process.env.CASCADE_CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.CASCADE_CREDENTIAL_ENCRYPTION_KEY = priorKey;
    }
  }
});

test("only a healthy provider and verified sender can become funnel defaults", async () => {
  const pool = await freshSchema();
  const provider = await configureDeliveryProvider(pool, {
    provider: "mailchimp",
    apiKey: "mailchimp-secret-key",
    webhookSecret: "mailchimp-webhook-secret",
  });
  const stub = new StubProviderClient();
  const domain = await configureDeliveryDomain(
    pool,
    {
      providerConnectionId: provider.id,
      domain: "mail.example.com",
    },
    { client: stub },
  );
  assert.equal(domain.status, "pending");
  const sender = await createSenderIdentity(pool, {
    providerConnectionId: provider.id,
    name: "Example Team",
    email: "hello@mail.example.com",
  });
  assert.equal(sender.status, "pending");

  await assert.rejects(
    () =>
      setDefaultDelivery(pool, {
        providerConnectionId: provider.id,
        senderIdentityId: sender.id,
      }),
    /Check the provider connection/,
  );

  await checkDeliveryProvider(pool, provider.id, { client: stub });
  await assert.rejects(
    () =>
      setDefaultDelivery(pool, {
        providerConnectionId: provider.id,
        senderIdentityId: sender.id,
      }),
    /verified domain/,
  );

  stub.status = {
    providerDomainId: "provider-domain-1",
    status: "verified",
  };
  await checkDeliveryProvider(pool, provider.id, { client: stub });
  await setDefaultDelivery(pool, {
    providerConnectionId: provider.id,
    senderIdentityId: sender.id,
  });

  const summary = await listDeliverySettings(pool);
  assert.equal(summary.defaultProviderId, provider.id);
  assert.equal(summary.defaultSenderId, sender.id);
  assert.equal(summary.domains[0].status, "verified");
  assert.equal(summary.senders[0].status, "verified");
  assert.equal(summary.providers[0].healthStatus, "connected");
  assert.equal(stub.connectionChecks, 2);

  const runtime = await resolveDefaultDeliveryConfiguration(pool);
  assert.equal(runtime?.provider, "mailchimp");
  assert.equal(runtime?.credentials.apiKey, "mailchimp-secret-key");
  assert.deepEqual(runtime?.sender, {
    id: sender.id,
    name: "Example Team",
    email: "hello@mail.example.com",
  });
});

test("sender identities must belong to a domain configured on the same provider", async () => {
  const pool = await freshSchema();
  const provider = await configureDeliveryProvider(pool, {
    provider: "resend",
    apiKey: "resend-secret-key",
  });
  await assert.rejects(
    () =>
      createSenderIdentity(pool, {
        providerConnectionId: provider.id,
        name: "Wrong Domain",
        email: "hello@unconfigured.example",
      }),
    /Configure the sender's domain/,
  );
});

test("guided connection hides and automates provider infrastructure", async () => {
  const pool = await freshSchema();
  const stub = new StubProviderClient();
  stub.status = {
    providerDomainId: "sendgrid-domain-42",
    status: "verified",
  };

  const connected = await connectDeliveryProvider(
    pool,
    {
      provider: "sendgrid",
      apiKey: "SG.guided-connection-key",
      senderName: "Acme Team",
      senderEmail: "hello@acme.example",
    },
    { client: stub },
  );

  assert.equal(connected.ready, true);
  assert.equal(connected.webhookAutomated, true);
  assert.equal(stub.webhookSetups, 1);
  const summary = await listDeliverySettings(pool);
  assert.equal(summary.defaultProviderId, connected.providerConnectionId);
  assert.equal(summary.defaultSenderId, connected.senderIdentityId);
  assert.equal(summary.providers[0].provider, "sendgrid");
  assert.equal(summary.providers[0].webhookSecretConfigured, true);
  assert.deepEqual(
    summary.domains.map((domain) => [domain.name, domain.status]),
    [["acme.example", "verified"]],
  );
  assert.deepEqual(
    summary.senders.map((sender) => [
      sender.name,
      sender.email,
      sender.status,
    ]),
    [["Acme Team", "hello@acme.example", "verified"]],
  );
});
