import {
  FalkorKnowledgeRepository,
  OntologyStore,
  knowledgeRegistry,
  normalizeEntityName,
  normalizeSourceDocument,
  resolveOrganizationRegistry,
  type Artifact,
  type BaseEntityKind,
  type ContextBundle,
  type KnowledgeRepository,
} from '@content-automation/knowledge';
import { currentGraphOrganizationId, requireGraphOrganizationId } from '@content-automation/platform/data/graph';
import { getSession } from '@content-automation/platform/data/graph';

function repository(): KnowledgeRepository {
  return new FalkorKnowledgeRepository(requireGraphOrganizationId(), knowledgeRegistry.current());
}

/** Repository over the organization registry: base modules plus learned types. */
async function organizationRepository(): Promise<KnowledgeRepository> {
  const organizationId = requireGraphOrganizationId();
  return new FalkorKnowledgeRepository(organizationId, await resolveOrganizationRegistry(organizationId));
}

export async function ingestContentResearchKnowledge(input: {
  title: string;
  content: string;
  sourceUrl: string;
  tags: string[];
  sourceId?: string | null;
  findingId?: string;
}) {
  const repo = repository();
  let canonicalUri = `content-research-finding:${input.findingId ?? normalizeEntityName(`${input.sourceUrl}:${input.title}`)}`;
  try {
    const url = new URL(input.sourceUrl);
    url.searchParams.set('taicho_finding', input.findingId ?? normalizeEntityName(input.title));
    canonicalUri = url.toString();
  } catch {
    // Non-URL legacy source identifiers remain valid internal source identities.
  }
  const document = normalizeSourceDocument({ kind: 'api', canonicalUri, title: input.title, content: input.content, sensitivity: 'workspace', allowedUses: ['research', 'content', 'citation', 'internal'], metadata: { legacySourceId: input.sourceId ?? null, findingId: input.findingId ?? null, originalSourceUrl: input.sourceUrl, derivedFinding: true } });
  const source = await repo.upsertSource(document);
  const { revision, created } = await repo.putSourceRevision({ sourceId: source.id, content: document.content, contentHash: document.contentHash, metadata: document.metadata });
  const [evidence] = await repo.putEvidenceSpans(revision.id, [{ start: 0, end: document.content.length, excerpt: document.content }]);
  const topicNames = [...new Set((input.tags.length ? input.tags : [input.title]).map((value) => value.trim()).filter(Boolean))];
  const researchStatement = `${input.title}: ${input.content}`.replace(/\s+/g, ' ').trim().slice(0, 2_000);
  const claims = [];
  const entities = [];
  for (const name of topicNames) {
    const normalized = normalizeEntityName(name);
    const resolved = await repo.resolveEntity({ typeKey: 'content.topic', name, externalIds: { content_topic: normalized }, sensitivity: 'workspace' });
    if (resolved.status === 'review_required') continue;
    entities.push(resolved.entity);
    claims.push({
      subjectEntityId: resolved.entity.id,
      predicateKey: 'core.has_statement',
      object: { kind: 'literal' as const, value: input.content, valueType: 'string' as const },
      statement: researchStatement,
      evidenceIds: [evidence.id],
      confidence: 0.8,
      sensitivity: 'workspace' as const,
      allowedUses: ['research', 'content', 'citation', 'internal'] as const,
    });
  }
  const reconciled = await repo.reconcileClaims({ ownerProfile: 'content.research', revisionId: revision.id, extractionVersion: 'content-research-compat@1', claims: claims.map((claim) => ({ ...claim, allowedUses: [...claim.allowedUses] })) });
  return { source, revision, revisionCreated: created, entities, claimIds: reconciled.claims.map(({ id }) => id), evidenceIds: [evidence.id] };
}

export async function reconcileProjectKnowledge(input: {
  projectId: string;
  title: string;
  description: string;
  entities: Array<{ name: string; typeKey: string; definition: string; miss?: { proposedTypeName: string; kind: BaseEntityKind } }>;
}) {
  const repo = await organizationRepository();
  const content = `${input.title}\n\n${input.description}`.trim();
  const document = normalizeSourceDocument({ kind: 'product', canonicalUri: `content-project:${input.projectId}`, title: input.title, content, sensitivity: 'workspace', allowedUses: ['research', 'content', 'citation', 'internal'], metadata: { projectId: input.projectId } });
  const source = await repo.upsertSource(document);
  const { revision } = await repo.putSourceRevision({ sourceId: source.id, content: document.content, contentHash: document.contentHash, metadata: document.metadata });
  const [evidence] = await repo.putEvidenceSpans(revision.id, [{ start: 0, end: document.content.length, excerpt: document.content }]);
  const project = await repo.resolveEntity({ typeKey: 'content.project', name: input.title, externalIds: { content_project: input.projectId } });
  if (project.status === 'review_required') throw new Error('Project identity requires review.');
  const claims = [];
  const ontology = new OntologyStore(requireGraphOrganizationId());
  for (const candidate of input.entities) {
    const resolved = await repo.resolveEntity({ typeKey: candidate.typeKey, name: candidate.name, externalIds: { [`content_name_${candidate.typeKey}`]: normalizeEntityName(candidate.name) } });
    if (resolved.status === 'review_required') continue;
    claims.push({ subjectEntityId: project.entity.id, predicateKey: 'content.project_has', object: { kind: 'entity' as const, entityId: resolved.entity.id }, statement: `${input.title} uses or provides ${candidate.name}.`, evidenceIds: [evidence.id], confidence: 0.8, sensitivity: 'workspace' as const, allowedUses: ['research', 'content', 'citation', 'internal'] as const });
    if (candidate.miss) {
      // Pass 2 miss: the concept stays in the graph under its generic kind and
      // the observation feeds the self-curating ontology.
      await ontology.recordCandidateObservation({
        surface: candidate.name,
        proposedTypeName: candidate.miss.proposedTypeName,
        definition: candidate.definition,
        baseKind: candidate.miss.kind,
        profileKey: 'content.project_extraction',
        evidence: candidate.definition || input.description.slice(0, 300),
        docRef: `content-project:${input.projectId}`,
        entityId: resolved.entity.id,
      });
    }
  }
  const reconciled = await repo.reconcileClaims({ ownerProfile: 'content.project_extraction', revisionId: revision.id, extractionVersion: 'content-project-extractor@2', claims: claims.map((claim) => ({ ...claim, allowedUses: [...claim.allowedUses] })) });
  const session = await getSession();
  try {
    await session.run(
      `MATCH (p:Project {id: $projectId}) OPTIONAL MATCH (p)-[r:KNOWLEDGE_HAS]->() DELETE r`,
      { projectId: input.projectId },
    );
    for (const claim of reconciled.claims) {
      if (claim.object.kind !== 'entity') continue;
      const entity = await repo.getEntity(claim.object.entityId);
      if (!entity) continue;
      await session.run(
        `MATCH (p:Project {id: $projectId}), (e:CanonicalEntity {id: $entityId, schemaVersion: 'knowledge.v1'}) MERGE (p)-[r:KNOWLEDGE_HAS]->(e) SET r.claimId = $claimId, r.name = $name, r.typeKey = $typeKey`,
        { projectId: input.projectId, entityId: entity.id, claimId: claim.id, name: entity.name, typeKey: entity.typeKeys.find((key) => key.startsWith('content.') || key.startsWith('learned.')) ?? entity.typeKey },
      );
    }
  } finally {
    await session.close();
  }
  return reconciled;
}

export async function queryContentKnowledge(projectionKey: 'content.topic_discovery' | 'content.idea_context' | 'content.draft_context', subjectEntityIds?: string[]): Promise<ContextBundle | null> {
  if (!currentGraphOrganizationId()) return null;
  try {
    return await repository().queryContext({ projectionKey, subjectEntityIds, policy: { organizationId: requireGraphOrganizationId(), use: 'content', maxSensitivity: 'workspace' } });
  } catch (error) {
    if (/registry has not been compiled/i.test(error instanceof Error ? error.message : String(error))) return null;
    throw error;
  }
}

export async function getKnowledgeTopicCandidates() {
  const bundle = await queryContentKnowledge('content.topic_discovery');
  if (!bundle) return [];
  const claimsByEntity = new Map<string, number>();
  const claimIdsByEntity = new Map<string, string[]>();
  const evidenceIdsByEntity = new Map<string, string[]>();
  const sourceNamesByEntity = new Map<string, string[]>();
  for (const claim of bundle.claims) {
    claimsByEntity.set(claim.subjectEntityId, (claimsByEntity.get(claim.subjectEntityId) ?? 0) + 1);
    claimIdsByEntity.set(claim.subjectEntityId, [...(claimIdsByEntity.get(claim.subjectEntityId) ?? []), claim.id]);
    evidenceIdsByEntity.set(claim.subjectEntityId, [...new Set([...(evidenceIdsByEntity.get(claim.subjectEntityId) ?? []), ...claim.evidenceIds])]);
    const sourceNames = bundle.sources
      .filter((source) => source.revisionIds.includes(claim.revisionId))
      .map((source) => source.title ?? source.canonicalUri);
    sourceNamesByEntity.set(claim.subjectEntityId, [...new Set([...(sourceNamesByEntity.get(claim.subjectEntityId) ?? []), ...sourceNames])]);
  }
  return bundle.entities
    .filter((entity) => entity.typeKeys.includes('content.topic') || entity.typeKeys.includes('core.concept'))
    .map((entity) => ({
      entityType: entity.typeKeys.includes('content.topic') ? 'content.topic' : 'core.concept',
      name: entity.name,
      id: entity.id,
      projectNames: (sourceNamesByEntity.get(entity.id) ?? []).slice(0, 10),
      projectCount: claimsByEntity.get(entity.id) ?? 0,
      claimIds: claimIdsByEntity.get(entity.id) ?? [],
      evidenceIds: evidenceIdsByEntity.get(entity.id) ?? [],
    }))
    .filter((entity) => entity.projectCount > 0)
    .sort((left, right) => right.projectCount - left.projectCount || left.name.localeCompare(right.name));
}

export async function recordContentKnowledgeArtifact(input: { kind: 'content.topic' | 'content.idea' | 'content.draft'; externalId: string; usedClaimIds: string[]; usedEvidenceIds: string[]; metadata?: Record<string, unknown> }): Promise<Artifact | null> {
  if (!currentGraphOrganizationId()) return null;
  return repository().recordArtifact({ kind: input.kind, externalId: input.externalId, usedClaimIds: input.usedClaimIds, usedEvidenceIds: input.usedEvidenceIds, sensitivity: 'workspace', allowedUses: ['content', 'citation', 'internal'], metadata: input.metadata ?? {} });
}
