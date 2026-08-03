export const DELIVERY_PROVIDERS = [
  "resend",
  "sendgrid",
  "mailchimp",
] as const;

export type DeliveryProvider = (typeof DELIVERY_PROVIDERS)[number];
export type DeliveryHealthStatus = "unchecked" | "connected" | "error";
export type DeliveryVerificationStatus =
  | "unknown"
  | "pending"
  | "verified"
  | "failed";
export type DeliveryWebhookStatus =
  | "not_configured"
  | "configured"
  | "receiving"
  | "error";

export interface DeliveryCredentials {
  apiKey: string;
  webhookSecret?: string;
}

export interface DeliveryDomainSummary {
  id: string;
  providerConnectionId: string;
  name: string;
  providerDomainId: string | null;
  status: DeliveryVerificationStatus;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
}

export interface SenderIdentitySummary {
  id: string;
  providerConnectionId: string;
  domainId: string;
  name: string;
  email: string;
  status: DeliveryVerificationStatus;
  isDefault: boolean;
}

export interface DeliveryProviderSummary {
  id: string;
  provider: DeliveryProvider;
  displayName: string;
  enabled: boolean;
  isDefault: boolean;
  credentialConfigured: boolean;
  webhookSecretConfigured: boolean;
  healthStatus: DeliveryHealthStatus;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  webhookStatus: DeliveryWebhookStatus;
  webhookConfiguredAt: string | null;
  webhookLastReceivedAt: string | null;
  webhookUrl: string;
}

export interface DeliverySettingsSummary {
  providers: DeliveryProviderSummary[];
  domains: DeliveryDomainSummary[];
  senders: SenderIdentitySummary[];
  defaultProviderId: string | null;
  defaultSenderId: string | null;
}

export interface ResolvedDeliveryConfiguration {
  providerConnectionId: string;
  provider: DeliveryProvider;
  credentials: DeliveryCredentials;
  sender: {
    id: string;
    name: string;
    email: string;
  };
}
