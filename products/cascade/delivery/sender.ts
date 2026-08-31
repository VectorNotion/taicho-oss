import { createLogger } from "@content-automation/observability";

/**
 * Outbound delivery for platform-run automations. One interface, three
 * resolutions: Resend over raw HTTP when configured, a deterministic stub
 * for dev/e2e (CASCADE_DELIVERY_MODE=stub), and null when nothing is
 * configured — the automation pass then drafts and advances nothing,
 * reporting "sender not configured" instead of pretending to send.
 */

const log = createLogger("cascade.delivery");

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
}

export interface CascadeSender {
  /** "resend" or "stub" — surfaced in settings so the UI can say what would send. */
  name: string;
  send(email: OutboundEmail, options?: { idempotencyKey?: string }): Promise<{ providerMessageId: string }>;
}

/** A provider refusal is retryable only when repeating the same idempotency key is safe. */
export class CascadeDeliveryError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message);
    this.name = "CascadeDeliveryError";
  }
}

export function resendSender(
  apiKey: string,
  from: string,
  endpoint = process.env.CASCADE_RESEND_API_URL ?? "https://api.resend.com/emails",
): CascadeSender {
  return {
    name: "resend",
    async send(email, options) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...(options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
          },
          body: JSON.stringify({
            from,
            to: [email.to],
            subject: email.subject,
            text: email.body,
          }),
        });
      } catch {
        throw new CascadeDeliveryError("Email provider is temporarily unavailable.", true);
      }
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
        throw new CascadeDeliveryError(
          retryable
            ? `Email provider is temporarily unavailable (${response.status}).`
            : `Email provider rejected the delivery (${response.status}).`,
          retryable,
          response.status,
        );
      }
      const payload = (await response.json()) as { id?: string };
      return { providerMessageId: payload.id ?? "unknown" };
    },
  };
}

export function stubSender(): CascadeSender {
  return {
    name: "stub",
    async send(email, options) {
      const providerMessageId = `stub-${options?.idempotencyKey ?? crypto.randomUUID()}`;
      log.info("cascade.delivery.stub_send", { to: email.to, subject: email.subject, provider_message_id: providerMessageId });
      return { providerMessageId };
    },
  };
}

/** null means "not configured" — callers must skip sends and say so, never fake them. */
export function resolveCascadeSender(): CascadeSender | null {
  if (process.env.CASCADE_DELIVERY_MODE === "stub") return stubSender();
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CASCADE_FROM_EMAIL;
  if (apiKey && from) return resendSender(apiKey, from);
  return null;
}
