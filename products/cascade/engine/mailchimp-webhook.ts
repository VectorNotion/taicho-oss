import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface MailchimpWebhookEvent {
  event?: string;
  ts?: number;
  _id?: string;
  msg?: {
    _id?: string;
  };
}

function signaturePayload(url: string, fields: URLSearchParams): string {
  const values = [...fields.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `${url}${values.map(([key, value]) => `${key}${value}`).join("")}`;
}

export function signMailchimpWebhook(input: {
  secret: string;
  url: string;
  fields: URLSearchParams;
}): string {
  return createHmac("sha1", input.secret)
    .update(signaturePayload(input.url, input.fields))
    .digest("base64");
}

export function verifyMailchimpWebhook(input: {
  secret: string;
  url: string;
  fields: URLSearchParams;
  signature?: string;
}): boolean {
  if (!input.signature) return false;
  const expected = Buffer.from(
    signMailchimpWebhook({
      secret: input.secret,
      url: input.url,
      fields: input.fields,
    }),
  );
  const received = Buffer.from(input.signature);
  return (
    expected.length === received.length
    && timingSafeEqual(expected, received)
  );
}

export function parseMailchimpWebhookEvents(
  fields: URLSearchParams,
): MailchimpWebhookEvent[] {
  const raw = fields.get("mandrill_events");
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Mailchimp webhook event batch must be an array.");
  }
  return parsed.filter(
    (event): event is MailchimpWebhookEvent =>
      Boolean(event) && typeof event === "object" && !Array.isArray(event),
  );
}

export function normalizeMailchimpWebhookEvent(
  event: MailchimpWebhookEvent,
): { type: string; providerMessageId: string; receiptId: string } | null {
  const providerMessageId = event.msg?._id ?? event._id;
  if (!providerMessageId || !event.event) return null;
  const mapped = {
    send: "email.delivered",
    hard_bounce: "email.bounced",
    reject: "email.bounced",
    spam: "email.complained",
    open: "email.opened",
    click: "email.clicked",
  }[event.event];
  if (!mapped) return null;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(event))
    .digest("hex");
  return {
    type: mapped,
    providerMessageId,
    receiptId: `mailchimp:${fingerprint}`,
  };
}
