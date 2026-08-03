import type {
  DeliveryCredentials,
  DeliveryProvider,
  DeliveryVerificationStatus,
} from "./types";

export interface ProviderDomainState {
  providerDomainId: string | null;
  status: DeliveryVerificationStatus;
}

export interface DeliveryProviderClient {
  checkConnection(): Promise<void>;
  configureDomain(domain: string): Promise<ProviderDomainState>;
  checkDomain(
    domain: string,
    providerDomainId?: string | null,
  ): Promise<ProviderDomainState>;
  configureWebhook?(
    endpoint: string,
  ): Promise<{ verificationSecret: string }>;
}

class ProviderRequestError extends Error {
  constructor(
    readonly provider: DeliveryProvider,
    readonly status: number,
  ) {
    super(`${provider} request failed with status ${status}.`);
    this.name = "ProviderRequestError";
  }
}

async function responseJson<T>(
  provider: DeliveryProvider,
  response: Response,
): Promise<T> {
  if (!response.ok) throw new ProviderRequestError(provider, response.status);
  return response.json() as Promise<T>;
}

type ResendDomain = {
  id: string;
  name: string;
  status: string;
};

function resendStatus(status: string): DeliveryVerificationStatus {
  if (status === "verified") return "verified";
  if (status === "failed") return "failed";
  if (status === "pending" || status === "not_started") return "pending";
  return "unknown";
}

class ResendProviderClient implements DeliveryProviderClient {
  constructor(
    private readonly credentials: DeliveryCredentials,
    private readonly fetchImpl: typeof fetch,
  ) {}

  private request(path: string, init: RequestInit = {}) {
    return this.fetchImpl(`https://api.resend.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.credentials.apiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
  }

  private async domains(): Promise<ResendDomain[]> {
    const response = await this.request("/domains");
    const body = await responseJson<
      { data?: ResendDomain[] } | ResendDomain[]
    >("resend", response);
    return Array.isArray(body) ? body : body.data ?? [];
  }

  async checkConnection(): Promise<void> {
    await this.domains();
  }

  async configureDomain(domain: string): Promise<ProviderDomainState> {
    const existing = (await this.domains()).find(
      (candidate) => candidate.name.toLowerCase() === domain.toLowerCase(),
    );
    if (existing) {
      return {
        providerDomainId: existing.id,
        status: resendStatus(existing.status),
      };
    }
    const response = await this.request("/domains", {
      method: "POST",
      body: JSON.stringify({ name: domain }),
    });
    const created = await responseJson<ResendDomain>("resend", response);
    return {
      providerDomainId: created.id,
      status: resendStatus(created.status),
    };
  }

  async checkDomain(
    domain: string,
    providerDomainId?: string | null,
  ): Promise<ProviderDomainState> {
    const match = (await this.domains()).find(
      (candidate) =>
        (providerDomainId && candidate.id === providerDomainId)
        || candidate.name.toLowerCase() === domain.toLowerCase(),
    );
    return match
      ? {
          providerDomainId: match.id,
          status: resendStatus(match.status),
        }
      : { providerDomainId: null, status: "unknown" };
  }

  async configureWebhook(
    endpoint: string,
  ): Promise<{ verificationSecret: string }> {
    const response = await this.request("/webhooks", {
      method: "POST",
      body: JSON.stringify({
        endpoint,
        events: [
          "email.sent",
          "email.delivered",
          "email.bounced",
          "email.complained",
          "email.opened",
          "email.clicked",
        ],
      }),
    });
    const created = await responseJson<{ signing_secret?: string }>(
      "resend",
      response,
    );
    if (!created.signing_secret) {
      throw new Error("Resend did not return a webhook signing secret.");
    }
    return { verificationSecret: created.signing_secret };
  }
}

type MailchimpDomain = {
  domain?: string;
  spf?: { valid?: boolean };
  dkim?: { valid?: boolean };
  dkim2?: { valid?: boolean };
  verified_at?: string | null;
  valid_signing?: boolean;
};

function mailchimpStatus(domain: MailchimpDomain): DeliveryVerificationStatus {
  if (
    domain.verified_at
    && domain.valid_signing !== false
    && (domain.dkim?.valid || domain.dkim2?.valid)
    && domain.spf?.valid
  ) {
    return "verified";
  }
  if (
    domain.spf?.valid === false
    || (domain.dkim?.valid === false && domain.dkim2?.valid === false)
  ) {
    return "pending";
  }
  return domain.verified_at ? "verified" : "pending";
}

class MailchimpProviderClient implements DeliveryProviderClient {
  constructor(
    private readonly credentials: DeliveryCredentials,
    private readonly fetchImpl: typeof fetch,
  ) {}

  private async post<T>(
    path: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    const response = await this.fetchImpl(
      `https://mandrillapp.com/api/1.0${path}.json`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: this.credentials.apiKey, ...payload }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    return responseJson<T>("mailchimp", response);
  }

  async checkConnection(): Promise<void> {
    const pong = await this.post<string>("/users/ping");
    if (pong !== "PONG!") throw new Error("Mailchimp credential check failed.");
  }

  async configureDomain(domain: string): Promise<ProviderDomainState> {
    const domains = await this.post<MailchimpDomain[]>("/senders/domains");
    if (
      !domains.some(
        (candidate) => candidate.domain?.toLowerCase() === domain.toLowerCase(),
      )
    ) {
      await this.post<MailchimpDomain>("/senders/add-domain", { domain });
    }
    return this.checkDomain(domain);
  }

  async checkDomain(domain: string): Promise<ProviderDomainState> {
    const state = await this.post<MailchimpDomain>(
      "/senders/check-domain",
      { domain },
    );
    return {
      providerDomainId: state.domain ?? domain,
      status: mailchimpStatus(state),
    };
  }

  async configureWebhook(
    endpoint: string,
  ): Promise<{ verificationSecret: string }> {
    const created = await this.post<{ auth_key?: string }>("/webhooks/add", {
      url: endpoint,
      description: "Nurture delivery events",
      events: ["send", "hard_bounce", "reject", "spam", "open", "click"],
    });
    if (!created.auth_key) {
      throw new Error(
        "Mailchimp Transactional did not return a webhook authentication key.",
      );
    }
    return { verificationSecret: created.auth_key };
  }
}

type SendGridDomain = {
  id?: number;
  domain?: string;
  valid?: boolean;
};

type SendGridWebhook = {
  id?: string;
  url?: string;
  public_key?: string;
};

class SendGridProviderClient implements DeliveryProviderClient {
  constructor(
    private readonly credentials: DeliveryCredentials,
    private readonly fetchImpl: typeof fetch,
  ) {}

  private request(path: string, init: RequestInit = {}) {
    return this.fetchImpl(`https://api.sendgrid.com/v3${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.credentials.apiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
  }

  private async domains(): Promise<SendGridDomain[]> {
    const response = await this.request("/whitelabel/domains");
    return responseJson<SendGridDomain[]>("sendgrid", response);
  }

  async checkConnection(): Promise<void> {
    const response = await this.request("/scopes");
    await responseJson<{ scopes?: string[] }>("sendgrid", response);
  }

  async configureDomain(domain: string): Promise<ProviderDomainState> {
    const existing = (await this.domains()).find(
      (candidate) => candidate.domain?.toLowerCase() === domain.toLowerCase(),
    );
    if (existing) {
      return {
        providerDomainId:
          existing.id === undefined ? null : String(existing.id),
        status: existing.valid ? "verified" : "pending",
      };
    }
    const response = await this.request("/whitelabel/domains", {
      method: "POST",
      body: JSON.stringify({
        domain,
        automatic_security: true,
      }),
    });
    const created = await responseJson<SendGridDomain>("sendgrid", response);
    return {
      providerDomainId:
        created.id === undefined ? null : String(created.id),
      status: created.valid ? "verified" : "pending",
    };
  }

  async checkDomain(
    domain: string,
    providerDomainId?: string | null,
  ): Promise<ProviderDomainState> {
    if (providerDomainId && /^\d+$/.test(providerDomainId)) {
      const response = await this.request(
        `/whitelabel/domains/${providerDomainId}`,
      );
      const state = await responseJson<SendGridDomain>("sendgrid", response);
      return {
        providerDomainId,
        status: state.valid ? "verified" : "pending",
      };
    }
    const state = (await this.domains()).find(
      (candidate) => candidate.domain?.toLowerCase() === domain.toLowerCase(),
    );
    return state
      ? {
          providerDomainId:
            state.id === undefined ? null : String(state.id),
          status: state.valid ? "verified" : "pending",
        }
      : { providerDomainId: null, status: "unknown" };
  }

  async configureWebhook(
    endpoint: string,
  ): Promise<{ verificationSecret: string }> {
    const listResponse = await this.request(
      "/user/webhooks/event/settings/all",
    );
    const webhooks = await responseJson<SendGridWebhook[]>(
      "sendgrid",
      listResponse,
    );
    let webhook = webhooks.find((candidate) => candidate.url === endpoint);
    if (!webhook) {
      const createResponse = await this.request(
        "/user/webhooks/event/settings",
        {
          method: "POST",
          body: JSON.stringify({
            enabled: true,
            url: endpoint,
            delivered: true,
            bounce: true,
            dropped: true,
            spam_report: true,
            open: true,
            click: true,
            friendly_name: "Nurture delivery events",
          }),
        },
      );
      webhook = await responseJson<SendGridWebhook>(
        "sendgrid",
        createResponse,
      );
    }
    if (!webhook.id) {
      throw new Error("SendGrid did not return an event webhook ID.");
    }
    if (webhook.public_key) {
      return { verificationSecret: webhook.public_key };
    }
    const signingResponse = await this.request(
      `/user/webhooks/event/settings/signed/${webhook.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      },
    );
    const signing = await responseJson<{ public_key?: string }>(
      "sendgrid",
      signingResponse,
    );
    if (!signing.public_key) {
      throw new Error("SendGrid did not return an event verification key.");
    }
    return { verificationSecret: signing.public_key };
  }
}

export function createDeliveryProviderClient(
  provider: DeliveryProvider,
  credentials: DeliveryCredentials,
  fetchImpl: typeof fetch = fetch,
): DeliveryProviderClient {
  if (provider === "resend") {
    return new ResendProviderClient(credentials, fetchImpl);
  }
  if (provider === "sendgrid") {
    return new SendGridProviderClient(credentials, fetchImpl);
  }
  return new MailchimpProviderClient(credentials, fetchImpl);
}

export function deliveryProviderErrorCode(error: unknown): string {
  if (error instanceof ProviderRequestError) {
    if (error.status === 401 || error.status === 403) {
      return "invalid_credentials";
    }
    if (error.status === 429) return "rate_limited";
    return "provider_unavailable";
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "connection_timeout";
  }
  return "connection_failed";
}
