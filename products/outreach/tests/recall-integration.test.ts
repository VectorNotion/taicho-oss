import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRecallBot,
  createRecallWorkspaceToken,
  parseRecallWorkspaceToken,
  recallTranscriptInput,
  recallTargetFromWebhook,
  recallWebhookBotId,
  recallWebhookSignature,
  recallWebhookTargetsEnvironment,
  recallWebhookTranscriptId,
  recallWorkspaceTokenFromWebhook,
  verifyRecallWebhook,
  type RecallWebhookPayload,
} from '../integrations/recall';
import { recallMeetingStatusFromWebhook } from '../services/lead-meeting-service';

const secret = `whsec_${Buffer.from('recall-webhook-secret-for-tests-32-bytes').toString('base64')}`;

test('Recall bot creation requests transcription and signed workspace metadata', async (context) => {
  const previousFetch = globalThis.fetch;
  const previousApiKey = process.env.RECALL_API_KEY;
  const previousRegion = process.env.RECALL_REGION;
  const previousWebhookSecret = process.env.RECALL_WEBHOOK_SECRET;
  const previousPublicAppUrl = process.env.PUBLIC_APP_URL;
  process.env.RECALL_API_KEY = 'recall-api-key-for-tests';
  process.env.RECALL_REGION = 'us-east-1';
  process.env.RECALL_WEBHOOK_SECRET = secret;
  process.env.PUBLIC_APP_URL = 'https://cloud-dev.taicho.test';
  let captured: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init };
    return Response.json({ id: 'bot_123' });
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.RECALL_API_KEY;
    else process.env.RECALL_API_KEY = previousApiKey;
    if (previousRegion === undefined) delete process.env.RECALL_REGION;
    else process.env.RECALL_REGION = previousRegion;
    if (previousWebhookSecret === undefined) delete process.env.RECALL_WEBHOOK_SECRET;
    else process.env.RECALL_WEBHOOK_SECRET = previousWebhookSecret;
    if (previousPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previousPublicAppUrl;
  });

  const created = await createRecallBot({
    organizationId: 'workspace_test',
    meetingId: '9be4a2ad-bd99-4622-9e3f-7ff5e4ce7793',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    botName: 'Taicho · Test lead',
  });
  assert.equal(created.id, 'bot_123');
  assert.equal(captured?.url, 'https://us-east-1.recall.ai/api/v1/bot/');
  assert.equal(captured?.init?.method, 'POST');
  assert.equal(new Headers(captured?.init?.headers).get('Authorization'), 'recall-api-key-for-tests');
  const body = JSON.parse(String(captured?.init?.body)) as Record<string, unknown>;
  assert.equal(body.meeting_url, 'https://meet.google.com/abc-defg-hij');
  assert.equal(body.bot_name, 'Taicho · Test lead');
  const metadata = body.metadata as Record<string, unknown>;
  assert.equal(metadata.taicho_environment, 'https://cloud-dev.taicho.test');
  assert.deepEqual(parseRecallWorkspaceToken(String(metadata.taicho_workspace), secret), {
    organizationId: 'workspace_test',
    meetingId: '9be4a2ad-bd99-4622-9e3f-7ff5e4ce7793',
  });
  assert.deepEqual(body.recording_config, {
    transcript: {
      provider: {
        recallai_streaming: {
          mode: 'prioritize_accuracy',
          language_code: 'auto',
        },
      },
      diarization: { use_separate_streams_when_available: true },
    },
  });
});

test('Recall webhook signatures bind the delivery ID, timestamp, and raw body', () => {
  const body = JSON.stringify({ event: 'bot.status_change', data: { bot_id: 'bot_123' } });
  const timestamp = '1800000000';
  const signature = recallWebhookSignature({ body, webhookId: 'delivery_123', timestamp, secret });
  assert.equal(verifyRecallWebhook({
    body,
    webhookId: 'delivery_123',
    timestamp,
    signature: `v1,older-signature v1,${signature}`,
    secret,
    nowSeconds: 1800000000,
  }), true);
  assert.equal(verifyRecallWebhook({
    body: `${body} `,
    webhookId: 'delivery_123',
    timestamp,
    signature: `v1,${signature}`,
    secret,
    nowSeconds: 1800000000,
  }), false);
  assert.equal(verifyRecallWebhook({
    body,
    webhookId: 'delivery_123',
    timestamp,
    signature: `v1,${signature}`,
    secret,
    nowSeconds: 1800000301,
  }), false);
});

test('Recall workspace metadata is signed and recoverable from transcript webhooks', () => {
  const workspace = {
    organizationId: 'workspace_test',
    meetingId: '9be4a2ad-bd99-4622-9e3f-7ff5e4ce7793',
  };
  const token = createRecallWorkspaceToken(workspace, secret);
  const payload: RecallWebhookPayload = {
    event: 'transcript.done',
    data: {
      bot: {
        id: 'bot_123',
        metadata: {
          taicho_workspace: token,
          taicho_environment: 'https://cloud-dev.taicho.ai',
        },
      },
      transcript: { id: 'transcript_123', metadata: {} },
    },
  };
  assert.deepEqual(parseRecallWorkspaceToken(token, secret), workspace);
  assert.equal(recallWorkspaceTokenFromWebhook(payload), token);
  assert.deepEqual(recallTargetFromWebhook(payload), {
    workspaceToken: token,
    environment: 'https://cloud-dev.taicho.ai',
  });
  assert.equal(recallWebhookTargetsEnvironment(recallTargetFromWebhook(payload), 'https://cloud-dev.taicho.ai'), true);
  assert.equal(recallWebhookTargetsEnvironment(recallTargetFromWebhook(payload), 'https://cloud.taicho.ai'), false);
  assert.equal(recallWebhookTargetsEnvironment({ workspaceToken: token, environment: null }, 'https://cloud.taicho.ai'), true);
  assert.equal(recallWebhookBotId(payload), 'bot_123');
  assert.equal(recallWebhookTranscriptId(payload), 'transcript_123');
  assert.equal(parseRecallWorkspaceToken(`${token}tampered`, secret), null);
});

test('Recall transcript segments retain speaker attribution and timestamps', () => {
  const input = recallTranscriptInput({
    participant: {
      id: 42,
      name: 'Rajesh',
      is_host: true,
      platform: 'zoom',
    },
    words: [
      {
        text: 'Hello',
        start_timestamp: { relative: 1.25, absolute: '2026-08-09T10:00:01.250Z' },
        end_timestamp: { relative: 1.6, absolute: '2026-08-09T10:00:01.600Z' },
      },
      {
        text: 'there.',
        start_timestamp: { relative: 1.61, absolute: '2026-08-09T10:00:01.610Z' },
        end_timestamp: { relative: 2, absolute: '2026-08-09T10:00:02.000Z' },
      },
    ],
  });
  assert.equal(input.content, 'Hello there.');
  assert.equal(input.speakerExternalId, '42');
  assert.equal(input.speakerIsHost, true);
  assert.equal(input.offsetMs, 1250);
  assert.equal(input.durationMs, 750);
  assert.equal(input.occurredAt, '2026-08-09T10:00:01.250Z');
  assert.match(input.sourceKey, /^recall:42:1250:/);
});

test('current Recall bot lifecycle events map to lead meeting status', () => {
  const occurredAt = '2026-08-09T12:33:48.000Z';
  const payload = (event: string, subCode: string | null = null): RecallWebhookPayload => ({
    event,
    data: {
      data: { code: event.slice('bot.'.length), sub_code: subCode, updated_at: occurredAt },
      bot: { id: 'bot_123', metadata: {} },
    },
  });

  assert.deepEqual(recallMeetingStatusFromWebhook(payload('bot.joining_call')), {
    status: 'joining', detail: 'joining_call', occurredAt,
  });
  assert.deepEqual(recallMeetingStatusFromWebhook(payload('bot.in_call_recording')), {
    status: 'in_meeting', detail: 'in_call_recording', occurredAt,
  });
  assert.deepEqual(recallMeetingStatusFromWebhook(payload('bot.done')), {
    status: 'post_processing', detail: 'done', occurredAt,
  });
  assert.deepEqual(recallMeetingStatusFromWebhook(payload('bot.fatal', 'meeting_not_found')), {
    status: 'failed', detail: 'meeting_not_found', occurredAt,
  });
});
