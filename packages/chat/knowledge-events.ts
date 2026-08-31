import {
  FalkorKnowledgeRepository,
  knowledgeRegistry,
  normalizeEntityName,
  normalizeSourceDocument,
  registerKnowledgeEventAdapter,
} from '@content-automation/knowledge';
import { z } from 'zod';

export const SUPPORT_FEEDBACK_KNOWLEDGE_EVENT = 'knowledge.support.feedback.recorded';

const payloadSchema = z.object({
  requestId: z.string().min(1),
  conversationId: z.string().min(1),
  helpful: z.boolean(),
  note: z.string().trim().min(1).max(1_000).optional(),
  occurredAt: z.string().datetime(),
});

async function projectSupportFeedback(event: { organizationId: string; payload: Record<string, unknown> }) {
  const payload = payloadSchema.parse(event.payload);
  if (!payload.note) return 'ignored' as const;

  const repository = new FalkorKnowledgeRepository(event.organizationId, knowledgeRegistry.current());
  const isRequest = /\b(feature|request|please add|would like|wish|should support|could you)\b/i.test(payload.note);
  const typeKey = isRequest ? 'support.request' : 'support.issue';
  const label = payload.note.replace(/\s+/g, ' ').trim().slice(0, 120);
  const resolved = await repository.resolveEntity({
    typeKey,
    name: label,
    externalIds: { support_feedback: payload.requestId },
    sensitivity: 'restricted',
  });
  if (resolved.status === 'review_required') {
    throw new Error(`Support feedback ${payload.requestId} requires identity review.`);
  }

  const document = normalizeSourceDocument({
    kind: 'product',
    canonicalUri: `support-feedback:${payload.requestId}`,
    title: `${isRequest ? 'Feature request' : 'Support issue'} feedback`,
    content: payload.note,
    sensitivity: 'restricted',
    allowedUses: ['internal'],
    capturedAt: payload.occurredAt,
    metadata: {
      requestId: payload.requestId,
      conversationId: payload.conversationId,
      helpful: payload.helpful,
      normalizedLabel: normalizeEntityName(label),
    },
  });
  const source = await repository.upsertSource(document);
  const { revision } = await repository.putSourceRevision({
    sourceId: source.id,
    content: document.content,
    contentHash: document.contentHash,
    capturedAt: document.capturedAt,
    metadata: document.metadata,
  });
  const [evidence] = await repository.putEvidenceSpans(revision.id, [{
    start: 0,
    end: document.content.length,
    excerpt: document.content,
  }]);
  await repository.reconcileClaims({
    ownerProfile: 'support.feedback',
    revisionId: revision.id,
    extractionVersion: 'support-feedback@1',
    claims: [{
      subjectEntityId: resolved.entity.id,
      predicateKey: 'core.has_statement',
      object: { kind: 'literal', value: payload.note, valueType: 'string' },
      statement: payload.note,
      evidenceIds: [evidence.id],
      confidence: 1,
      sensitivity: 'restricted',
      allowedUses: ['internal'],
    }],
  });
  return 'projected' as const;
}

export function registerSupportKnowledgeEventAdapters(): void {
  registerKnowledgeEventAdapter(SUPPORT_FEEDBACK_KNOWLEDGE_EVENT, projectSupportFeedback);
}
