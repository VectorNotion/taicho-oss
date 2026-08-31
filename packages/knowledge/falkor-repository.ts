import { getSession } from '@content-automation/platform/data/graph';
import type { CompiledKnowledgeRegistry } from './registry/types';
import type {
  Artifact,
  Assessment,
  CanonicalEntity,
  Claim,
  ContextBundle,
  EvidenceSpan,
  KnowledgeRun,
  KnowledgeSearchResult,
  KnowledgeSource,
  KnowledgeTraversalResult,
  SourceRevision,
} from './domain';
import { KNOWLEDGE_SCHEMA_VERSION, stableKnowledgeId } from './domain';
import type { EntityResolution } from './identity';
import type { KnowledgePolicyContext } from './policy';
import {
  InMemoryKnowledgeRepository,
  type ContextQuery,
  type Explanation,
  type KnowledgeRepository,
  type KnowledgeSearchQuery,
  type KnowledgeTraversalQuery,
  type PutEvidenceInput,
  type PutRevisionInput,
  type ReconcileClaimInput,
  type ResolveEntityInput,
  type UpsertSourceInput,
} from './repository';

type Session = Awaited<ReturnType<typeof getSession>>;
type JsonNode = KnowledgeSource | SourceRevision | EvidenceSpan | CanonicalEntity | Claim | Assessment | Artifact | KnowledgeRun;

const labels = [
  ['KnowledgeSource', 'sources'],
  ['SourceRevision', 'revisions'],
  ['Evidence', 'evidence'],
  ['CanonicalEntity', 'entities'],
  ['Claim', 'claims'],
  ['Assessment', 'assessments'],
  ['Artifact', 'artifacts'],
  ['KnowledgeRun', 'runs'],
] as const;

/**
 * FalkorDB adapter for knowledge.v1. Domain reconciliation is performed by the
 * deterministic in-memory model, then the desired state is idempotently
 * projected into the organization-scoped graph.
 */
export class FalkorKnowledgeRepository implements KnowledgeRepository {
  readonly #memory: InMemoryKnowledgeRepository;
  #loaded = false;

  constructor(readonly organizationId: string, readonly registry: CompiledKnowledgeRegistry) {
    this.#memory = new InMemoryKnowledgeRepository(organizationId, registry);
  }

  async #withSession<T>(run: (session: Session) => Promise<T>): Promise<T> {
    const session = await getSession(this.organizationId);
    try { return await run(session); } finally { await session.close(); }
  }

  async #load() {
    if (this.#loaded) return;
    await this.#withSession(async (session) => {
      for (const [label, mapName] of labels) {
        const result = await session.run(
          `MATCH (n:${label} {schemaVersion: $schemaVersion, organizationId: $organizationId}) RETURN n.json AS json`,
          { schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId },
        );
        const map = this.#memory[mapName] as Map<string, JsonNode>;
        for (const record of result.records) {
          const raw = record.get('json');
          const value = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as JsonNode;
          if (mapName === 'entities' && !('typeKeys' in value)) {
            const entity = value as unknown as CanonicalEntity;
            entity.typeKeys = [entity.typeKey];
          }
          if ((mapName === 'artifacts' || mapName === 'assessments') && !('sensitivity' in value)) {
            Object.assign(value, { sensitivity: 'restricted', allowedUses: ['internal'] });
          }
          map.set(value.id, value);
        }
      }
      for (const source of this.#memory.sources.values()) {
        if (source.latestRevisionId) continue;
        const latest = [...this.#memory.revisions.values()]
          .filter((revision) => revision.sourceId === source.id)
          .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt) || right.id.localeCompare(left.id))[0];
        if (latest) this.#memory.sources.set(source.id, { ...source, latestRevisionId: latest.id, latestRevisionObservedAt: latest.capturedAt });
      }
    });
    this.#loaded = true;
  }

  async #put(label: string, value: JsonNode, session?: Session) {
    const write = async (active: Session) => active.run(
      `MERGE (n:${label} {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId})
       SET n.json = $json,
           n.updatedAt = $updatedAt,
           n.status = $status,
           n.kind = $kind,
           n.ownerProfile = $ownerProfile,
           n.revisionId = $revisionId,
           n.sourceId = $sourceId,
           n.externalId = $externalId
       RETURN n.id AS id`,
      {
        id: value.id,
        schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
        organizationId: this.organizationId,
        json: JSON.stringify(value),
        updatedAt: 'updatedAt' in value ? value.updatedAt : 'createdAt' in value ? value.createdAt : new Date().toISOString(),
        status: 'status' in value ? value.status : null,
        kind: 'kind' in value ? value.kind : null,
        ownerProfile: 'ownerProfile' in value ? value.ownerProfile : null,
        revisionId: 'revisionId' in value ? value.revisionId : null,
        sourceId: 'sourceId' in value ? value.sourceId : null,
        externalId: 'externalId' in value ? value.externalId ?? null : null,
      },
    );
    if (session) await write(session); else await this.#withSession(write);
  }

  async upsertSource(input: UpsertSourceInput): Promise<KnowledgeSource> {
    await this.#load();
    const beforeId = stableKnowledgeId('source', this.organizationId, `${input.kind}:${input.canonicalUri.trim().normalize('NFKC')}`);
    const before = this.#memory.sources.get(beforeId);
    const source = await this.#memory.upsertSource(input);
    if (!before || JSON.stringify(before) !== JSON.stringify(source)) await this.#put('KnowledgeSource', source);
    return source;
  }

  async putSourceRevision(input: PutRevisionInput) {
    await this.#load();
    const result = await this.#memory.putSourceRevision(input);
    await this.#withSession(async (session) => {
      const source = this.#memory.sources.get(input.sourceId);
      if (source) await this.#put('KnowledgeSource', source, session);
      await this.#put('SourceRevision', result.revision, session);
      await session.run(
        `MATCH (s:KnowledgeSource {id: $sourceId, schemaVersion: $schemaVersion, organizationId: $organizationId}), (r:SourceRevision {id: $revisionId, schemaVersion: $schemaVersion, organizationId: $organizationId}) MERGE (s)-[:HAS_REVISION]->(r)`,
        { sourceId: input.sourceId, revisionId: result.revision.id, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId },
      );
    });
    return result;
  }

  async putEvidenceSpans(revisionId: string, spans: PutEvidenceInput[]): Promise<EvidenceSpan[]> {
    await this.#load();
    const values = await this.#memory.putEvidenceSpans(revisionId, spans);
    await this.#withSession(async (session) => {
      for (const value of values) {
        await this.#put('Evidence', value, session);
        await session.run(
          `MATCH (r:SourceRevision {id: $revisionId, schemaVersion: $schemaVersion, organizationId: $organizationId}), (e:Evidence {id: $evidenceId, schemaVersion: $schemaVersion, organizationId: $organizationId}) MERGE (r)-[:CONTAINS]->(e)`,
          { revisionId, evidenceId: value.id, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId },
        );
      }
    });
    return values;
  }

  async resolveEntity(input: ResolveEntityInput): Promise<EntityResolution> {
    await this.#load();
    const result = await this.#memory.resolveEntity(input);
    if (result.status !== 'review_required') await this.#put('CanonicalEntity', result.entity);
    return result;
  }

  async getEntity(id: string): Promise<CanonicalEntity | null> {
    await this.#load();
    return this.#memory.getEntity(id);
  }

  async getSource(id: string): Promise<KnowledgeSource | null> {
    await this.#load();
    return this.#memory.getSource(id);
  }

  async getSourceRevision(id: string): Promise<SourceRevision | null> {
    await this.#load();
    return this.#memory.getSourceRevision(id);
  }

  async listSources(input: Parameters<KnowledgeRepository['listSources']>[0] = {}): Promise<KnowledgeSource[]> {
    await this.#load();
    return this.#memory.listSources(input);
  }

  async getClaim(id: string): Promise<Claim | null> {
    await this.#load();
    return this.#memory.getClaim(id);
  }

  async getClaimsForRevision(revisionId: string): Promise<Claim[]> {
    await this.#load();
    return this.#memory.getClaimsForRevision(revisionId);
  }

  async reconcileClaims(input: { ownerProfile: string; revisionId: string; extractionVersion: string; claims: ReconcileClaimInput[] }) {
    await this.#load();
    const result = await this.#memory.reconcileClaims(input);
    const revision = this.#memory.revisions.get(input.revisionId);
    const owned = [...this.#memory.claims.values()].filter((claim) =>
      claim.ownerProfile === input.ownerProfile
      && this.#memory.revisions.get(claim.revisionId)?.sourceId === revision?.sourceId);
    await this.#withSession(async (session) => {
      for (const claim of owned) {
        await this.#put('Claim', claim, session);
        await session.run(
          `MATCH (c:Claim {id: $claimId, schemaVersion: $schemaVersion, organizationId: $organizationId}) OPTIONAL MATCH (c)-[old:SUPPORTED_BY|SUBJECT|OBJECT]->() DELETE old`,
          { claimId: claim.id, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId },
        );
        await session.run(
          `MATCH (c:Claim {id: $claimId, schemaVersion: $schemaVersion, organizationId: $organizationId}), (s:CanonicalEntity {id: $subjectId, schemaVersion: $schemaVersion, organizationId: $organizationId}) MERGE (c)-[:SUBJECT]->(s)`,
          { claimId: claim.id, subjectId: claim.subjectEntityId, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId },
        );
        if (claim.object.kind === 'entity') {
          await session.run(
            `MATCH (c:Claim {id: $claimId, schemaVersion: $schemaVersion, organizationId: $organizationId}), (o:CanonicalEntity {id: $objectId, schemaVersion: $schemaVersion, organizationId: $organizationId}) MERGE (c)-[:OBJECT]->(o)`,
            { claimId: claim.id, objectId: claim.object.entityId, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId },
          );
        }
        for (const evidenceId of claim.evidenceIds) {
          await session.run(
            `MATCH (c:Claim {id: $claimId, schemaVersion: $schemaVersion, organizationId: $organizationId}), (e:Evidence {id: $evidenceId, schemaVersion: $schemaVersion, organizationId: $organizationId}) MERGE (c)-[:SUPPORTED_BY]->(e)`,
            { claimId: claim.id, evidenceId, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId },
          );
        }
      }
    });
    return result;
  }

  async recordAssessment(input: Parameters<KnowledgeRepository['recordAssessment']>[0]): Promise<Assessment> {
    await this.#load();
    const value = await this.#memory.recordAssessment(input);
    await this.#withSession(async (session) => {
      await this.#put('Assessment', value, session);
      await session.run(
        `MATCH (a:Assessment {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId}) OPTIONAL MATCH (a)-[old:BASED_ON|ASSESSES]->() DELETE old`,
        { id: value.id, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId },
      );
      for (const entityId of value.subjectEntityIds) await session.run(
        `MATCH (a:Assessment {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId}), (e:CanonicalEntity {id: $entityId, schemaVersion: $schemaVersion, organizationId: $organizationId}) MERGE (a)-[:ASSESSES]->(e)`,
        { id: value.id, entityId, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId },
      );
      for (const claimId of [...value.supportingClaimIds, ...value.contradictingClaimIds]) await session.run(
        `MATCH (a:Assessment {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId}), (c:Claim {id: $claimId, schemaVersion: $schemaVersion, organizationId: $organizationId}) MERGE (a)-[:BASED_ON]->(c)`,
        { id: value.id, claimId, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId },
      );
    });
    return value;
  }

  async recordArtifact(input: Parameters<KnowledgeRepository['recordArtifact']>[0]): Promise<Artifact> {
    await this.#load();
    const value = await this.#memory.recordArtifact(input);
    await this.#withSession(async (session) => {
      await this.#put('Artifact', value, session);
      await session.run(
        `MATCH (a:Artifact {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId}) OPTIONAL MATCH (a)-[old:USES]->() DELETE old`,
        { id: value.id, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId },
      );
      for (const claimId of value.usedClaimIds) await session.run(
        `MATCH (a:Artifact {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId}), (c:Claim {id: $claimId, schemaVersion: $schemaVersion, organizationId: $organizationId}) MERGE (a)-[:USES]->(c)`,
        { id: value.id, claimId, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId },
      );
    });
    return value;
  }

  async recordRun(input: Omit<KnowledgeRun, 'id' | 'schemaVersion' | 'organizationId'> & { id?: string }): Promise<KnowledgeRun> {
    await this.#load();
    const value = await this.#memory.recordRun(input);
    await this.#put('KnowledgeRun', value);
    return value;
  }

  async findSuccessfulExtraction(input: { revisionId: string; registryHash: string; profileKey: string; adapterKey: string; adapterVersion: string }): Promise<{ run: KnowledgeRun; claims: Claim[] } | null> {
    await this.#load();
    return this.#memory.findSuccessfulExtraction(input);
  }

  async queryContext(query: ContextQuery): Promise<ContextBundle> {
    await this.#load();
    return this.#memory.queryContext(query);
  }

  async search(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResult> {
    await this.#load();
    return this.#memory.search(query);
  }

  async traverse(query: KnowledgeTraversalQuery): Promise<KnowledgeTraversalResult> {
    await this.#load();
    return this.#memory.traverse(query);
  }

  async explain(id: string, policy: KnowledgePolicyContext): Promise<Explanation | null> {
    await this.#load();
    return this.#memory.explain(id, policy);
  }
}
