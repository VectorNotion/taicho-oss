import { verifyFalWebhook, type FalWebhookPayload } from "@content-automation/content-generator/media/fal-provider";
import { receiveFalWebhook } from "@content-automation/content-generator/media/service";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@content-automation/platform/network/request-body";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await readBoundedRequestText(request, MAX_WEBHOOK_BYTES);
  } catch (error) {
    return Response.json(
      { error: error instanceof RequestBodyTooLargeError ? "Webhook payload is too large." : "Invalid webhook payload." },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  let verified = false;
  try {
    verified = await verifyFalWebhook({ rawBody, headers: request.headers });
  } catch {
    return Response.json({ error: "Webhook verification is temporarily unavailable." }, { status: 503 });
  }
  if (!verified) return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  let payload: FalWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as FalWebhookPayload;
  } catch {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  if (
    !payload
    || typeof payload.request_id !== "string"
    || (payload.status !== "OK" && payload.status !== "ERROR")
  ) {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  const found = await receiveFalWebhook(payload);
  return found
    ? Response.json({ accepted: true }, { status: 202 })
    : Response.json({ error: "Generation run not found." }, { status: 404 });
}
