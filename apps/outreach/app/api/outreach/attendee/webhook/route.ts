import { createLogger, observeOperation } from '@content-automation/observability';
import { readBoundedRequestText, RequestBodyTooLargeError } from '@content-automation/platform/network/request-body';
import {
  attendeeConfig,
  attendeeWebhookPayloadSchema,
  parseAttendeeWorkspaceToken,
  verifyAttendeeWebhook,
} from '@/products/outreach/integrations/attendee';
import {
  attendeePostProcessingCompleted,
  finalizeMeetingCapture,
  receiveAttendeeWebhook,
} from '@/products/outreach/services/prospect-meeting-service';
import { after, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 600;
const MAX_WEBHOOK_BYTES = 1024 * 1024;
const log = createLogger('outreach.attendee-webhook');

export async function POST(request: NextRequest) {
  // Root span for the inbound event: signature checks and all downstream
  // work parent under it, so third-party deliveries are traceable end to end.
  return observeOperation('webhook.attendee.receive', {
    headers: request.headers,
    actorType: 'system',
  }, () => handleWebhook(request));
}

async function handleWebhook(request: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await readBoundedRequestText(request, MAX_WEBHOOK_BYTES);
  } catch (error) {
    return Response.json(
      { error: error instanceof RequestBodyTooLargeError ? 'Webhook payload is too large.' : 'Invalid webhook payload.' },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  let payloadValue: unknown;
  try {
    payloadValue = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'Invalid webhook payload.' }, { status: 400 });
  }
  let config;
  try {
    config = attendeeConfig();
  } catch {
    return Response.json({ error: 'Meeting webhook is not configured.' }, { status: 503 });
  }
  if (!verifyAttendeeWebhook(
    payloadValue,
    request.headers.get('x-webhook-signature'),
    config.webhookSecret,
  )) {
    return Response.json({ error: 'Invalid webhook signature.' }, { status: 401 });
  }
  const parsed = attendeeWebhookPayloadSchema.safeParse(payloadValue);
  if (!parsed.success) return Response.json({ error: 'Invalid webhook payload.' }, { status: 400 });
  const workspace = parseAttendeeWorkspaceToken(
    request.nextUrl.searchParams.get('workspace') ?? '',
    config.webhookSecret,
  );
  if (!workspace) return Response.json({ error: 'Invalid webhook target.' }, { status: 401 });

  const received = await receiveAttendeeWebhook({
    organizationId: workspace.organizationId,
    meetingId: workspace.meetingId,
    payload: parsed.data,
  });
  if (!received.meeting) return Response.json({ error: 'Meeting not found.' }, { status: 404 });
  if (!received.duplicate && attendeePostProcessingCompleted(parsed.data)) {
    after(() => finalizeMeetingCapture(workspace).catch((error) => {
      log.error('outreach.attendee.finalization_failed', error, { meeting_id: workspace.meetingId });
    }));
  }
  return Response.json({ accepted: true, duplicate: received.duplicate }, { status: 202 });
}
