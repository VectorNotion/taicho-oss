import {
  FalkorKnowledgeRepository,
  knowledgeRegistry,
  normalizeSourceDocument,
  registerKnowledgeEventAdapter,
  stableKnowledgeId,
  type ReconcileClaimInput,
} from '@content-automation/knowledge';
import { z } from 'zod';

export const PUBLISHING_POST_KNOWLEDGE_EVENT = 'knowledge.publishing.post.changed';
export const PUBLISHING_METRICS_KNOWLEDGE_EVENT = 'knowledge.publishing.metrics.recorded';

const postPayloadSchema = z.object({
  postId: z.string().min(1),
  draftId: z.string().nullable(),
  destination: z.string().min(1),
  channelId: z.string().min(1),
  status: z.enum(['scheduled', 'published', 'failed']),
  copy: z.record(z.string(), z.unknown()),
  publishAt: z.string().datetime(),
  resultUrl: z.string().optional(),
  error: z.string().optional(),
  occurredAt: z.string().datetime(),
});

async function projectPublishingPost(event: { organizationId: string; payload: Record<string, unknown> }) {
  const payload = postPayloadSchema.parse(event.payload);
  const repository = new FalkorKnowledgeRepository(event.organizationId, knowledgeRegistry.current());
  const [publication, channel, draft] = await Promise.all([
    repository.resolveEntity({ typeKey: 'publishing.publication', name: payload.resultUrl ?? `Publication ${payload.postId}`, externalIds: { publishing_post: payload.postId }, sensitivity: 'workspace' }),
    repository.resolveEntity({ typeKey: 'publishing.channel', name: payload.destination, externalIds: { publishing_channel: payload.channelId, publishing_destination: payload.destination }, sensitivity: 'workspace' }),
    payload.draftId
      ? repository.resolveEntity({ typeKey: 'content.draft', name: `Draft ${payload.draftId}`, externalIds: { content_draft: payload.draftId }, sensitivity: 'workspace' })
      : Promise.resolve(null),
  ]);
  if (publication.status === 'review_required' || channel.status === 'review_required' || draft?.status === 'review_required') {
    throw new Error(`Publishing post ${payload.postId} requires identity review.`);
  }
  const statement = payload.status === 'published'
    ? `Published to ${payload.destination}${payload.resultUrl ? ` at ${payload.resultUrl}` : ''}.`
    : payload.status === 'failed'
      ? `Publishing to ${payload.destination} failed${payload.error ? `: ${payload.error}` : '.'}`
      : `Scheduled for ${payload.publishAt} on ${payload.destination}.`;
  const content = `${statement}\n\nCopy:\n${JSON.stringify(payload.copy, null, 2)}`;
  const document = normalizeSourceDocument({
    kind: 'product', canonicalUri: `publishing-post:${payload.postId}`, title: `Publication ${payload.postId}`,
    content, sensitivity: 'workspace', allowedUses: ['research', 'content', 'citation', 'internal'],
    capturedAt: payload.occurredAt, metadata: { ...payload },
  });
  const source = await repository.upsertSource(document);
  const { revision } = await repository.putSourceRevision({ sourceId: source.id, content, contentHash: document.contentHash, capturedAt: payload.occurredAt, metadata: document.metadata });
  const [evidence] = await repository.putEvidenceSpans(revision.id, [{ start: 0, end: content.length, excerpt: content }]);
  const claims: ReconcileClaimInput[] = [{
    subjectEntityId: publication.entity.id,
    predicateKey: 'publishing.on_channel',
    object: { kind: 'entity', entityId: channel.entity.id },
    statement: `Publication ${payload.postId} uses ${payload.destination}.`,
    evidenceIds: [evidence.id], confidence: 1, sensitivity: 'workspace', allowedUses: ['content', 'internal'],
  }, {
    subjectEntityId: publication.entity.id,
    predicateKey: 'core.has_statement',
    object: { kind: 'literal', value: statement, valueType: 'string' },
    statement, evidenceIds: [evidence.id], confidence: 1, sensitivity: 'workspace', allowedUses: ['research', 'content', 'citation', 'internal'],
  }];
  if (draft) claims.push({
    subjectEntityId: publication.entity.id,
    predicateKey: 'publishing.from_draft',
    object: { kind: 'entity', entityId: draft.entity.id },
    statement: `Publication ${payload.postId} was created from draft ${payload.draftId}.`,
    evidenceIds: [evidence.id], confidence: 1, sensitivity: 'workspace', allowedUses: ['research', 'content', 'citation', 'internal'],
  });
  await repository.reconcileClaims({ ownerProfile: 'publishing.records', revisionId: revision.id, extractionVersion: 'publishing-records@1', claims });
  return 'projected' as const;
}

const metricsPayloadSchema = z.object({
  snapshotId: z.string().min(1),
  postId: z.string().min(1),
  draftId: z.string().nullable(),
  source: z.string().min(1),
  metrics: z.record(z.string(), z.number().nonnegative()),
  occurredAt: z.string().datetime(),
});

async function projectPublishingMetrics(event: { organizationId: string; payload: Record<string, unknown> }) {
  const payload = metricsPayloadSchema.parse(event.payload);
  const repository = new FalkorKnowledgeRepository(event.organizationId, knowledgeRegistry.current());
  const publication = await repository.resolveEntity({ typeKey: 'publishing.publication', name: `Publication ${payload.postId}`, externalIds: { publishing_post: payload.postId }, sensitivity: 'workspace' });
  if (publication.status === 'review_required') throw new Error(`Publishing post ${payload.postId} requires identity review.`);
  const statement = `Observed ${Object.entries(payload.metrics).map(([key, value]) => `${key}=${value}`).join(', ')} from ${payload.source}.`;
  const document = normalizeSourceDocument({
    kind: 'product', canonicalUri: `publishing-metrics:${payload.snapshotId}`, title: `Metrics for ${payload.postId}`,
    content: statement, sensitivity: 'workspace', allowedUses: ['research', 'content', 'internal'], capturedAt: payload.occurredAt,
    metadata: { ...payload },
  });
  const source = await repository.upsertSource(document);
  const { revision } = await repository.putSourceRevision({ sourceId: source.id, content: statement, contentHash: document.contentHash, capturedAt: payload.occurredAt, metadata: document.metadata });
  const [evidence] = await repository.putEvidenceSpans(revision.id, [{ start: 0, end: statement.length, excerpt: statement }]);
  const reconciled = await repository.reconcileClaims({
    ownerProfile: 'publishing.records', revisionId: revision.id, extractionVersion: 'publishing-metrics@1',
    claims: [{ subjectEntityId: publication.entity.id, predicateKey: 'core.has_statement', object: { kind: 'literal', value: statement, valueType: 'string' }, statement, evidenceIds: [evidence.id], confidence: 1, sensitivity: 'workspace', allowedUses: ['research', 'content', 'internal'] }],
  });
  await repository.recordAssessment({
    id: stableKnowledgeId('assessment', event.organizationId, 'publishing-metrics', payload.snapshotId),
    kind: 'publishing.performance', subjectEntityIds: [publication.entity.id], policyKey: 'publishing.metric_snapshot', policyVersion: 1,
    result: { source: payload.source, metrics: payload.metrics, occurredAt: payload.occurredAt, draftId: payload.draftId },
    supportingClaimIds: reconciled.claims.map(({ id }) => id), contradictingClaimIds: [], sensitivity: 'workspace', allowedUses: ['research', 'content', 'internal'],
  });
  return 'projected' as const;
}

export function registerPublishingKnowledgeEventAdapters(): void {
  registerKnowledgeEventAdapter(PUBLISHING_POST_KNOWLEDGE_EVENT, projectPublishingPost);
  registerKnowledgeEventAdapter(PUBLISHING_METRICS_KNOWLEDGE_EVENT, projectPublishingMetrics);
}
