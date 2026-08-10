import assert from 'node:assert/strict';
import test from 'node:test';
import { prospectInsightSourceTarget } from '../domain/prospect-intelligence';

test('transcript citations retain the exact evidence, meeting, and offset target', () => {
  assert.deepEqual(prospectInsightSourceTarget({
    id: 'utterance-123',
    type: 'transcript_utterance',
    meetingId: 'meeting-456',
    offsetMs: 72_000,
  }), {
    tab: 'transcription',
    anchorId: 'evidence-utterance-123',
    recordId: 'utterance-123',
    meetingId: 'meeting-456',
    offsetMs: 72_000,
  });
});

test('manual updates and rich notes resolve to distinct Notes anchors', () => {
  assert.deepEqual(prospectInsightSourceTarget({ id: 'update-123', type: 'manual_update' }), {
    tab: 'notes',
    anchorId: 'evidence-update-123',
    recordId: 'update-123',
  });
  assert.deepEqual(prospectInsightSourceTarget({ id: 'note:note-456', type: 'note' }), {
    tab: 'notes',
    anchorId: 'note-note-456',
    recordId: 'note-456',
  });
});
