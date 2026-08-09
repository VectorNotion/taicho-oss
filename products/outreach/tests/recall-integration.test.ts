import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRecallBot,
  createRecallWorkspaceToken,
  parseRecallWorkspaceToken,
  recallTranscriptInput,
  recallWebhookBotId,
  recallWebhookSignature,
  recallWebhookTranscriptId,
  recallWorkspaceTokenFromWebhook,
  verifyRecallWebhook,
  type RecallWebhookPayload,
} from '../integrations/recall';

const secret = `whsec_${Buffer.from('recall-webhook-secret-for-tests-32-bytes').toString('base64')}`;

test('Recall bot creation requests transcription and signed workspace metadata', async (context) => {
  const previousFetch = globalThis.fetch;
  const previousApiKey = process.env.RECALL_API_KEY;
  const previousRegion = process.env.RECALL_REGION;
  const previousWebhookSecret = process.env.RECALL_WEBHOOK_SECRET;
  process.env.RECALL_API_KEY = 'recall-api-key-for-tests';
  process.env.RECALL_REGION = 'us-east-1';
  process.env.RECALL_WEBHOOK_SECRET = secret;
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
      bot: { id: 'bot_123', metadata: { taicho_workspace: token } },
      transcript: { id: 'transcript_123', metadata: {} },
    },
  };
  assert.deepEqual(parseRecallWorkspaceToken(token, secret), workspace);
  assert.equal(recallWorkspaceTokenFromWebhook(payload), token);
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
