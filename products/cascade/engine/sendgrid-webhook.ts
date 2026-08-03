import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";

const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

export interface SendGridWebhookEvent {
  event?: string;
  sg_event_id?: string;
  sg_message_id?: string;
}

function verificationKey(value: string) {
  if (value.includes("BEGIN PUBLIC KEY")) return createPublicKey(value);
  return createPublicKey({
    key: Buffer.from(value, "base64"),
    format: "der",
    type: "spki",
  });
}

export function verifySendGridWebhook(input: {
  publicKey: string;
  body: string;
  signature?: string;
  timestamp?: string;
  nowSeconds?: number;
}): boolean {
  if (!input.signature || !input.timestamp) return false;
  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (
    !Number.isInteger(timestamp)
    || Math.abs(now - timestamp) > MAX_SIGNATURE_AGE_SECONDS
  ) {
    return false;
  }
  try {
    return verifySignature(
      "sha256",
      Buffer.from(`${input.timestamp}${input.body}`, "utf8"),
      verificationKey(input.publicKey),
      Buffer.from(input.signature, "base64"),
    );
  } catch {
    return false;
  }
}

export function parseSendGridWebhookEvents(
  body: string,
): SendGridWebhookEvent[] {
  const parsed = JSON.parse(body || "[]") as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("SendGrid webhook event batch must be an array.");
  }
  return parsed.filter(
    (event): event is SendGridWebhookEvent =>
      Boolean(event) && typeof event === "object" && !Array.isArray(event),
  );
}

export function normalizeSendGridWebhookEvent(
  event: SendGridWebhookEvent,
): { type: string; providerMessageId: string; receiptId: string } | null {
  if (!event.event || !event.sg_message_id) return null;
  const mapped = {
    delivered: "email.delivered",
    bounce: "email.bounced",
    dropped: "email.bounced",
    spamreport: "email.complained",
    open: "email.opened",
    click: "email.clicked",
  }[event.event];
  if (!mapped) return null;
  const providerMessageId = event.sg_message_id.replace(/\.filter.*$/i, "");
  const fingerprint =
    event.sg_event_id
    ?? createHash("sha256").update(JSON.stringify(event)).digest("hex");
  return {
    type: mapped,
    providerMessageId,
    receiptId: `sendgrid:${fingerprint}`,
  };
}
