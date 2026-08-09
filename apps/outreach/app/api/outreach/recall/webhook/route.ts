import { createLogger } from '@content-automation/observability';
import { readBoundedRequestText, RequestBodyTooLargeError } from '@content-automation/platform/network/request-body';
import { setLeadMeetingStatus } from '@/products/outreach/data/lead-intelligence-repository';
import {
  getRecallBotWorkspaceToken,
  parseRecallWorkspaceToken,
  recallConfig,
  recallWebhookBotId,
  recallWebhookPayloadSchema,
  recallWebhookTranscriptId,
  recallWorkspaceTokenFromWebhook,
  verifyRecallWebhook,
} from '@/products/outreach/integrations/recall';
import {
  finalizeRecallMeetingCapture,
  receiveRecallWebhook,
} from '@/products/outreach/services/lead-meeting-service';
import { after, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 600;
const MAX_WEBHOOK_BYTES = 1024 * 1024;
const log = createLogger('outreach.recall-webhook');

function recallHeader(request: NextRequest, current: string, legacy: string): string | null {
  return request.headers.get(current) ?? request.headers.get(legacy);
}

export async function POST(request: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await readBoundedRequestText(request, MAX_WEBHOOK_BYTES);
  } catch (error) {
    return Response.json(
      { error: error instanceof RequestBodyTooLargeError ? 'Webhook payload is too large.' : 'Invalid webhook payload.' },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  let config;
  try {
    config = recallConfig();
  } catch {
    return Response.json({ error: 'Recall webhook is not configured.' }, { status: 503 });
  }
  const webhookId = recallHeader(request, 'webhook-id', 'svix-id');
  if (!verifyRecallWebhook({
    body: rawBody,
    webhookId,
    timestamp: recallHeader(request, 'webhook-timestamp', 'svix-timestamp'),
    signature: recallHeader(request, 'webhook-signature', 'svix-signature'),
    secret: config.webhookSecret,
  })) {
    return Response.json({ error: 'Invalid or expired webhook signature.' }, { status: 401 });
  }
  let payloadValue: unknown;
  try {
    payloadValue = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'Invalid webhook payload.' }, { status: 400 });
  }
  const parsed = recallWebhookPayloadSchema.safeParse(payloadValue);
  if (!parsed.success || !webhookId) {
    return Response.json({ error: 'Invalid webhook payload.' }, { status: 400 });
  }
  const botId = recallWebhookBotId(parsed.data);
  if (!botId) return Response.json({ error: 'Webhook bot is missing.' }, { status: 400 });
  const transcriptId = parsed.data.event === 'transcript.done'
    ? recallWebhookTranscriptId(parsed.data)
    : null;
  if (parsed.data.event === 'transcript.done' && !transcriptId) {
    return Response.json({ error: 'Webhook transcript is missing.' }, { status: 400 });
  }

  let workspaceToken = recallWorkspaceTokenFromWebhook(parsed.data);
  if (!workspaceToken) {
    try {
      workspaceToken = await getRecallBotWorkspaceToken(botId);
    } catch (error) {
      log.error('outreach.recall.bot_metadata_lookup_failed', error, { bot_id: botId });
      return Response.json({ error: 'Webhook target is temporarily unavailable.' }, { status: 503 });
    }
  }
  const workspace = workspaceToken
    ? parseRecallWorkspaceToken(workspaceToken, config.webhookSecret)
    : null;
  if (!workspace) return Response.json({ error: 'Invalid webhook target.' }, { status: 401 });

  const received = await receiveRecallWebhook({
    ...workspace,
    providerBotId: botId,
    providerDeliveryId: webhookId,
    payload: parsed.data,
  });
  if (!received.meeting) return Response.json({ error: 'Meeting not found.' }, { status: 404 });

  if (transcriptId && (!received.duplicate || received.meeting.status === 'failed')) {
    after(() => finalizeRecallMeetingCapture({
      ...workspace,
      transcriptId,
      meetingEventId: received.event?.id,
    }).catch(async (error) => {
      log.error('outreach.recall.finalization_failed', error, {
        meeting_id: workspace.meetingId,
        transcript_id: transcriptId,
      });
      await setLeadMeetingStatus({
        organizationId: workspace.organizationId,
        meetingId: workspace.meetingId,
        status: 'failed',
        detail: 'Recall transcript ingestion failed. Redeliver the transcript webhook to retry.',
      }).catch(() => undefined);
    }));
  }
  return Response.json({ accepted: true, duplicate: received.duplicate }, { status: 202 });
}
