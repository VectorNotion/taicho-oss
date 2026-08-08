import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLeadKnowledgeSources,
  leadSemanticSearchConfigFromEnvironment,
} from '../services/lead-semantic-search';
import type { LeadEvidence } from '../domain/lead-intelligence';
import type { Lead, LeadActivity, LeadNote, OutreachMessage } from '../domain/types';

test('semantic search defaults to the configured OpenRouter key without an OpenAI dependency', () => {
  const config = leadSemanticSearchConfigFromEnvironment({
    OPENROUTER_API_KEY: 'test-openrouter-key',
  });
  assert.deepEqual(config, {
    embeddingUrl: 'https://openrouter.ai/api/v1/embeddings',
    embeddingApiKey: 'test-openrouter-key',
    embeddingModel: 'nvidia/nemotron-3-embed-1b:free',
    embeddingDimensions: 2_048,
    queryInputType: 'query',
    documentInputType: 'passage',
  });
});

test('semantic search accepts a self-hosted compatible endpoint without a credential', () => {
  const config = leadSemanticSearchConfigFromEnvironment({
    OUTREACH_EMBEDDING_URL: 'http://embeddings.internal:8080/v1/embeddings/',
    OUTREACH_EMBEDDING_MODEL: 'local-embedding-model',
    OUTREACH_EMBEDDING_DIMENSIONS: '768',
  });
  assert.deepEqual(config, {
    embeddingUrl: 'http://embeddings.internal:8080/v1/embeddings',
    embeddingApiKey: undefined,
    embeddingModel: 'local-embedding-model',
    embeddingDimensions: 768,
    queryInputType: undefined,
    documentInputType: undefined,
  });
});

test('knowledge sources preserve exact deep links and exclude drafts', () => {
  const lead: Lead = {
    id: 'lead-1',
    name: 'Jordan Lee',
    company: 'Northstar',
    status: 'replied',
    source: 'manual',
    priority: 'high',
    tags: ['enterprise'],
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
  const notes: LeadNote[] = [{
    id: 'note-1',
    content: '<p>Security review is required.</p>',
    createdAt: '2026-08-02T10:00:00.000Z',
  }];
  const activities: LeadActivity[] = [{
    id: 'activity-1',
    leadId: lead.id,
    type: 'reply_received',
    title: 'Jordan replied',
    notes: 'Asked for procurement timing.',
    createdAt: '2026-08-03T10:00:00.000Z',
  }];
  const outreach: OutreachMessage[] = [
    {
      id: 'sent-1',
      leadId: lead.id,
      medium: 'email',
      subject: 'Next steps',
      content: 'Sharing the implementation plan.',
      status: 'sent',
      createdAt: '2026-08-02T11:00:00.000Z',
      updatedAt: '2026-08-02T11:00:00.000Z',
      sentAt: '2026-08-02T11:05:00.000Z',
    },
    {
      id: 'draft-1',
      leadId: lead.id,
      medium: 'email',
      content: 'This draft must not be searchable.',
      status: 'draft',
      createdAt: '2026-08-02T12:00:00.000Z',
      updatedAt: '2026-08-02T12:00:00.000Z',
    },
  ];
  const evidence: LeadEvidence[] = [{
    id: 'utterance-1',
    leadId: lead.id,
    meetingId: 'meeting-1',
    meetingEventId: 'event-1',
    kind: 'transcript_utterance',
    sourceLabel: 'Transcript · Jordan',
    content: 'The legal team needs two weeks.',
    speakerName: 'Jordan',
    speakerExternalId: null,
    speakerIsHost: false,
    offsetMs: 42_000,
    durationMs: 3_000,
    occurredAt: '2026-08-04T10:00:42.000Z',
    createdBy: null,
    actorType: 'system',
    metadata: {},
    createdAt: '2026-08-04T10:01:00.000Z',
  }];

  const sources = buildLeadKnowledgeSources({ lead, notes, activities, outreach, evidence });
  assert.equal(sources.length, 5);
  assert.equal(sources.some((source) => source.id === 'outreach:draft-1'), false);
  assert.equal(sources.find((source) => source.id === 'note:note-1')?.content, 'Security review is required.');
  assert.deepEqual(sources.find((source) => source.id === 'utterance-1')?.target, {
    tab: 'transcription',
    anchorId: 'evidence-utterance-1',
    recordId: 'utterance-1',
    meetingId: 'meeting-1',
    offsetMs: 42_000,
  });
});
