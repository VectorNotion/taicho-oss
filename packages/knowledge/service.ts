import type { CanonicalEntity, KnowledgeSensitivity } from './domain';
import { FalkorKnowledgeRepository } from './falkor-repository';
import type { KnowledgePolicyContext } from './policy';
import { knowledgeRegistry } from './registry/registry';
import { entityTypesAreAssignable, type ContextQuery, type KnowledgeRepository, type KnowledgeSearchQuery, type KnowledgeTraversalQuery } from './repository';
import { evaluateKnowledgeCoverage } from './coverage';
import type { CompiledKnowledgeRegistry } from './registry/types';

const sensitivityRank: Record<KnowledgeSensitivity, number> = { public: 0, workspace: 1, restricted: 2 };

export class KnowledgeService {
  constructor(
    readonly organizationId: string,
    readonly repository: KnowledgeRepository = new FalkorKnowledgeRepository(organizationId, knowledgeRegistry.current()),
    readonly compiledRegistry: CompiledKnowledgeRegistry = knowledgeRegistry.current(),
  ) {}

  registryView(maxSensitivity: KnowledgeSensitivity) {
    const compiled = this.compiledRegistry;
    const allowed = (sensitivity: KnowledgeSensitivity | undefined) => sensitivityRank[sensitivity ?? 'workspace'] <= sensitivityRank[maxSensitivity];
    return {
      hash: compiled.hash,
      modules: compiled.manifests.map(({ moduleKey, version, knowledge }) => ({ moduleKey, version, knowledge })),
      entityTypes: [...compiled.entityTypes.values()].filter((value) => allowed(value.sensitivity)),
      predicates: [...compiled.predicates.values()].filter((value) => allowed(value.sensitivity)),
      extractionProfiles: [...compiled.extractionProfiles.values()],
      readProjections: [...compiled.readProjections.values()],
      capabilityIds: [...compiled.capabilityIds],
    };
  }

  async entity(id: string, maxSensitivity: KnowledgeSensitivity): Promise<CanonicalEntity | null> {
    const entity = await this.repository.getEntity(id);
    if (!entity || sensitivityRank[entity.sensitivity] > sensitivityRank[maxSensitivity]) return null;
    return entity;
  }

  async entityInProjection(id: string, projectionKey: string, maxSensitivity: KnowledgeSensitivity): Promise<CanonicalEntity | null> {
    const entity = await this.entity(id, maxSensitivity);
    const projection = this.compiledRegistry.readProjections.get(projectionKey);
    if (!entity || !projection || !projection.entityTypes.some((type) => entityTypesAreAssignable(this.compiledRegistry, entity.typeKeys ?? [entity.typeKey], [type]))) return null;
    return entity;
  }

  context(query: ContextQuery) {
    if (query.policy.organizationId !== this.organizationId) throw new Error('Knowledge policy organization does not match the service boundary.');
    return this.repository.queryContext(query);
  }

  search(query: KnowledgeSearchQuery) {
    if (query.policy.organizationId !== this.organizationId) throw new Error('Knowledge policy organization does not match the service boundary.');
    return this.repository.search(query);
  }

  traverse(query: KnowledgeTraversalQuery) {
    if (query.policy.organizationId !== this.organizationId) throw new Error('Knowledge policy organization does not match the service boundary.');
    return this.repository.traverse(query);
  }

  explain(id: string, policy: KnowledgePolicyContext) {
    if (policy.organizationId !== this.organizationId) throw new Error('Knowledge policy organization does not match the service boundary.');
    return this.repository.explain(id, policy);
  }

  async coverage(query: ContextQuery, options?: { minimumClaims?: number; minimumAverageConfidence?: number }) {
    return evaluateKnowledgeCoverage(await this.context({ ...query, policy: { ...query.policy, includeStale: true } }), options);
  }
}
