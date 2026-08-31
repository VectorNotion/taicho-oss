import type {
  Artifact,
  Assessment,
  CanonicalEntity,
  Claim,
  ClaimObject,
  ContextBundle,
  EvidenceSpan,
  KnowledgeRun,
  KnowledgeSearchResult,
  KnowledgeSensitivity,
  KnowledgeSource,
  KnowledgeTraversalDirection,
  KnowledgeTraversalResult,
  SourceKind,
  SourceRevision,
} from './domain';
import { KNOWLEDGE_SCHEMA_VERSION, stableKnowledgeId } from './domain';
import { buildCanonicalEntity, externalIdentityKey, normalizeEntityName, scoreIdentityCandidate, type EntityResolution } from './identity';
import { restrictClaims, type KnowledgePolicyContext } from './policy';
import type { CompiledKnowledgeRegistry, KnowledgeUse } from './registry/types';

export interface UpsertSourceInput {
  kind: SourceKind;
  canonicalUri: string;
  title?: string;
  sensitivity?: KnowledgeSensitivity;
  allowedUses?: KnowledgeUse[];
  metadata?: Record<string, unknown>;
}

export interface PutRevisionInput {
  sourceId: string;
  content: string;
  contentHash: string;
  language?: string;
  capturedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface PutEvidenceInput {
  start: number;
  end: number;
  excerpt?: string;
  locator?: string;
}

export interface ResolveEntityInput {
  typeKey: string;
  name: string;
  aliases?: string[];
  externalIds?: Record<string, string>;
  sensitivity?: KnowledgeSensitivity;
  createIfMissing?: boolean;
  minimumAutomaticScore?: number;
}

export interface ReconcileClaimInput {
  subjectEntityId: string;
  predicateKey: string;
  object: ClaimObject;
  statement: string;
  evidenceIds: string[];
  confidence: number;
  sensitivity?: KnowledgeSensitivity;
  allowedUses?: KnowledgeUse[];
  validFrom?: string;
  validUntil?: string;
}

export interface ContextQuery {
  projectionKey: string;
  subjectEntityIds?: string[];
  policy: KnowledgePolicyContext;
  limit?: number;
  minimumConfidence?: number;
}

export interface KnowledgeSearchQuery {
  projectionKey: string;
  query: string;
  policy: KnowledgePolicyContext;
  limit?: number;
  minimumConfidence?: number;
}

export interface KnowledgeTraversalQuery {
  projectionKey: string;
  startEntityIds: string[];
  policy: KnowledgePolicyContext;
  direction?: KnowledgeTraversalDirection;
  predicateKeys?: string[];
  maxHops?: number;
  maxPaths?: number;
  minimumConfidence?: number;
  includeLiterals?: boolean;
}

export type Explanation = {
  target: Claim | Assessment | Artifact;
  claims: Claim[];
  evidence: EvidenceSpan[];
  revisions: Array<Omit<SourceRevision, 'content'>>;
  sources: KnowledgeSource[];
};

export interface KnowledgeRepository {
  readonly organizationId: string;
  upsertSource(input: UpsertSourceInput): Promise<KnowledgeSource>;
  putSourceRevision(input: PutRevisionInput): Promise<{ revision: SourceRevision; source: KnowledgeSource; created: boolean }>;
  putEvidenceSpans(revisionId: string, spans: PutEvidenceInput[]): Promise<EvidenceSpan[]>;
  resolveEntity(input: ResolveEntityInput): Promise<EntityResolution>;
  getSource(id: string): Promise<KnowledgeSource | null>;
  getSourceRevision(id: string): Promise<SourceRevision | null>;
  listSources(input?: { kind?: SourceKind }): Promise<KnowledgeSource[]>;
  getClaimsForRevision(revisionId: string): Promise<Claim[]>;
  getEntity(id: string): Promise<CanonicalEntity | null>;
  getClaim(id: string): Promise<Claim | null>;
  reconcileClaims(input: { ownerProfile: string; revisionId: string; extractionVersion: string; claims: ReconcileClaimInput[] }): Promise<{ claims: Claim[]; created: number; unchanged: number; superseded: number }>;
  recordAssessment(input: Omit<Assessment, 'id' | 'schemaVersion' | 'organizationId' | 'createdAt' | 'sensitivity' | 'allowedUses'> & { id?: string; sensitivity?: KnowledgeSensitivity; allowedUses?: KnowledgeUse[] }): Promise<Assessment>;
  recordArtifact(input: Omit<Artifact, 'id' | 'schemaVersion' | 'organizationId' | 'createdAt' | 'sensitivity' | 'allowedUses'> & { id?: string; sensitivity?: KnowledgeSensitivity; allowedUses?: KnowledgeUse[] }): Promise<Artifact>;
  recordRun(input: Omit<KnowledgeRun, 'id' | 'schemaVersion' | 'organizationId'> & { id?: string }): Promise<KnowledgeRun>;
  findSuccessfulExtraction(input: { revisionId: string; registryHash: string; profileKey: string; adapterKey: string; adapterVersion: string }): Promise<{ run: KnowledgeRun; claims: Claim[] } | null>;
  queryContext(query: ContextQuery): Promise<ContextBundle>;
  search(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResult>;
  traverse(query: KnowledgeTraversalQuery): Promise<KnowledgeTraversalResult>;
  explain(id: string, policy: KnowledgePolicyContext): Promise<Explanation | null>;
}

function sourceIdentity(kind: SourceKind, uri: string) {
  return `${kind}:${uri.trim().normalize('NFKC')}`;
}

function claimObjectKey(object: ClaimObject): string {
  return object.kind === 'entity'
    ? `entity:${object.entityId}`
    : `literal:${object.valueType}:${String(object.value)}`;
}

const sensitivityRank: Record<KnowledgeSensitivity, number> = { public: 0, workspace: 1, restricted: 2 };

function maximumSensitivity(values: readonly (KnowledgeSensitivity | undefined)[]): KnowledgeSensitivity {
  return values.reduce<KnowledgeSensitivity>((current, value) =>
    value && sensitivityRank[value] > sensitivityRank[current] ? value : current, 'public');
}

function allowedUseIntersection(values: readonly (readonly KnowledgeUse[] | undefined)[]): KnowledgeUse[] {
  const present = values.filter((value): value is readonly KnowledgeUse[] => !!value);
  if (present.length === 0) return [];
  return present[0].filter((use) => present.every((allowed) => allowed.includes(use)));
}

function assertPolicyDoesNotEscalate(input: {
  requestedSensitivity?: KnowledgeSensitivity;
  minimumSensitivity: KnowledgeSensitivity;
  requestedUses?: readonly KnowledgeUse[];
  allowedUses: readonly KnowledgeUse[];
  target: string;
}) {
  if (input.requestedSensitivity && sensitivityRank[input.requestedSensitivity] < sensitivityRank[input.minimumSensitivity]) {
    throw new Error(`${input.target} sensitivity cannot be less restrictive than its lineage.`);
  }
  if (input.requestedUses?.some((use) => !input.allowedUses.includes(use))) {
    throw new Error(`${input.target} allowed uses cannot be broader than its lineage.`);
  }
}

export function entityTypesAreAssignable(registry: CompiledKnowledgeRegistry, actual: string | readonly string[], expected: readonly string[]): boolean {
  for (const actualKey of typeof actual === 'string' ? [actual] : actual) {
    let cursor: string | undefined = actualKey;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      if (expected.includes(cursor)) return true;
      seen.add(cursor);
      const definition = registry.entityTypes.get(cursor);
      cursor = definition?.extends ?? definition?.equivalentTo;
    }
  }
  return false;
}

function assignable(registry: CompiledKnowledgeRegistry, actual: string | readonly string[], expected: readonly string[]): boolean {
  return entityTypesAreAssignable(registry, actual, expected);
}

function normalizedSearchTerms(value: string): string[] {
  return [...new Set(value.normalize('NFKC').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
}

function lexicalScore(query: string, candidates: readonly string[]): number {
  const normalizedQuery = query.normalize('NFKC').trim().toLocaleLowerCase();
  const terms = normalizedSearchTerms(normalizedQuery);
  if (!normalizedQuery || terms.length === 0) return 0;
  let best = 0;
  for (const candidate of candidates) {
    const normalizedCandidate = candidate.normalize('NFKC').trim().toLocaleLowerCase();
    if (!normalizedCandidate) continue;
    if (normalizedCandidate === normalizedQuery) best = Math.max(best, 1);
    else if (normalizedCandidate.startsWith(normalizedQuery)) best = Math.max(best, 0.9);
    else if (normalizedCandidate.includes(normalizedQuery)) best = Math.max(best, 0.8);
    const candidateTerms = new Set(normalizedSearchTerms(normalizedCandidate));
    const overlap = terms.filter((term) => candidateTerms.has(term) || [...candidateTerms].some((value) => value.startsWith(term))).length;
    best = Math.max(best, 0.65 * (overlap / terms.length));
  }
  return Number(best.toFixed(4));
}

export class InMemoryKnowledgeRepository implements KnowledgeRepository {
  readonly sources = new Map<string, KnowledgeSource>();
  readonly revisions = new Map<string, SourceRevision>();
  readonly evidence = new Map<string, EvidenceSpan>();
  readonly entities = new Map<string, CanonicalEntity>();
  readonly claims = new Map<string, Claim>();
  readonly assessments = new Map<string, Assessment>();
  readonly artifacts = new Map<string, Artifact>();
  readonly runs = new Map<string, KnowledgeRun>();

  constructor(readonly organizationId: string, readonly registry: CompiledKnowledgeRegistry) {}

  async upsertSource(input: UpsertSourceInput): Promise<KnowledgeSource> {
    const id = stableKnowledgeId('source', this.organizationId, sourceIdentity(input.kind, input.canonicalUri));
    const existing = this.sources.get(id);
    const now = new Date().toISOString();
    const source: KnowledgeSource = {
      id,
      schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      organizationId: this.organizationId,
      kind: input.kind,
      canonicalUri: input.canonicalUri.trim(),
      title: input.title ?? existing?.title,
      sensitivity: maximumSensitivity([existing?.sensitivity, input.sensitivity, existing ? undefined : 'workspace']),
      allowedUses: existing
        ? allowedUseIntersection([existing.allowedUses, input.allowedUses ?? existing.allowedUses])
        : input.allowedUses ?? ['research', 'internal'],
      metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
      latestRevisionId: existing?.latestRevisionId,
      latestRevisionObservedAt: existing?.latestRevisionObservedAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing && JSON.stringify({ ...existing, updatedAt: undefined }) === JSON.stringify({ ...source, updatedAt: undefined })) {
      source.updatedAt = existing.updatedAt;
    }
    this.sources.set(id, source);
    return structuredClone(source);
  }

  async putSourceRevision(input: PutRevisionInput): Promise<{ revision: SourceRevision; source: KnowledgeSource; created: boolean }> {
    const source = this.sources.get(input.sourceId);
    if (!source) throw new Error(`Unknown knowledge source: ${input.sourceId}`);
    const id = stableKnowledgeId('revision', this.organizationId, input.sourceId, input.contentHash);
    const existing = this.revisions.get(id);
    const observedAt = input.capturedAt ?? new Date().toISOString();
    const latest = source.latestRevisionId ? this.revisions.get(source.latestRevisionId) : undefined;
    const latestObservedAt = source.latestRevisionObservedAt ?? latest?.capturedAt;
    if (existing) {
      if (source.latestRevisionId !== existing.id && (!latestObservedAt || observedAt >= latestObservedAt)) {
        this.sources.set(source.id, { ...source, latestRevisionId: existing.id, latestRevisionObservedAt: observedAt, updatedAt: new Date().toISOString() });
      }
      return { revision: structuredClone(existing), source: structuredClone(this.sources.get(source.id)!), created: false };
    }
    const revision: SourceRevision = {
      id,
      schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      organizationId: this.organizationId,
      sourceId: input.sourceId,
      contentHash: input.contentHash,
      content: input.content,
      language: input.language,
      capturedAt: observedAt,
      metadata: input.metadata ?? {},
    };
    this.revisions.set(id, revision);
    if (!latestObservedAt || observedAt >= latestObservedAt) {
      this.sources.set(source.id, { ...source, latestRevisionId: revision.id, latestRevisionObservedAt: observedAt, updatedAt: new Date().toISOString() });
    }
    return { revision: structuredClone(revision), source: structuredClone(this.sources.get(source.id)!), created: true };
  }

  async putEvidenceSpans(revisionId: string, spans: PutEvidenceInput[]): Promise<EvidenceSpan[]> {
    const revision = this.revisions.get(revisionId);
    if (!revision) throw new Error(`Unknown source revision: ${revisionId}`);
    return spans.map((span) => {
      if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > revision.content.length) {
        throw new Error(`Invalid evidence offsets ${span.start}:${span.end} for revision ${revisionId}`);
      }
      const exact = revision.content.slice(span.start, span.end);
      if (span.excerpt !== undefined && span.excerpt !== exact) throw new Error('Evidence excerpt does not match the source revision offsets.');
      const id = stableKnowledgeId('evidence', this.organizationId, revisionId, span.start, span.end, exact);
      const value: EvidenceSpan = { id, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId, revisionId, start: span.start, end: span.end, excerpt: exact, locator: span.locator };
      this.evidence.set(id, value);
      return structuredClone(value);
    });
  }

  async resolveEntity(input: ResolveEntityInput): Promise<EntityResolution> {
    const requestedType = this.registry.entityTypes.get(input.typeKey);
    if (!requestedType) throw new Error(`Unknown registered entity type: ${input.typeKey}`);
    const effectiveInput = {
      ...input,
      sensitivity: maximumSensitivity([requestedType.sensitivity, input.sensitivity]),
    };
    const externalKey = externalIdentityKey(input.externalIds ?? {});
    const candidates = [...this.entities.values()]
      .map((entity) => {
        const scored = scoreIdentityCandidate(effectiveInput, entity);
        const relatedRole = assignable(this.registry, input.typeKey, entity.typeKeys ?? [entity.typeKey])
          || assignable(this.registry, entity.typeKeys ?? [entity.typeKey], [input.typeKey]);
        return relatedRole && !(entity.typeKeys ?? [entity.typeKey]).includes(input.typeKey)
          ? { entity, score: Math.min(1, scored.score + 0.2), reasons: [...scored.reasons, 'compatible registered role'] }
          : { entity, ...scored };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.entity.id.localeCompare(right.entity.id));
    const threshold = input.minimumAutomaticScore ?? (externalKey ? 0.95 : 0.7);
    if (candidates[0] && candidates[0].score >= threshold && (!candidates[1] || candidates[0].score > candidates[1].score)) {
      const matched = candidates[0].entity;
      const typeKeys = [...new Set([...(matched.typeKeys ?? [matched.typeKey]), input.typeKey])].sort();
      const inputName = normalizeEntityName(input.name);
      const aliases = [...new Set([
        ...matched.aliases,
        ...(input.aliases ?? []).map(normalizeEntityName),
        ...(inputName !== matched.normalizedName ? [inputName] : []),
      ].filter(Boolean))].sort();
      const updated = {
        ...matched,
        typeKeys,
        aliases,
        externalIds: { ...matched.externalIds, ...(input.externalIds ?? {}) },
        sensitivity: maximumSensitivity([matched.sensitivity, effectiveInput.sensitivity]),
        updatedAt: new Date().toISOString(),
      };
      this.entities.set(updated.id, updated);
      return { status: 'resolved', entity: structuredClone(updated), score: candidates[0].score, reasons: candidates[0].reasons };
    }
    // Sharing a registered type is intentionally a weak signal (0.2): the
    // existence of one Concept, Person, or Place must not make every new one
    // ambiguous. Reserve manual review for a genuinely plausible near-match
    // (for example an exact alias at 0.65), otherwise create the new identity.
    const reviewFloor = 0.45;
    if (input.createIfMissing === false || (candidates[0]?.score ?? 0) >= reviewFloor) {
      return { status: 'review_required', candidates: candidates.slice(0, 5).map((candidate) => ({ ...candidate, entity: structuredClone(candidate.entity) })) };
    }
    const entity = buildCanonicalEntity({ organizationId: this.organizationId, ...effectiveInput });
    this.entities.set(entity.id, entity);
    return { status: 'created', entity: structuredClone(entity), score: 1, reasons: ['no plausible existing identity'] };
  }

  async getEntity(id: string): Promise<CanonicalEntity | null> {
    const entity = this.entities.get(id);
    return entity ? structuredClone(entity) : null;
  }

  async getSource(id: string): Promise<KnowledgeSource | null> {
    const source = this.sources.get(id);
    return source ? structuredClone(source) : null;
  }

  async getSourceRevision(id: string): Promise<SourceRevision | null> {
    const revision = this.revisions.get(id);
    return revision ? structuredClone(revision) : null;
  }

  async listSources(input: { kind?: SourceKind } = {}): Promise<KnowledgeSource[]> {
    return [...this.sources.values()]
      .filter((source) => !input.kind || source.kind === input.kind)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .map((source) => structuredClone(source));
  }

  async getClaim(id: string): Promise<Claim | null> {
    const claim = this.claims.get(id);
    return claim ? structuredClone(claim) : null;
  }

  async getClaimsForRevision(revisionId: string): Promise<Claim[]> {
    return [...this.claims.values()]
      .filter((claim) => claim.revisionId === revisionId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((claim) => structuredClone(claim));
  }

  async reconcileClaims(input: { ownerProfile: string; revisionId: string; extractionVersion: string; claims: ReconcileClaimInput[] }) {
    const profile = this.registry.extractionProfiles.get(input.ownerProfile);
    if (!profile) throw new Error(`Unknown extraction profile: ${input.ownerProfile}`);
    const revision = this.revisions.get(input.revisionId);
    if (!revision) throw new Error(`Unknown source revision: ${input.revisionId}`);
    const source = this.sources.get(revision.sourceId);
    if (!source) throw new Error(`Unknown source for revision: ${input.revisionId}`);
    const isLatestRevision = !source.latestRevisionId || source.latestRevisionId === revision.id;
    const now = new Date().toISOString();
    const desired = new Map<string, Claim>();
    for (const candidate of input.claims) {
      const subject = this.entities.get(candidate.subjectEntityId);
      if (!subject) throw new Error(`Unknown claim subject: ${candidate.subjectEntityId}`);
      const predicate = this.registry.predicates.get(candidate.predicateKey);
      if (!predicate || !profile.predicates.includes(candidate.predicateKey)) throw new Error(`Predicate is not allowed by ${input.ownerProfile}: ${candidate.predicateKey}`);
      if (!assignable(this.registry, subject.typeKeys ?? [subject.typeKey], profile.entityTypes)) throw new Error(`Subject type ${subject.typeKey} is outside ${input.ownerProfile}.`);
      if (!assignable(this.registry, subject.typeKeys ?? [subject.typeKey], predicate.subjectTypes)) throw new Error(`Subject type ${subject.typeKey} is invalid for ${candidate.predicateKey}`);
      let objectSensitivity: KnowledgeSensitivity | undefined;
      if (candidate.object.kind === 'entity') {
        if (predicate.objectKind === 'literal') throw new Error(`Predicate ${candidate.predicateKey} requires a literal object.`);
        const object = this.entities.get(candidate.object.entityId);
        if (!object) throw new Error(`Unknown claim object: ${candidate.object.entityId}`);
        if (!assignable(this.registry, object.typeKeys ?? [object.typeKey], profile.entityTypes)) throw new Error(`Object type ${object.typeKey} is outside ${input.ownerProfile}.`);
        if (!assignable(this.registry, object.typeKeys ?? [object.typeKey], predicate.objectTypes)) throw new Error(`Object type ${object.typeKey} is invalid for ${candidate.predicateKey}`);
        objectSensitivity = object.sensitivity;
      } else if (predicate.objectKind === 'entity') {
        throw new Error(`Predicate ${candidate.predicateKey} requires an entity object.`);
      }
      if (candidate.confidence < 0 || candidate.confidence > 1) throw new Error('Claim confidence must be between zero and one.');
      if (candidate.evidenceIds.length === 0) throw new Error('Accepted claims require at least one evidence span.');
      for (const id of candidate.evidenceIds) {
        const span = this.evidence.get(id);
        if (!span || span.revisionId !== input.revisionId) throw new Error(`Evidence ${id} does not belong to revision ${input.revisionId}.`);
      }
      const subjectTypeDefinitions = (subject.typeKeys ?? [subject.typeKey]).map((key) => this.registry.entityTypes.get(key));
      const objectTypeDefinitions = candidate.object.kind === 'entity'
        ? (this.entities.get(candidate.object.entityId)?.typeKeys ?? []).map((key) => this.registry.entityTypes.get(key))
        : [];
      const minimumSensitivity = maximumSensitivity([
        source.sensitivity,
        predicate.sensitivity,
        subject.sensitivity,
        objectSensitivity,
        ...subjectTypeDefinitions.map((definition) => definition?.sensitivity),
        ...objectTypeDefinitions.map((definition) => definition?.sensitivity),
      ]);
      const allowedUses = allowedUseIntersection([
        source.allowedUses,
        predicate.allowedUses,
        ...subjectTypeDefinitions.map((definition) => definition?.allowedUses),
        ...objectTypeDefinitions.map((definition) => definition?.allowedUses),
      ]);
      assertPolicyDoesNotEscalate({
        requestedSensitivity: candidate.sensitivity,
        minimumSensitivity,
        requestedUses: candidate.allowedUses,
        allowedUses,
        target: 'Claim',
      });
      const id = stableKnowledgeId('claim', this.organizationId, input.ownerProfile, input.revisionId, candidate.subjectEntityId, candidate.predicateKey, claimObjectKey(candidate.object), candidate.statement.trim());
      const existing = this.claims.get(id);
      desired.set(id, {
        id,
        schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
        organizationId: this.organizationId,
        ownerProfile: input.ownerProfile,
        revisionId: input.revisionId,
        subjectEntityId: candidate.subjectEntityId,
        predicateKey: candidate.predicateKey,
        object: candidate.object,
        statement: candidate.statement.trim(),
        evidenceIds: [...new Set(candidate.evidenceIds)].sort(),
        status: isLatestRevision ? 'accepted' : 'superseded',
        confidence: candidate.confidence,
        sensitivity: candidate.sensitivity ?? minimumSensitivity,
        allowedUses: candidate.allowedUses ?? allowedUses,
        validFrom: candidate.validFrom,
        validUntil: candidate.validUntil,
        extractionVersion: input.extractionVersion,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }
    let created = 0;
    let unchanged = 0;
    let superseded = 0;
    for (const claim of this.claims.values()) {
      const claimRevision = this.revisions.get(claim.revisionId);
      const belongsToLivingSource = claimRevision?.sourceId === revision.sourceId;
      if (isLatestRevision && belongsToLivingSource && claim.ownerProfile === input.ownerProfile && claim.status === 'accepted' && !desired.has(claim.id)) {
        this.claims.set(claim.id, { ...claim, status: 'superseded', updatedAt: now });
        superseded += 1;
      }
    }
    for (const [id, claim] of desired) {
      const existing = this.claims.get(id);
      if (existing && JSON.stringify({ ...existing, updatedAt: undefined }) === JSON.stringify({ ...claim, updatedAt: undefined })) unchanged += 1;
      else if (!existing) created += 1;
      this.claims.set(id, claim);
    }
    return { claims: [...desired.values()].map((claim) => structuredClone(claim)), created, unchanged, superseded };
  }

  async recordAssessment(input: Omit<Assessment, 'id' | 'schemaVersion' | 'organizationId' | 'createdAt' | 'sensitivity' | 'allowedUses'> & { id?: string; sensitivity?: KnowledgeSensitivity; allowedUses?: KnowledgeUse[] }): Promise<Assessment> {
    if (input.subjectEntityIds.length === 0) throw new Error('Knowledge assessments require at least one subject entity.');
    const subjects = [...new Set(input.subjectEntityIds)].map((id) => this.entities.get(id));
    if (subjects.some((entity) => !entity)) throw new Error('Knowledge assessment subject must exist in this organization.');
    const ids = [...new Set([...input.supportingClaimIds, ...input.contradictingClaimIds])];
    if (ids.length === 0) throw new Error('Knowledge assessments require at least one accepted claim.');
    if (input.supportingClaimIds.some((id) => input.contradictingClaimIds.includes(id))) throw new Error('A claim cannot both support and contradict one assessment.');
    this.requireAcceptedClaims(ids);
    const claims = ids.map((id) => this.claims.get(id)!);
    const subjectDefinitions = subjects.flatMap((entity) => (entity?.typeKeys ?? []).map((key) => this.registry.entityTypes.get(key)));
    const minimumSensitivity = maximumSensitivity([...claims.map(({ sensitivity }) => sensitivity), ...subjects.map((entity) => entity?.sensitivity), ...subjectDefinitions.map((definition) => definition?.sensitivity)]);
    const allowedUses = allowedUseIntersection([...claims.map(({ allowedUses: uses }) => uses), ...subjectDefinitions.map((definition) => definition?.allowedUses)]);
    assertPolicyDoesNotEscalate({ requestedSensitivity: input.sensitivity, minimumSensitivity, requestedUses: input.allowedUses, allowedUses, target: 'Assessment' });
    const id = input.id ?? stableKnowledgeId('assessment', this.organizationId, input.kind, input.policyKey, input.policyVersion, ...input.subjectEntityIds);
    const createdAt = this.assessments.get(id)?.createdAt ?? new Date().toISOString();
    const value: Assessment = { ...input, subjectEntityIds: [...new Set(input.subjectEntityIds)], id, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId, sensitivity: input.sensitivity ?? minimumSensitivity, allowedUses: input.allowedUses ?? allowedUses, createdAt };
    this.assessments.set(value.id, value);
    return structuredClone(value);
  }

  async recordArtifact(input: Omit<Artifact, 'id' | 'schemaVersion' | 'organizationId' | 'createdAt' | 'sensitivity' | 'allowedUses'> & { id?: string; sensitivity?: KnowledgeSensitivity; allowedUses?: KnowledgeUse[] }): Promise<Artifact> {
    this.requireAcceptedClaims(input.usedClaimIds);
    const claims = input.usedClaimIds.map((id) => this.claims.get(id)!);
    const allowedEvidence = new Set(input.usedClaimIds.flatMap((id) => this.claims.get(id)?.evidenceIds ?? []));
    if (input.usedEvidenceIds.some((id) => !allowedEvidence.has(id))) throw new Error('Artifact evidence must be provided by one of its used claims.');
    const minimumSensitivity = claims.length ? maximumSensitivity(claims.map(({ sensitivity }) => sensitivity)) : (input.sensitivity ?? 'workspace');
    const allowedUses: KnowledgeUse[] = claims.length ? allowedUseIntersection(claims.map(({ allowedUses: uses }) => uses)) : (input.allowedUses ?? ['internal']);
    assertPolicyDoesNotEscalate({ requestedSensitivity: input.sensitivity, minimumSensitivity, requestedUses: input.allowedUses, allowedUses, target: 'Artifact' });
    const now = new Date().toISOString();
    const id = input.id ?? stableKnowledgeId('artifact', this.organizationId, input.kind, input.externalId ?? now);
    const createdAt = this.artifacts.get(id)?.createdAt ?? now;
    const value: Artifact = { ...input, id, schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId, usedClaimIds: [...new Set(input.usedClaimIds)], usedEvidenceIds: [...new Set(input.usedEvidenceIds)], sensitivity: input.sensitivity ?? minimumSensitivity, allowedUses: input.allowedUses ?? allowedUses, createdAt };
    this.artifacts.set(value.id, value);
    return structuredClone(value);
  }

  async recordRun(input: Omit<KnowledgeRun, 'id' | 'schemaVersion' | 'organizationId'> & { id?: string }): Promise<KnowledgeRun> {
    const value: KnowledgeRun = { ...input, id: input.id ?? stableKnowledgeId('run', this.organizationId, input.kind, input.profileKey, input.startedAt), schemaVersion: KNOWLEDGE_SCHEMA_VERSION, organizationId: this.organizationId };
    this.runs.set(value.id, value);
    return structuredClone(value);
  }

  async findSuccessfulExtraction(input: { revisionId: string; registryHash: string; profileKey: string; adapterKey: string; adapterVersion: string }): Promise<{ run: KnowledgeRun; claims: Claim[] } | null> {
    const revision = this.revisions.get(input.revisionId);
    const source = revision ? this.sources.get(revision.sourceId) : undefined;
    if (!revision || source?.latestRevisionId !== revision.id) return null;
    const run = [...this.runs.values()]
      .filter((candidate) => candidate.kind === 'extraction'
        && candidate.status === 'succeeded'
        && candidate.revisionId === input.revisionId
        && candidate.registryHash === input.registryHash
        && candidate.profileKey === input.profileKey
        && candidate.adapterKey === input.adapterKey
        && candidate.adapterVersion === input.adapterVersion)
      .sort((left, right) => (right.completedAt ?? right.startedAt).localeCompare(left.completedAt ?? left.startedAt))[0];
    if (!run) return null;
    const claims = [...this.claims.values()]
      .filter((claim) => claim.revisionId === input.revisionId && claim.ownerProfile === input.profileKey && claim.status === 'accepted')
      .sort((left, right) => left.id.localeCompare(right.id));
    if ((run.metrics.accepted ?? claims.length) !== claims.length) return null;
    return { run: structuredClone(run), claims: claims.map((claim) => structuredClone(claim)) };
  }

  async search(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResult> {
    const projection = this.requireProjection(query.projectionKey, query.policy);
    const text = query.query.normalize('NFKC').trim();
    if (!text) throw new Error('Knowledge search requires a non-empty query.');
    const limit = Math.min(Math.max(query.limit ?? projection.defaultLimit, 1), projection.defaultLimit, 100);
    const entityIsProjected = (entity: CanonicalEntity | undefined) => !!entity
      && sensitivityRank[entity.sensitivity] <= sensitivityRank[query.policy.maxSensitivity]
      && projection.entityTypes.some((type) => assignable(this.registry, entity.typeKeys ?? [entity.typeKey], [type]));
    const authorizedClaims = restrictClaims([...this.claims.values()], query.policy)
      .filter((claim) => this.claimLineageIsAuthorized(claim, query.policy))
      .filter((claim) => projection.predicates.includes(claim.predicateKey))
      .filter((claim) => query.minimumConfidence === undefined || claim.confidence >= query.minimumConfidence)
      .filter((claim) => entityIsProjected(this.entities.get(claim.subjectEntityId)))
      .filter((claim) => claim.object.kind !== 'entity' || entityIsProjected(this.entities.get(claim.object.entityId)));
    const visibleClaimIdsByEntity = new Map<string, string[]>();
    for (const claim of authorizedClaims) {
      for (const entityId of [claim.subjectEntityId, ...(claim.object.kind === 'entity' ? [claim.object.entityId] : [])]) {
        visibleClaimIdsByEntity.set(entityId, [...(visibleClaimIdsByEntity.get(entityId) ?? []), claim.id]);
      }
    }
    const entityHits = [...this.entities.values()]
      .filter(entityIsProjected)
      .map((entity) => ({
        entity,
        score: lexicalScore(text, [entity.name, entity.normalizedName, ...entity.aliases, entity.typeKey, ...(entity.typeKeys ?? [])]),
      }))
      .filter(({ score }) => score > 0)
      .map(({ entity, score }) => ({
        kind: 'entity' as const,
        id: entity.id,
        label: entity.name,
        score,
        entityIds: [entity.id],
        claimIds: visibleClaimIdsByEntity.get(entity.id) ?? [],
        typeKeys: entity.typeKeys ?? [entity.typeKey],
      }));
    const claimHits = authorizedClaims
      .map((claim) => ({ claim, score: lexicalScore(text, [claim.statement, claim.predicateKey, ...(claim.object.kind === 'literal' ? [String(claim.object.value)] : [])]) }))
      .filter(({ score }) => score > 0)
      .map(({ claim, score }) => {
        const subject = this.entities.get(claim.subjectEntityId)!;
        const entityIds = [claim.subjectEntityId, ...(claim.object.kind === 'entity' ? [claim.object.entityId] : [])];
        return {
          kind: 'claim' as const,
          id: claim.id,
          label: claim.statement,
          snippet: claim.statement,
          score: Number((score * (0.75 + claim.confidence * 0.25)).toFixed(4)),
          entityIds,
          claimIds: [claim.id],
          typeKeys: subject.typeKeys ?? [subject.typeKey],
        };
      });
    const hits = [...entityHits, ...claimHits]
      .sort((left, right) => right.score - left.score || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id))
      .slice(0, limit);
    return {
      registryHash: this.registry.hash,
      projectionKey: query.projectionKey,
      query: text,
      hits,
      generatedAt: new Date().toISOString(),
    };
  }

  async traverse(query: KnowledgeTraversalQuery): Promise<KnowledgeTraversalResult> {
    const projection = this.requireProjection(query.projectionKey, query.policy);
    const maxHops = query.maxHops ?? 2;
    const maxPaths = query.maxPaths ?? 50;
    if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 3) throw new Error('Knowledge traversal maxHops must be between 1 and 3.');
    if (!Number.isInteger(maxPaths) || maxPaths < 1 || maxPaths > 100) throw new Error('Knowledge traversal maxPaths must be between 1 and 100.');
    const startEntityIds = [...new Set(query.startEntityIds)];
    if (startEntityIds.length === 0 || startEntityIds.length > 20) throw new Error('Knowledge traversal requires between 1 and 20 start entities.');
    const direction = query.direction ?? 'both';
    const selectedPredicates = query.predicateKeys?.length
      ? [...new Set(query.predicateKeys)]
      : [...projection.predicates];
    if (selectedPredicates.some((key) => !projection.predicates.includes(key))) {
      throw new Error(`Knowledge traversal predicate is outside projection ${query.projectionKey}.`);
    }
    const entityIsProjected = (entity: CanonicalEntity | undefined) => !!entity
      && sensitivityRank[entity.sensitivity] <= sensitivityRank[query.policy.maxSensitivity]
      && projection.entityTypes.some((type) => assignable(this.registry, entity.typeKeys ?? [entity.typeKey], [type]));
    for (const id of startEntityIds) {
      if (!entityIsProjected(this.entities.get(id))) throw new Error(`Start entity is unavailable in projection ${query.projectionKey}: ${id}`);
    }
    const authorizedClaims = restrictClaims([...this.claims.values()], query.policy)
      .filter((claim) => this.claimLineageIsAuthorized(claim, query.policy))
      .filter((claim) => selectedPredicates.includes(claim.predicateKey))
      .filter((claim) => query.minimumConfidence === undefined || claim.confidence >= query.minimumConfidence)
      .filter((claim) => entityIsProjected(this.entities.get(claim.subjectEntityId)))
      .filter((claim) => claim.object.kind !== 'entity' || entityIsProjected(this.entities.get(claim.object.entityId)));
    const semanticClaims = authorizedClaims.filter((claim) => claim.object.kind === 'entity');
    const paths: KnowledgeTraversalResult['paths'] = [];
    const selectedClaimIds = new Set<string>();
    const selectedEntityIds = new Set(startEntityIds);
    let truncated = false;
    let frontier = startEntityIds.map((id) => ({ entityIds: [id], claimIds: [] as string[], directions: [] as Array<'outgoing' | 'incoming'> }));
    for (let hop = 0; hop < maxHops && frontier.length > 0; hop += 1) {
      const next: typeof frontier = [];
      for (const path of frontier) {
        const current = path.entityIds[path.entityIds.length - 1];
        const adjacent: Array<{ claim: Claim; nextId: string; edgeDirection: 'outgoing' | 'incoming' }> = [];
        for (const claim of semanticClaims) {
          if ((direction === 'outgoing' || direction === 'both') && claim.subjectEntityId === current && claim.object.kind === 'entity') {
            adjacent.push({ claim, nextId: claim.object.entityId, edgeDirection: 'outgoing' });
          }
          if ((direction === 'incoming' || direction === 'both') && claim.object.kind === 'entity' && claim.object.entityId === current) {
            adjacent.push({ claim, nextId: claim.subjectEntityId, edgeDirection: 'incoming' });
          }
        }
        adjacent.sort((left, right) => right.claim.confidence - left.claim.confidence || left.claim.id.localeCompare(right.claim.id));
        for (const edge of adjacent) {
          if (path.entityIds.includes(edge.nextId)) continue;
          if (paths.length >= maxPaths) {
            truncated = true;
            break;
          }
          const expanded = {
            entityIds: [...path.entityIds, edge.nextId],
            claimIds: [...path.claimIds, edge.claim.id],
            directions: [...path.directions, edge.edgeDirection],
          };
          paths.push(expanded);
          next.push(expanded);
          selectedClaimIds.add(edge.claim.id);
          selectedEntityIds.add(edge.nextId);
        }
        if (truncated) break;
      }
      frontier = truncated ? [] : next;
    }
    if (query.includeLiterals) {
      for (const claim of authorizedClaims) {
        if (claim.object.kind === 'literal' && selectedEntityIds.has(claim.subjectEntityId)) selectedClaimIds.add(claim.id);
      }
    }
    const claims = authorizedClaims.filter((claim) => selectedClaimIds.has(claim.id));
    const edges = claims.flatMap((claim) => claim.object.kind === 'entity' ? [{
      claimId: claim.id,
      predicateKey: claim.predicateKey,
      subjectEntityId: claim.subjectEntityId,
      objectEntityId: claim.object.entityId,
      statement: claim.statement,
      confidence: claim.confidence,
      evidenceIds: [...claim.evidenceIds],
    }] : []);
    return {
      registryHash: this.registry.hash,
      projectionKey: query.projectionKey,
      startEntityIds,
      entities: [...selectedEntityIds].map((id) => this.entities.get(id)).filter((value): value is CanonicalEntity => !!value).map((entity) => structuredClone(entity)),
      claims: claims.map((claim) => structuredClone(claim)),
      edges,
      paths,
      truncated,
      generatedAt: new Date().toISOString(),
    };
  }

  async queryContext(query: ContextQuery): Promise<ContextBundle> {
    const projection = this.requireProjection(query.projectionKey, query.policy);
    const subjectIds = new Set(query.subjectEntityIds ?? []);
    const allowedTypes = new Set(projection.entityTypes);
    const allowedPredicates = new Set(projection.predicates);
    const claims = restrictClaims([...this.claims.values()], query.policy)
      .filter((claim) => this.claimLineageIsAuthorized(claim, query.policy))
      .filter((claim) => allowedPredicates.has(claim.predicateKey))
      .filter((claim) => query.minimumConfidence === undefined || claim.confidence >= query.minimumConfidence)
      .filter((claim) => subjectIds.size === 0 || subjectIds.has(claim.subjectEntityId) || (claim.object.kind === 'entity' && subjectIds.has(claim.object.entityId)))
      .filter((claim) => {
        const subject = this.entities.get(claim.subjectEntityId);
        const object = claim.object.kind === 'entity' ? this.entities.get(claim.object.entityId) : undefined;
        const entityIsProjected = (entity: CanonicalEntity | undefined) => !!entity
          && [...allowedTypes].some((type) => assignable(this.registry, entity.typeKeys ?? [entity.typeKey], [type]));
        return entityIsProjected(subject) && (claim.object.kind !== 'entity' || entityIsProjected(object));
      })
      .sort((left, right) => right.confidence - left.confidence || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, Math.min(query.limit ?? projection.defaultLimit, projection.defaultLimit));
    const entityIds = new Set(claims.flatMap((claim) => [claim.subjectEntityId, ...(claim.object.kind === 'entity' ? [claim.object.entityId] : [])]));
    const evidenceIds = new Set(claims.flatMap((claim) => claim.evidenceIds));
    const evidence = [...evidenceIds].map((id) => this.evidence.get(id)).filter((value): value is EvidenceSpan => !!value);
    const revisionIds = new Set(evidence.map((value) => value.revisionId));
    const sourceIds = new Set([...revisionIds].map((id) => this.revisions.get(id)?.sourceId).filter((id): id is string => !!id));
    const selectedClaimIds = new Set(claims.map(({ id }) => id));
    const artifacts = [...this.artifacts.values()]
      .filter((artifact) => projection.artifactKinds?.includes(artifact.kind))
      .filter((artifact) => artifact.usedClaimIds.length > 0 && artifact.usedClaimIds.every((id) => selectedClaimIds.has(id)))
      .filter((artifact) => sensitivityRank[artifact.sensitivity] <= sensitivityRank[query.policy.maxSensitivity] && artifact.allowedUses.includes(query.policy.use));
    const assessments = [...this.assessments.values()]
      .filter((assessment) => projection.assessmentKinds?.includes(assessment.kind))
      .filter((assessment) => subjectIds.size === 0 || assessment.subjectEntityIds.some((id) => subjectIds.has(id)))
      .filter((assessment) => [...assessment.supportingClaimIds, ...assessment.contradictingClaimIds].every((id) => selectedClaimIds.has(id)))
      .filter((assessment) => sensitivityRank[assessment.sensitivity] <= sensitivityRank[query.policy.maxSensitivity] && assessment.allowedUses.includes(query.policy.use));
    const contradictions = claims.map((claim) => ({
      claimId: claim.id,
      conflictingClaimIds: this.registry.predicates.get(claim.predicateKey)?.cardinality === 'one'
        ? claims.filter((other) => other.id !== claim.id && other.subjectEntityId === claim.subjectEntityId && other.predicateKey === claim.predicateKey && claimObjectKey(other.object) !== claimObjectKey(claim.object)).map((other) => other.id)
        : [],
    })).filter((entry) => entry.conflictingClaimIds.length > 0);
    return {
      registryHash: this.registry.hash,
      projectionKey: query.projectionKey,
      subjectEntityIds: [...subjectIds],
      claims: claims.map((claim) => structuredClone(claim)),
      entities: [...entityIds].map((id) => this.entities.get(id)).filter((value): value is CanonicalEntity => !!value).map((entity) => structuredClone(entity)),
      evidence: evidence.map((span) => structuredClone(span)),
      sources: [...sourceIds].map((id) => this.sources.get(id)).filter((value): value is KnowledgeSource => !!value).map(({ id, kind, canonicalUri, title, sensitivity }) => ({
        id,
        kind,
        canonicalUri,
        title,
        sensitivity,
        revisionIds: [...revisionIds].filter((revisionId) => this.revisions.get(revisionId)?.sourceId === id),
      })),
      artifacts: artifacts.map((artifact) => structuredClone(artifact)),
      assessments: assessments.map((assessment) => structuredClone(assessment)),
      contradictions,
      generatedAt: new Date().toISOString(),
    };
  }

  async explain(id: string, policy: KnowledgePolicyContext): Promise<Explanation | null> {
    const directClaim = this.claims.get(id);
    const assessment = this.assessments.get(id);
    const artifact = this.artifacts.get(id);
    const target = directClaim ?? assessment ?? artifact;
    if (!target) return null;
    if (!directClaim) {
      const sensitivity = 'sensitivity' in target ? target.sensitivity : 'restricted';
      const allowedUses = 'allowedUses' in target ? target.allowedUses : ['internal'];
      if (sensitivityRank[sensitivity] > sensitivityRank[policy.maxSensitivity] || !allowedUses.includes(policy.use)) return null;
    }
    const claimIds = directClaim
      ? [directClaim.id]
      : artifact
        ? artifact.usedClaimIds
        : [...(assessment?.supportingClaimIds ?? []), ...(assessment?.contradictingClaimIds ?? [])];
    const claims = restrictClaims(claimIds.map((claimId) => this.claims.get(claimId)).filter((claim): claim is Claim => !!claim), policy)
      .filter((claim) => this.claimLineageIsAuthorized(claim, policy));
    if (directClaim && claims.length === 0) return null;
    if (!directClaim && claimIds.length > 0 && claims.length === 0) return null;
    const evidence = [...new Set(claims.flatMap((claim) => claim.evidenceIds))].map((evidenceId) => this.evidence.get(evidenceId)).filter((value): value is EvidenceSpan => !!value);
    const revisions = [...new Set(evidence.map((span) => span.revisionId))].map((revisionId) => this.revisions.get(revisionId)).filter((value): value is SourceRevision => !!value);
    const sources = [...new Set(revisions.map((revision) => revision.sourceId))].map((sourceId) => this.sources.get(sourceId)).filter((value): value is KnowledgeSource => !!value);
    return {
      target: structuredClone(target),
      claims: claims.map((claim) => structuredClone(claim)),
      evidence: evidence.map((span) => structuredClone(span)),
      revisions: revisions.map(({ content: _content, ...revision }) => structuredClone(revision)),
      sources: sources.map((source) => structuredClone(source)),
    };
  }

  private requireAcceptedClaims(ids: readonly string[]) {
    for (const id of ids) {
      const claim = this.claims.get(id);
      if (!claim || claim.status !== 'accepted' || claim.organizationId !== this.organizationId) throw new Error(`Claim is not accepted in this organization: ${id}`);
    }
  }

  private requireProjection(projectionKey: string, policy: KnowledgePolicyContext) {
    if (policy.organizationId !== this.organizationId) throw new Error('Knowledge policy organization does not match the repository boundary.');
    const projection = this.registry.readProjections.get(projectionKey);
    if (!projection) throw new Error(`Unknown knowledge projection: ${projectionKey}`);
    if (!projection.allowedUses.includes(policy.use)) throw new Error(`Projection ${projectionKey} is not allowed for ${policy.use}.`);
    return projection;
  }

  private claimLineageIsAuthorized(claim: Claim, policy: KnowledgePolicyContext): boolean {
    const revision = this.revisions.get(claim.revisionId);
    const source = revision ? this.sources.get(revision.sourceId) : undefined;
    const subject = this.entities.get(claim.subjectEntityId);
    const object = claim.object.kind === 'entity' ? this.entities.get(claim.object.entityId) : undefined;
    if (!revision || !source || !subject || (claim.object.kind === 'entity' && !object)) return false;
    if (source.organizationId !== policy.organizationId || !source.allowedUses.includes(policy.use) || sensitivityRank[source.sensitivity] > sensitivityRank[policy.maxSensitivity]) return false;
    if (sensitivityRank[subject.sensitivity] > sensitivityRank[policy.maxSensitivity]) return false;
    if (object && sensitivityRank[object.sensitivity] > sensitivityRank[policy.maxSensitivity]) return false;
    return claim.evidenceIds.every((id) => this.evidence.get(id)?.revisionId === revision.id);
  }
}
