import { randomUUID } from "node:crypto";
import {
  databaseFor,
  delivery_domainsInCascade as deliveryDomainsTable,
  delivery_provider_connectionsInCascade as providerConnectionsTable,
  delivery_sender_identitiesInCascade as senderIdentitiesTable,
} from "@content-automation/database";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import {
  decryptDeliveryCredentials,
  deliveryCredentialAssociatedData,
  encryptDeliveryCredentials,
} from "../delivery/credential-crypto";
import {
  createDeliveryProviderClient,
  deliveryProviderErrorCode,
  type DeliveryProviderClient,
} from "../delivery/provider-client";
import {
  DELIVERY_PROVIDERS,
  type DeliveryCredentials,
  type DeliveryDomainSummary,
  type DeliveryProvider,
  type DeliveryProviderSummary,
  type DeliverySettingsSummary,
  type DeliveryVerificationStatus,
  type ResolvedDeliveryConfiguration,
  type SenderIdentitySummary,
} from "../delivery/types";

function iso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function isDeliveryProvider(value: string): value is DeliveryProvider {
  return (DELIVERY_PROVIDERS as readonly string[]).includes(value);
}

function normalizedDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    domain.length > 253
    || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
      domain,
    )
  ) {
    throw new Error("Enter a valid sending domain.");
  }
  return domain;
}

function normalizedEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length > 320
    || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
  ) {
    throw new Error("Enter a valid sender email address.");
  }
  return email;
}

function displayName(value: string, fallback: string): string {
  const name = value.trim();
  if (!name) return fallback;
  if (name.length > 120) throw new Error("Display names may contain at most 120 characters.");
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("Display names may not contain control characters.");
  }
  return name;
}

function senderName(value: string, fallback: string): string {
  const name = displayName(value, fallback);
  if (/[<>]/.test(name)) {
    throw new Error("Sender names may not contain angle brackets.");
  }
  return name;
}

async function scopedOrganizationId(pool: Pool): Promise<string> {
  const result = await databaseFor(pool).execute<{ organizationId: string | null }>(
    sql`select nullif(current_setting('app.organization_id', true), '') as "organizationId"`,
  );
  const organizationId = result.rows[0]?.organizationId;
  if (!organizationId) {
    throw new Error("A workspace-scoped Nurture database connection is required.");
  }
  return organizationId;
}

export function deliveryWebhookUrl(providerConnectionId: string): string {
  const base =
    process.env.CASCADE_PUBLIC_URL
    ?? process.env.PUBLIC_APP_URL
    ?? "http://localhost:3010";
  return `${base.replace(/\/$/, "")}/webhooks/delivery/${providerConnectionId}`;
}

async function providerCredentials(
  organizationId: string,
  row: {
    id: string;
    credential_ciphertext: string;
  },
): Promise<DeliveryCredentials> {
  return decryptDeliveryCredentials<DeliveryCredentials>(
    row.credential_ciphertext,
    deliveryCredentialAssociatedData({
      organizationId,
      providerConnectionId: row.id,
    }),
  );
}

export async function configureDeliveryProvider(
  pool: Pool,
  input: {
    provider: DeliveryProvider;
    displayName?: string;
    apiKey?: string;
    webhookSecret?: string;
    enabled?: boolean;
  },
): Promise<{ id: string }> {
  if (!isDeliveryProvider(input.provider)) {
    throw new Error("Unsupported delivery provider.");
  }
  const organizationId = await scopedOrganizationId(pool);
  const db = databaseFor(pool);
  const [existing] = await db.select({
    id: providerConnectionsTable.id,
    credential_ciphertext: providerConnectionsTable.credential_ciphertext,
    display_name: providerConnectionsTable.display_name,
    health_status: providerConnectionsTable.health_status,
    webhook_status: providerConnectionsTable.webhook_status,
    webhook_configured_at: providerConnectionsTable.webhook_configured_at,
    webhook_last_received_at: providerConnectionsTable.webhook_last_received_at,
  }).from(providerConnectionsTable).where(and(
    eq(providerConnectionsTable.provider, input.provider),
    eq(providerConnectionsTable.organization_id, organizationId),
  )).limit(1);
  const id = existing?.id ?? randomUUID();
  const prior = existing
    ? await providerCredentials(organizationId, existing)
    : null;
  const apiKey = input.apiKey?.trim() || prior?.apiKey;
  if (!apiKey || apiKey.length < 8 || apiKey.length > 10_000) {
    throw new Error("A valid provider API key is required.");
  }
  const webhookSecret =
    input.webhookSecret === undefined
      ? prior?.webhookSecret
      : input.webhookSecret.trim() || undefined;
  const credentials: DeliveryCredentials = {
    apiKey,
    ...(webhookSecret ? { webhookSecret } : {}),
  };
  const apiKeyChanged = prior?.apiKey !== apiKey;
  const webhookSecretChanged = prior?.webhookSecret !== webhookSecret;
  const encrypted = encryptDeliveryCredentials(
    credentials,
    deliveryCredentialAssociatedData({
      organizationId,
      providerConnectionId: id,
    }),
  );
  const fallbackName = input.provider === "resend"
    ? "Resend"
    : input.provider === "sendgrid"
      ? "Twilio SendGrid"
      : "Mailchimp Transactional";
  const webhookStatus = webhookSecret
    ? webhookSecretChanged || !existing?.webhook_last_received_at
      ? "configured"
      : existing.webhook_status
    : "not_configured";
  const webhookConfiguredAt = webhookSecret
    ? existing?.webhook_configured_at ?? sql`now()`
    : null;
  await db.insert(providerConnectionsTable).values({
    id,
    provider: input.provider,
    display_name: displayName(input.displayName ?? existing?.display_name ?? fallbackName, fallbackName),
    credential_ciphertext: encrypted.ciphertext,
    credential_key_version: encrypted.keyVersion,
    enabled: input.enabled ?? true,
    health_status: "unchecked",
    webhook_status: webhookSecret ? "configured" : "not_configured",
    webhook_configured_at: webhookSecret ? sql`now()` : null,
    updated_at: sql`now()`,
  }).onConflictDoUpdate({
    target: [providerConnectionsTable.organization_id, providerConnectionsTable.provider],
    set: {
      display_name: displayName(input.displayName ?? existing?.display_name ?? fallbackName, fallbackName),
      credential_ciphertext: encrypted.ciphertext,
      credential_key_version: encrypted.keyVersion,
      enabled: input.enabled ?? true,
      health_status: apiKeyChanged ? "unchecked" : existing?.health_status ?? "unchecked",
      last_error_code: null,
      webhook_status: webhookStatus,
      webhook_configured_at: webhookConfiguredAt,
      updated_at: sql`now()`,
    },
  });
  return { id };
}

export async function connectDeliveryProvider(
  pool: Pool,
  input: {
    provider: DeliveryProvider;
    apiKey?: string;
    senderName: string;
    senderEmail: string;
  },
  dependencies: {
    client?: DeliveryProviderClient;
  } = {},
): Promise<{
  providerConnectionId: string;
  senderIdentityId: string;
  ready: boolean;
  webhookAutomated: boolean;
}> {
  const configured = await configureDeliveryProvider(pool, {
    provider: input.provider,
    apiKey: input.apiKey,
    enabled: true,
  });
  let connection = await providerConnection(pool, configured.id);
  const client =
    dependencies.client
    ?? createDeliveryProviderClient(connection.provider, connection.credentials);

  await checkDeliveryProvider(pool, configured.id, { client });

  let webhookAutomated = Boolean(connection.credentials.webhookSecret);
  if (!webhookAutomated && client.configureWebhook) {
    try {
      const webhook = await client.configureWebhook(
        deliveryWebhookUrl(configured.id),
      );
      await configureDeliveryProvider(pool, {
        provider: input.provider,
        webhookSecret: webhook.verificationSecret,
        enabled: true,
      });
      webhookAutomated = true;
      connection = await providerConnection(pool, configured.id);
    } catch {
      await databaseFor(pool).update(providerConnectionsTable).set({
        webhook_status: "error",
        last_error_code: "webhook_setup_failed",
        updated_at: sql`now()`,
      }).where(and(
        eq(providerConnectionsTable.id, configured.id),
        eq(providerConnectionsTable.organization_id, connection.organization_id),
      ));
    }
  }

  const senderEmail = normalizedEmail(input.senderEmail);
  const senderDomain = senderEmail.slice(senderEmail.lastIndexOf("@") + 1);
  await configureDeliveryDomain(
    pool,
    {
      providerConnectionId: configured.id,
      domain: senderDomain,
    },
    { client },
  );
  const sender = await createSenderIdentity(pool, {
    providerConnectionId: configured.id,
    name: input.senderName,
    email: senderEmail,
  });
  await checkDeliveryProvider(pool, configured.id, { client });

  const summary = await listDeliverySettings(pool);
  const providerState = summary.providers.find(
    (item) => item.id === configured.id,
  );
  const senderState = summary.senders.find((item) => item.id === sender.id);
  const ready =
    providerState?.healthStatus === "connected"
    && senderState?.status === "verified";
  await persistDefaultDelivery(
    pool,
    connection.organization_id,
    configured.id,
    sender.id,
  );
  return {
    providerConnectionId: configured.id,
    senderIdentityId: sender.id,
    ready,
    webhookAutomated,
  };
}

type ProviderConnectionRow = {
  id: string;
  organization_id: string;
  provider: DeliveryProvider;
  credential_ciphertext: string;
  enabled: boolean;
};

async function providerConnection(
  pool: Pool,
  providerConnectionId: string,
): Promise<ProviderConnectionRow & { credentials: DeliveryCredentials }> {
  const organizationId = await scopedOrganizationId(pool);
  const [selected] = await databaseFor(pool).select({
    id: providerConnectionsTable.id,
    organization_id: providerConnectionsTable.organization_id,
    provider: providerConnectionsTable.provider,
    credential_ciphertext: providerConnectionsTable.credential_ciphertext,
    enabled: providerConnectionsTable.enabled,
  }).from(providerConnectionsTable).where(and(
    eq(providerConnectionsTable.id, providerConnectionId),
    eq(providerConnectionsTable.organization_id, organizationId),
  )).limit(1);
  const row = selected as ProviderConnectionRow | undefined;
  if (!row) throw new Error("Delivery provider connection was not found.");
  if (!row.enabled) throw new Error("Delivery provider connection is disabled.");
  return {
    ...row,
    credentials: await providerCredentials(row.organization_id, row),
  };
}

export async function checkDeliveryProvider(
  pool: Pool,
  providerConnectionId: string,
  dependencies: {
    client?: DeliveryProviderClient;
  } = {},
): Promise<void> {
  const connection = await providerConnection(pool, providerConnectionId);
  const client =
    dependencies.client
    ?? createDeliveryProviderClient(connection.provider, connection.credentials);
  try {
    await client.checkConnection();
    const db = databaseFor(pool);
    const domains = await db.select({
      id: deliveryDomainsTable.id,
      name: deliveryDomainsTable.name,
      provider_domain_id: deliveryDomainsTable.provider_domain_id,
    }).from(deliveryDomainsTable).where(and(
      eq(deliveryDomainsTable.provider_connection_id, providerConnectionId),
      eq(deliveryDomainsTable.organization_id, connection.organization_id),
    )).orderBy(asc(deliveryDomainsTable.created_at));
    for (const domain of domains) {
      try {
        const state = await client.checkDomain(
          domain.name,
          domain.provider_domain_id,
        );
        await db.update(deliveryDomainsTable).set({
          provider_domain_id: state.providerDomainId ?? domain.provider_domain_id,
          verification_status: state.status,
          last_checked_at: sql`now()`,
          last_error_code: null,
          updated_at: sql`now()`,
        }).where(and(
          eq(deliveryDomainsTable.id, domain.id),
          eq(deliveryDomainsTable.organization_id, connection.organization_id),
        ));
      } catch (error) {
        await db.update(deliveryDomainsTable).set({
          verification_status: "failed",
          last_checked_at: sql`now()`,
          last_error_code: deliveryProviderErrorCode(error),
          updated_at: sql`now()`,
        }).where(and(
          eq(deliveryDomainsTable.id, domain.id),
          eq(deliveryDomainsTable.organization_id, connection.organization_id),
        ));
      }
    }
    await db.update(providerConnectionsTable).set({
      health_status: "connected",
      last_checked_at: sql`now()`,
      last_error_code: null,
      updated_at: sql`now()`,
    }).where(and(
      eq(providerConnectionsTable.id, providerConnectionId),
      eq(providerConnectionsTable.organization_id, connection.organization_id),
    ));
    for (const domain of domains) {
      const [current] = await db.select({ status: deliveryDomainsTable.verification_status })
        .from(deliveryDomainsTable).where(and(
          eq(deliveryDomainsTable.id, domain.id),
          eq(deliveryDomainsTable.organization_id, connection.organization_id),
        )).limit(1);
      if (!current) continue;
      await db.update(senderIdentitiesTable).set({
        verification_status: current.status,
        updated_at: sql`now()`,
      }).where(and(
        eq(senderIdentitiesTable.domain_id, domain.id),
        eq(senderIdentitiesTable.provider_connection_id, providerConnectionId),
        eq(senderIdentitiesTable.organization_id, connection.organization_id),
      ));
    }
  } catch (error) {
    await databaseFor(pool).update(providerConnectionsTable).set({
      health_status: "error",
      last_checked_at: sql`now()`,
      last_error_code: deliveryProviderErrorCode(error),
      updated_at: sql`now()`,
    }).where(and(
      eq(providerConnectionsTable.id, providerConnectionId),
      eq(providerConnectionsTable.organization_id, connection.organization_id),
    ));
    throw new Error("The provider connection check failed.");
  }
}

export async function configureDeliveryDomain(
  pool: Pool,
  input: {
    providerConnectionId: string;
    domain: string;
  },
  dependencies: {
    client?: DeliveryProviderClient;
  } = {},
): Promise<DeliveryDomainSummary> {
  const connection = await providerConnection(pool, input.providerConnectionId);
  const domain = normalizedDomain(input.domain);
  const client =
    dependencies.client
    ?? createDeliveryProviderClient(connection.provider, connection.credentials);
  let state: {
    providerDomainId: string | null;
    status: DeliveryVerificationStatus;
  };
  try {
    state = await client.configureDomain(domain);
  } catch (error) {
    throw new Error(
      `The provider could not configure this domain (${deliveryProviderErrorCode(error)}).`,
    );
  }
  const [row] = await databaseFor(pool).insert(deliveryDomainsTable).values({
    provider_connection_id: input.providerConnectionId,
    name: domain,
    provider_domain_id: state.providerDomainId,
    verification_status: state.status,
    last_checked_at: sql`now()`,
  }).onConflictDoUpdate({
    target: [
      deliveryDomainsTable.organization_id,
      deliveryDomainsTable.provider_connection_id,
      deliveryDomainsTable.name,
    ],
    set: {
      provider_domain_id: sql`coalesce(excluded.provider_domain_id, ${deliveryDomainsTable.provider_domain_id})`,
      verification_status: sql`excluded.verification_status`,
      last_checked_at: sql`now()`,
      last_error_code: null,
      updated_at: sql`now()`,
    },
  }).returning({
    id: deliveryDomainsTable.id,
    provider_connection_id: deliveryDomainsTable.provider_connection_id,
    name: deliveryDomainsTable.name,
    provider_domain_id: deliveryDomainsTable.provider_domain_id,
    verification_status: deliveryDomainsTable.verification_status,
    last_checked_at: deliveryDomainsTable.last_checked_at,
    last_error_code: deliveryDomainsTable.last_error_code,
  });
  return mapDomain(row as DomainSummaryRow);
}

export async function createSenderIdentity(
  pool: Pool,
  input: {
    providerConnectionId: string;
    name: string;
    email: string;
  },
): Promise<SenderIdentitySummary> {
  const connection = await providerConnection(
    pool,
    input.providerConnectionId,
  );
  const email = normalizedEmail(input.email);
  const domainName = email.slice(email.lastIndexOf("@") + 1);
  const [domain] = await databaseFor(pool).select({
    id: deliveryDomainsTable.id,
    verification_status: deliveryDomainsTable.verification_status,
  }).from(deliveryDomainsTable).where(and(
    eq(deliveryDomainsTable.provider_connection_id, input.providerConnectionId),
    eq(deliveryDomainsTable.name, domainName),
    eq(deliveryDomainsTable.organization_id, connection.organization_id),
  )).limit(1);
  if (!domain) {
    throw new Error(
      "Configure the sender's domain for this provider before adding the identity.",
    );
  }
  const [row] = await databaseFor(pool).insert(senderIdentitiesTable).values({
    provider_connection_id: input.providerConnectionId,
    domain_id: domain.id,
    name: senderName(input.name, email),
    email,
    verification_status: domain.verification_status,
  }).onConflictDoUpdate({
    target: [
      senderIdentitiesTable.organization_id,
      senderIdentitiesTable.provider_connection_id,
      senderIdentitiesTable.email,
    ],
    set: {
      domain_id: domain.id,
      name: senderName(input.name, email),
      verification_status: domain.verification_status,
      updated_at: sql`now()`,
    },
  }).returning({
    id: senderIdentitiesTable.id,
    provider_connection_id: senderIdentitiesTable.provider_connection_id,
    domain_id: senderIdentitiesTable.domain_id,
    name: senderIdentitiesTable.name,
    email: senderIdentitiesTable.email,
    verification_status: senderIdentitiesTable.verification_status,
    is_default: senderIdentitiesTable.is_default,
  });
  return mapSender(row as SenderSummaryRow);
}

export async function setDefaultDelivery(
  pool: Pool,
  input: {
    providerConnectionId: string;
    senderIdentityId: string;
  },
): Promise<void> {
  const organizationId = await scopedOrganizationId(pool);
  const [status] = await databaseFor(pool).select({
    provider_status: providerConnectionsTable.health_status,
    sender_status: senderIdentitiesTable.verification_status,
    domain_status: deliveryDomainsTable.verification_status,
  }).from(providerConnectionsTable)
    .innerJoin(senderIdentitiesTable, eq(senderIdentitiesTable.provider_connection_id, providerConnectionsTable.id))
    .innerJoin(deliveryDomainsTable, eq(deliveryDomainsTable.id, senderIdentitiesTable.domain_id))
    .where(and(
      eq(providerConnectionsTable.id, input.providerConnectionId),
      eq(senderIdentitiesTable.id, input.senderIdentityId),
      eq(providerConnectionsTable.enabled, true),
      eq(providerConnectionsTable.organization_id, organizationId),
      eq(senderIdentitiesTable.organization_id, organizationId),
      eq(deliveryDomainsTable.organization_id, organizationId),
    )).limit(1);
  if (!status) {
    throw new Error("The selected sender does not belong to this provider.");
  }
  if (status.provider_status !== "connected") {
    throw new Error("Check the provider connection before making it the default.");
  }
  if (
    status.sender_status !== "verified"
    || status.domain_status !== "verified"
  ) {
    throw new Error("Only a sender on a verified domain can be the default.");
  }
  await persistDefaultDelivery(
    pool,
    organizationId,
    input.providerConnectionId,
    input.senderIdentityId,
  );
}

async function persistDefaultDelivery(
  pool: Pool,
  organizationId: string,
  providerConnectionId: string,
  senderIdentityId: string,
): Promise<void> {
  await databaseFor(pool).transaction(async (tx) => {
    await tx.update(providerConnectionsTable).set({
      is_default: sql`${providerConnectionsTable.id} = ${providerConnectionId}`,
      updated_at: sql`now()`,
    }).where(eq(providerConnectionsTable.organization_id, organizationId));
    await tx.update(senderIdentitiesTable).set({
      is_default: sql`${senderIdentitiesTable.id} = ${senderIdentityId}`,
      updated_at: sql`now()`,
    }).where(eq(senderIdentitiesTable.organization_id, organizationId));
  });
}

export async function setDefaultDeliveryProvider(
  pool: Pool,
  providerConnectionId: string,
): Promise<{ senderIdentityId: string }> {
  const organizationId = await scopedOrganizationId(pool);
  const [candidate] = await databaseFor(pool).select({ id: senderIdentitiesTable.id })
    .from(senderIdentitiesTable)
    .innerJoin(deliveryDomainsTable, eq(deliveryDomainsTable.id, senderIdentitiesTable.domain_id))
    .innerJoin(providerConnectionsTable, eq(providerConnectionsTable.id, senderIdentitiesTable.provider_connection_id))
    .where(and(
      eq(providerConnectionsTable.id, providerConnectionId),
      eq(providerConnectionsTable.organization_id, organizationId),
      eq(senderIdentitiesTable.organization_id, organizationId),
      eq(deliveryDomainsTable.organization_id, organizationId),
      eq(providerConnectionsTable.enabled, true),
      eq(providerConnectionsTable.health_status, "connected"),
      eq(senderIdentitiesTable.verification_status, "verified"),
      eq(deliveryDomainsTable.verification_status, "verified"),
    )).orderBy(desc(senderIdentitiesTable.is_default), desc(senderIdentitiesTable.updated_at)).limit(1);
  const senderIdentityId = candidate?.id;
  if (!senderIdentityId) {
    throw new Error(
      "This connection is waiting for its sending domain to be verified.",
    );
  }
  await setDefaultDelivery(pool, {
    providerConnectionId,
    senderIdentityId,
  });
  return { senderIdentityId };
}

type ProviderSummaryRow = {
  id: string;
  provider: DeliveryProvider;
  display_name: string;
  enabled: boolean;
  is_default: boolean;
  credential_configured: boolean;
  webhook_secret_configured: boolean;
  health_status: DeliveryProviderSummary["healthStatus"];
  last_checked_at: Date | string | null;
  last_error_code: string | null;
  webhook_status: DeliveryProviderSummary["webhookStatus"];
  webhook_configured_at: Date | string | null;
  webhook_last_received_at: Date | string | null;
};

type DomainSummaryRow = {
  id: string;
  provider_connection_id: string;
  name: string;
  provider_domain_id: string | null;
  verification_status: DeliveryVerificationStatus;
  last_checked_at: Date | string | null;
  last_error_code: string | null;
};

type SenderSummaryRow = {
  id: string;
  provider_connection_id: string;
  domain_id: string;
  name: string;
  email: string;
  verification_status: DeliveryVerificationStatus;
  is_default: boolean;
};

function mapProvider(row: ProviderSummaryRow): DeliveryProviderSummary {
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.display_name,
    enabled: row.enabled,
    isDefault: row.is_default,
    credentialConfigured: row.credential_configured,
    webhookSecretConfigured: Boolean(row.webhook_secret_configured),
    healthStatus: row.health_status,
    lastCheckedAt: iso(row.last_checked_at),
    lastErrorCode: row.last_error_code,
    webhookStatus: row.webhook_status,
    webhookConfiguredAt: iso(row.webhook_configured_at),
    webhookLastReceivedAt: iso(row.webhook_last_received_at),
    webhookUrl: deliveryWebhookUrl(row.id),
  };
}

function mapDomain(row: DomainSummaryRow): DeliveryDomainSummary {
  return {
    id: row.id,
    providerConnectionId: row.provider_connection_id,
    name: row.name,
    providerDomainId: row.provider_domain_id,
    status: row.verification_status,
    lastCheckedAt: iso(row.last_checked_at),
    lastErrorCode: row.last_error_code,
  };
}

function mapSender(row: SenderSummaryRow): SenderIdentitySummary {
  return {
    id: row.id,
    providerConnectionId: row.provider_connection_id,
    domainId: row.domain_id,
    name: row.name,
    email: row.email,
    status: row.verification_status,
    isDefault: row.is_default,
  };
}

export async function listDeliverySettings(
  pool: Pool,
): Promise<DeliverySettingsSummary> {
  const organizationId = await scopedOrganizationId(pool);
  const db = databaseFor(pool);
  const [providers, domains, senders] = await Promise.all([
    db.select({
      id: providerConnectionsTable.id,
      provider: providerConnectionsTable.provider,
      display_name: providerConnectionsTable.display_name,
      enabled: providerConnectionsTable.enabled,
      is_default: providerConnectionsTable.is_default,
      credential_configured: sql<boolean>`${providerConnectionsTable.credential_ciphertext} is not null`,
      webhook_secret_configured: sql<boolean>`${providerConnectionsTable.webhook_status} <> 'not_configured'`,
      health_status: providerConnectionsTable.health_status,
      last_checked_at: providerConnectionsTable.last_checked_at,
      last_error_code: providerConnectionsTable.last_error_code,
      webhook_status: providerConnectionsTable.webhook_status,
      webhook_configured_at: providerConnectionsTable.webhook_configured_at,
      webhook_last_received_at: providerConnectionsTable.webhook_last_received_at,
    }).from(providerConnectionsTable).where(eq(providerConnectionsTable.organization_id, organizationId))
      .orderBy(asc(providerConnectionsTable.provider)),
    db.select({
      id: deliveryDomainsTable.id,
      provider_connection_id: deliveryDomainsTable.provider_connection_id,
      name: deliveryDomainsTable.name,
      provider_domain_id: deliveryDomainsTable.provider_domain_id,
      verification_status: deliveryDomainsTable.verification_status,
      last_checked_at: deliveryDomainsTable.last_checked_at,
      last_error_code: deliveryDomainsTable.last_error_code,
    }).from(deliveryDomainsTable).where(eq(deliveryDomainsTable.organization_id, organizationId))
      .orderBy(asc(deliveryDomainsTable.name)),
    db.select({
      id: senderIdentitiesTable.id,
      provider_connection_id: senderIdentitiesTable.provider_connection_id,
      domain_id: senderIdentitiesTable.domain_id,
      name: senderIdentitiesTable.name,
      email: senderIdentitiesTable.email,
      verification_status: senderIdentitiesTable.verification_status,
      is_default: senderIdentitiesTable.is_default,
    }).from(senderIdentitiesTable).where(eq(senderIdentitiesTable.organization_id, organizationId))
      .orderBy(desc(senderIdentitiesTable.is_default), asc(senderIdentitiesTable.name), asc(senderIdentitiesTable.email)),
  ]);
  const providerSummaries = (providers as ProviderSummaryRow[]).map(mapProvider);
  const senderSummaries = (senders as SenderSummaryRow[]).map(mapSender);
  return {
    providers: providerSummaries,
    domains: (domains as DomainSummaryRow[]).map(mapDomain),
    senders: senderSummaries,
    defaultProviderId:
      providerSummaries.find((provider) => provider.isDefault)?.id ?? null,
    defaultSenderId:
      senderSummaries.find((sender) => sender.isDefault)?.id ?? null,
  };
}

export async function resolveDefaultDeliveryConfiguration(
  pool: Pool,
): Promise<ResolvedDeliveryConfiguration | null> {
  const organizationId = await scopedOrganizationId(pool);
  const [selected] = await databaseFor(pool).select({
    id: providerConnectionsTable.id,
    organization_id: providerConnectionsTable.organization_id,
    provider: providerConnectionsTable.provider,
    credential_ciphertext: providerConnectionsTable.credential_ciphertext,
    sender_id: senderIdentitiesTable.id,
    sender_name: senderIdentitiesTable.name,
    sender_email: senderIdentitiesTable.email,
  }).from(providerConnectionsTable)
    .innerJoin(senderIdentitiesTable, and(
      eq(senderIdentitiesTable.provider_connection_id, providerConnectionsTable.id),
      eq(senderIdentitiesTable.is_default, true),
    ))
    .innerJoin(deliveryDomainsTable, eq(deliveryDomainsTable.id, senderIdentitiesTable.domain_id))
    .where(and(
      eq(providerConnectionsTable.is_default, true),
      eq(providerConnectionsTable.organization_id, organizationId),
      eq(senderIdentitiesTable.organization_id, organizationId),
      eq(deliveryDomainsTable.organization_id, organizationId),
      eq(providerConnectionsTable.enabled, true),
      eq(providerConnectionsTable.health_status, "connected"),
      eq(senderIdentitiesTable.verification_status, "verified"),
      eq(deliveryDomainsTable.verification_status, "verified"),
    )).limit(1);
  const row = selected as (ProviderConnectionRow & {
    sender_id: string; sender_name: string; sender_email: string;
  }) | undefined;
  if (!row) return null;
  return {
    providerConnectionId: row.id,
    provider: row.provider,
    credentials: await providerCredentials(row.organization_id, row),
    sender: {
      id: row.sender_id,
      name: row.sender_name,
      email: row.sender_email,
    },
  };
}

export async function findDeliveryWebhookConfiguration(
  controlPool: Pool,
  providerConnectionId: string,
): Promise<{
  organizationId: string;
  providerConnectionId: string;
  provider: DeliveryProvider;
  webhookSecret: string;
  webhookUrl: string;
} | null> {
  const [selected] = await databaseFor(controlPool).select({
    id: providerConnectionsTable.id,
    organization_id: providerConnectionsTable.organization_id,
    provider: providerConnectionsTable.provider,
    credential_ciphertext: providerConnectionsTable.credential_ciphertext,
    enabled: providerConnectionsTable.enabled,
  }).from(providerConnectionsTable).where(eq(providerConnectionsTable.id, providerConnectionId)).limit(1);
  const row = selected as ProviderConnectionRow | undefined;
  if (!row?.enabled) return null;
  const credentials = await providerCredentials(row.organization_id, row);
  if (!credentials.webhookSecret) return null;
  return {
    organizationId: row.organization_id,
    providerConnectionId: row.id,
    provider: row.provider,
    webhookSecret: credentials.webhookSecret,
    webhookUrl: deliveryWebhookUrl(row.id),
  };
}

export async function markDeliveryWebhookReceived(
  pool: Pool,
  providerConnectionId: string,
): Promise<void> {
  const organizationId = await scopedOrganizationId(pool);
  await databaseFor(pool).update(providerConnectionsTable).set({
    webhook_status: "receiving",
    webhook_last_received_at: sql`now()`,
    updated_at: sql`now()`,
  }).where(and(
    eq(providerConnectionsTable.id, providerConnectionId),
    eq(providerConnectionsTable.organization_id, organizationId),
  ));
}
