import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attendeeWebhookSignature,
  createAttendeeWorkspaceToken,
  parseAttendeeWorkspaceToken,
  verifyAttendeeWebhook,
} from '../integrations/attendee';

const secret = Buffer.from('attendee-webhook-secret-for-tests-32-bytes').toString('base64');

test('Attendee webhook verification canonicalizes nested object keys', () => {
  const original = {
    trigger: 'transcript.update',
    bot_id: 'bot_123',
    idempotency_key: 'delivery-123',
    data: {
      transcription: { words: [], transcript: 'Hello' },
      speaker_name: 'Rajesh',
      timestamp_ms: 100,
    },
  };
  const reordered = {
    data: {
      timestamp_ms: 100,
      speaker_name: 'Rajesh',
      transcription: { transcript: 'Hello', words: [] },
    },
    idempotency_key: 'delivery-123',
    bot_id: 'bot_123',
    trigger: 'transcript.update',
  };
  const signature = attendeeWebhookSignature(original, secret);
  assert.equal(attendeeWebhookSignature(reordered, secret), signature);
  assert.equal(verifyAttendeeWebhook(reordered, signature, secret), true);
  assert.equal(verifyAttendeeWebhook({ ...reordered, bot_id: 'bot_other' }, signature, secret), false);
});

test('Attendee workspace tokens bind the organization and meeting', () => {
  const target = {
    organizationId: 'workspace_test',
    meetingId: '9be4a2ad-bd99-4622-9e3f-7ff5e4ce7793',
  };
  const token = createAttendeeWorkspaceToken(target, secret);
  assert.deepEqual(parseAttendeeWorkspaceToken(token, secret), target);

  const [payload, signature] = token.split('.');
  assert.equal(parseAttendeeWorkspaceToken(`${payload}.${signature}x`, secret), null);
  assert.equal(parseAttendeeWorkspaceToken(token, Buffer.from('different-secret-that-is-long-enough').toString('base64')), null);
});
