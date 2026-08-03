import { randomUUID } from "node:crypto";
import { createLogger } from "@content-automation/observability";

export interface OutgoingEmail {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

/** Development transport: logs instead of sending. */
export class LogMailer implements Mailer {
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    this.sent.push(email);
    log.info("cascade.mailer.development_delivery", { delivery_number: this.sent.length });
    return { providerMessageId: `log-${this.sent.length}` };
  }
}

/**
 * Non-production transport used by the browser E2E lane. It exercises the
 * complete queue/compose/retry path without delivering email to a third party.
 * A reserved recipient pattern provides a deterministic transport failure so
 * the five-attempt terminal path is testable without weakening production.
 */
export class DeterministicE2eMailer implements Mailer {
  private delivery = 0;

  async send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    if (email.to.includes("transport-failure")) {
      throw new Error("Deterministic E2E transport failure.");
    }
    this.delivery += 1;
    log.info("cascade.mailer.e2e_delivery", { delivery_number: this.delivery });
    return { providerMessageId: `e2e-${randomUUID()}` };
  }
}

/** Fail-closed production transport used while delivery credentials are deferred. */
export class DisabledMailer implements Mailer {
  constructor(
    private readonly reason =
      "Email delivery is unavailable until Nurture delivery settings are configured.",
  ) {}

  async send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    void email;
    throw new Error(this.reason);
  }
}

/** Resend as pure transport: receives finished HTML only (ADR 0003). */
export class ResendMailer implements Mailer {
  constructor(private readonly opts: { apiKey: string; fetchImpl?: typeof fetch }) {}

  async send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: email.headers,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: delivery failed`);
    const data = (await res.json()) as { id: string };
    return { providerMessageId: data.id };
  }
}

function senderParts(from: string): { email: string; name?: string } {
  const named = from.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  if (!named) return { email: from.trim() };
  const name = named[1].trim().replace(/^"(.*)"$/, "$1");
  return {
    email: named[2].trim(),
    ...(name ? { name } : {}),
  };
}

/** Mailchimp Transactional (Mandrill) as a finished-HTML transport. */
export class MailchimpTransactionalMailer implements Mailer {
  constructor(private readonly opts: { apiKey: string; fetchImpl?: typeof fetch }) {}

  async send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    const f = this.opts.fetchImpl ?? fetch;
    const sender = senderParts(email.from);
    const res = await f(
      "https://mandrillapp.com/api/1.0/messages/send.json",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: this.opts.apiKey,
          message: {
            from_email: sender.email,
            ...(sender.name ? { from_name: sender.name } : {}),
            to: [{ email: email.to, type: "to" }],
            subject: email.subject,
            html: email.html,
            text: email.text,
            headers: email.headers,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      throw new Error(`mailchimp ${res.status}: delivery failed`);
    }
    const data = (await res.json()) as Array<{
      _id?: string;
      status?: string;
      reject_reason?: string | null;
    }>;
    const result = data[0];
    if (
      !result?._id
      || !["sent", "queued", "scheduled"].includes(result.status ?? "")
    ) {
      throw new Error(
        `mailchimp delivery rejected${result?.reject_reason ? `: ${result.reject_reason}` : ""}`,
      );
    }
    return { providerMessageId: result._id };
  }
}

/** Twilio SendGrid as a finished-HTML transport. */
export class SendGridMailer implements Mailer {
  constructor(private readonly opts: { apiKey: string; fetchImpl?: typeof fetch }) {}

  async send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    const f = this.opts.fetchImpl ?? fetch;
    const sender = senderParts(email.from);
    const response = await f("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: email.to }],
            subject: email.subject,
            headers: email.headers,
          },
        ],
        from: {
          email: sender.email,
          ...(sender.name ? { name: sender.name } : {}),
        },
        content: [
          { type: "text/plain", value: email.text },
          { type: "text/html", value: email.html },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`sendgrid ${response.status}: delivery failed`);
    }
    const providerMessageId = response.headers.get("x-message-id");
    if (!providerMessageId) {
      throw new Error("sendgrid delivery did not return a message id");
    }
    return { providerMessageId };
  }
}

export function selectMailer(): Mailer {
  if (process.env.CASCADE_MAILER_MODE === "e2e") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CASCADE_MAILER_MODE=e2e is forbidden in production.");
    }
    return new DeterministicE2eMailer();
  }
  const key = process.env.RESEND_API_KEY;
  if (key) return new ResendMailer({ apiKey: key });
  return process.env.NODE_ENV === "production"
    ? new DisabledMailer()
    : new LogMailer();
}

const log = createLogger("cascade.mailer");
