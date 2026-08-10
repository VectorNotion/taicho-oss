import assert from 'node:assert/strict';
import test from 'node:test';
import { attentionProjectionForEvent } from '../intelligence/event-policy';

function event(name: string, input: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    organizationId: 'org-1',
    name: name as never,
    eventVersion: 1,
    source: 'product' as const,
    origin: 'external_connector' as const,
    connectorId: 'hubspot',
    externalEventId: 'delivery-1',
    payload: input,
    prospectId: 'prospect-1',
    contentId: null,
    postId: null,
    sendId: null,
  };
}

test('new prospects become explicit human attention decisions', () => {
  const projection = attentionProjectionForEvent(event('prospect.created', {
    name: 'Aisha',
    company: 'Northstar',
  }));
  assert.equal(projection?.entityId, 'prospect-1');
  assert.equal(projection?.suggestedAction.workflow, 'prospect_intelligence');
  assert.deepEqual(projection?.suggestedAction.input, { prospectId: 'prospect-1' });
  assert.match(projection?.suggestedAction.prompt ?? '', /\{\{attentionItemId\}\}/);
});

test('internal UI and system events never become assistant notifications', () => {
  assert.equal(attentionProjectionForEvent({
    ...event('prospect.created', { name: 'Aisha' }),
    origin: 'internal',
    connectorId: null,
    externalEventId: null,
  }), null);
});

test('qualified prospects suggest an artifact, while routine telemetry stays silent', () => {
  const projection = attentionProjectionForEvent(event('prospect.qualified', { score: 84 }));
  assert.equal(projection?.priority, 'high');
  assert.equal(projection?.suggestedAction.workflow, 'outreach_intelligence');
  assert.equal(attentionProjectionForEvent(event('post.metrics.updated')), null);
});

test('external content angles become optional content-intelligence prompts', () => {
  const projection = attentionProjectionForEvent({
    ...event('content.angle.emerged', {
      title: 'The quiet automation tax',
      summary: 'Teams are measuring maintenance overhead.',
      confidence: 0.91,
    }),
    prospectId: null,
    contentId: 'angle-1',
  });
  assert.equal(projection?.category, 'content_insights');
  assert.equal(projection?.priority, 'high');
  assert.equal(projection?.suggestedAction.workflow, 'content_intelligence');
});
