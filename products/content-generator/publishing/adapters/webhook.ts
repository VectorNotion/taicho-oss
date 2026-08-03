import { createHmac } from "node:crypto";
import { publishingRequest, publishingResultUrl } from "../safe-network";
import { PublishError, type DestinationAdapter } from "../types";

export function publishingWebhookSignature(input: {
  secret: string;
  timestamp: string;
  deliveryId: string;
  body: string;
}): string {
  return `v1=${createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.deliveryId}.${input.body}`)
    .digest("hex")}`;
}

/**
 * The universal escape hatch: deliver the post to any receiver as a signed
 * JSON POST. The v1 signature binds the Unix timestamp, stable delivery ID,
 * and raw body under the channel's signing secret. Receivers can enforce a
 * five-minute clock window and deduplicate the delivery ID.
 */
export const webhookAdapter: DestinationAdapter = {
  destination: "webhook",
  credentialKind: "signing_secret",
  refreshable: false,

  async publish({ post, channel, mediaUrl }) {
    const url = channel.credentials.url;
    if (!url) throw new PublishError("Webhook channel is missing credentials.url");
    const secret = channel.credentials.secret;
    if (!secret) throw new PublishError("Webhook channel is missing credentials.secret");

    const payload: Record<string, unknown> = {
      post: {
        id: post.id,
        draftId: post.draftId,
        destination: post.destination,
        copy: post.copy,
        ...(mediaUrl ? { mediaUrl } : {}),
      },
      sentAt: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const deliveryId = post.id;
    const signature = publishingWebhookSignature({
      secret,
      timestamp,
      deliveryId,
      body,
    });

    const res = await publishingRequest(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Publishing-Signature": signature,
        "X-Publishing-Timestamp": timestamp,
        "X-Publishing-Delivery-Id": deliveryId,
      },
      body,
    });

    const text = res.text();
    if (!res.ok) throw new PublishError(`Webhook delivery failed (HTTP_${res.status}).`);

    let resultUrl = url;
    if (text) {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(text) as Record<string, unknown> | null;
      } catch {
        // Non-JSON 2xx body: fall back to the webhook URL as the result.
      }
      if (parsed && typeof parsed.url === "string" && parsed.url.length > 0) {
        resultUrl = publishingResultUrl(parsed.url);
      }
    }
    return { url: publishingResultUrl(resultUrl) };
  },
};
