import type { CanonicalEntity } from '../domain';
import type { ReconcileClaimInput, KnowledgeRepository } from '../repository';
import type { CompiledKnowledgeRegistry } from '../registry/types';
import type { ExtractionCandidates } from './types';

export async function resolveExtractionCandidates(input: {
  candidates: ExtractionCandidates;
  registry: CompiledKnowledgeRegistry;
  repository: KnowledgeRepository;
  revisionId: string;
}): Promise<{ claims: ReconcileClaimInput[]; entities: CanonicalEntity[]; reviewRequired: string[] }> {
  const entities = new Map<string, CanonicalEntity>();
  const reviewRequired: string[] = [];
  for (const candidate of input.candidates.entities) {
    if (!input.registry.entityTypes.has(candidate.typeKey)) {
      reviewRequired.push(`${candidate.localKey}: unknown type ${candidate.typeKey}`);
      continue;
    }
    const result = await input.repository.resolveEntity({ ...candidate, createIfMissing: true });
    if (result.status === 'review_required') reviewRequired.push(`${candidate.localKey}: ambiguous identity`);
    else entities.set(candidate.localKey, result.entity);
  }
  const claims: ReconcileClaimInput[] = [];
  for (const candidate of input.candidates.claims) {
    const subject = entities.get(candidate.subjectKey);
    const object = candidate.object.kind === 'entity' ? entities.get(candidate.object.entityKey) : undefined;
    if (!subject || (candidate.object.kind === 'entity' && !object)) {
      reviewRequired.push(`${candidate.statement}: unresolved entity reference`);
      continue;
    }
    if (!input.registry.predicates.has(candidate.predicateKey)) {
      reviewRequired.push(`${candidate.statement}: unknown predicate ${candidate.predicateKey}`);
      continue;
    }
    const spans = await input.repository.putEvidenceSpans(input.revisionId, candidate.evidence);
    claims.push({
      subjectEntityId: subject.id,
      predicateKey: candidate.predicateKey,
      object: candidate.object.kind === 'entity' ? { kind: 'entity', entityId: object!.id } : candidate.object,
      statement: candidate.statement,
      evidenceIds: spans.map(({ id }) => id),
      confidence: candidate.confidence,
      sensitivity: candidate.sensitivity,
      allowedUses: candidate.allowedUses,
      validFrom: candidate.validFrom,
      validUntil: candidate.validUntil,
    });
  }
  return { claims, entities: [...entities.values()], reviewRequired };
}
