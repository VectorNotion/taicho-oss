import { createHash } from 'node:crypto';
import type {
  KnowledgeNote,
  KnowledgeNoteAttribution,
  KnowledgeNoteKind,
  KnowledgeNoteStatus,
  KnowledgeSensitivity,
  KnowledgeSource,
  SourceRevision,
} from './domain';
import type { KnowledgePolicyContext } from './policy';
import type { KnowledgeRepository } from './repository';
import type { KnowledgeUse } from './registry/types';

const NOTE_PROFILE = 'core.agent_note';
const NOTE_PREDICATE = 'core.has_statement';
const NOTE_EXTRACTION_VERSION = 'agent-note.v1';
const sensitivityRank: Record<KnowledgeSensitivity, number> = { public: 0, workspace: 1, restricted: 2 };

export interface CreateKnowledgeNoteInput {
  key: string;
  kind: KnowledgeNoteKind;
  content: string;
  subjectEntityIds: string[];
  basedOnClaimIds?: string[];
  sensitivity?: KnowledgeSensitivity;
  allowedUses?: KnowledgeUse[];
  confidence?: number;
  validUntil?: string;
  attribution: KnowledgeNoteAttribution;
}

export interface ReviseKnowledgeNoteInput {
  noteId: string;
  expectedRevisionId?: string;
  content: string;
  kind?: KnowledgeNoteKind;
  subjectEntityIds?: string[];
  basedOnClaimIds?: string[];
  sensitivity?: KnowledgeSensitivity;
  allowedUses?: KnowledgeUse[];
  confidence?: number;
  validUntil?: string;
  attribution: KnowledgeNoteAttribution;
}

export interface QueryKnowledgeNotesInput {
  policy: KnowledgePolicyContext;
  subjectEntityIds?: string[];
  kinds?: KnowledgeNoteKind[];
  statuses?: KnowledgeNoteStatus[];
  limit?: number;
}

type StoredNoteMetadata = {
  noteKind: KnowledgeNoteKind;
  noteStatus: KnowledgeNoteStatus;
  subjectEntityIds: string[];
  basedOnClaimIds: string[];
  confidence: number;
  validUntil?: string;
  attribution: KnowledgeNoteAttribution;
};

function noteMetadata(value: unknown): StoredNoteMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoredNoteMetadata>;
  if (!candidate.noteKind || !candidate.noteStatus || !Array.isArray(candidate.subjectEntityIds) || !Array.isArray(candidate.basedOnClaimIds) || typeof candidate.confidence !== 'number' || !candidate.attribution) return null;
  return candidate as StoredNoteMetadata;
}

function noteHash(content: string, metadata: StoredNoteMetadata): string {
  return createHash('sha256').update(JSON.stringify({ content, metadata })).digest('hex');
}

function normalizedContent(content: string): string {
  const value = content.normalize('NFKC').trim();
  if (!value) throw new Error('Knowledge notes require non-empty content.');
  if (value.length > 20_000) throw new Error('Knowledge notes cannot exceed 20,000 characters.');
  return value;
}

function normalizedConfidence(confidence = 0.8): number {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('Knowledge note confidence must be between zero and one.');
  return confidence;
}

function normalizedSubjects(subjectEntityIds: readonly string[]): string[] {
  const values = [...new Set(subjectEntityIds.map((value) => value.trim()).filter(Boolean))];
  if (values.length === 0 || values.length > 20) throw new Error('Knowledge notes require between 1 and 20 subject entities.');
  return values;
}

async function requireNoteSource(repository: KnowledgeRepository, noteId: string) {
  const source = await repository.getSource(noteId);
  if (!source || source.kind !== 'note' || !source.canonicalUri.startsWith('agent-note://')) throw new Error(`Unknown agent note: ${noteId}`);
  const revision = source.latestRevisionId ? await repository.getSourceRevision(source.latestRevisionId) : null;
  const metadata = noteMetadata(revision?.metadata);
  if (!revision || !metadata) throw new Error(`Agent note has no valid current revision: ${noteId}`);
  return { source, revision, metadata };
}

export async function getKnowledgeNote(repository: KnowledgeRepository, noteId: string, policy: KnowledgePolicyContext): Promise<KnowledgeNote | null> {
  const source = await repository.getSource(noteId);
  if (!source || source.kind !== 'note' || source.organizationId !== policy.organizationId || !source.allowedUses.includes(policy.use) || sensitivityRank[source.sensitivity] > sensitivityRank[policy.maxSensitivity] || !source.latestRevisionId) return null;
  const revision = await repository.getSourceRevision(source.latestRevisionId);
  const metadata = noteMetadata(revision?.metadata);
  if (!revision || !metadata) return null;
  if (!policy.includeStale && metadata.validUntil && new Date(metadata.validUntil) < (policy.now ?? new Date())) return null;
  return materializeNote(repository, source, revision);
}

async function materializeNote(repository: KnowledgeRepository, source: KnowledgeSource, revision: SourceRevision): Promise<KnowledgeNote> {
  const metadata = noteMetadata(revision.metadata);
  if (!metadata) throw new Error(`Agent note revision metadata is invalid: ${revision.id}`);
  const claims = await repository.getClaimsForRevision(revision.id);
  return {
    id: source.id,
    sourceId: source.id,
    revisionId: revision.id,
    organizationId: source.organizationId,
    kind: metadata.noteKind,
    status: metadata.noteStatus,
    content: revision.content,
    subjectEntityIds: [...metadata.subjectEntityIds],
    basedOnClaimIds: [...metadata.basedOnClaimIds],
    claimIds: claims.filter((claim) => claim.status === 'accepted').map((claim) => claim.id),
    evidenceIds: [...new Set(claims.flatMap((claim) => claim.evidenceIds))],
    sensitivity: source.sensitivity,
    allowedUses: [...source.allowedUses],
    confidence: metadata.confidence,
    validUntil: metadata.validUntil,
    attribution: { ...metadata.attribution },
    createdAt: source.createdAt,
    updatedAt: revision.capturedAt,
  };
}

async function persistNoteRevision(repository: KnowledgeRepository, input: {
  source: KnowledgeSource;
  content: string;
  metadata: StoredNoteMetadata;
}): Promise<KnowledgeNote> {
  const capturedAt = new Date().toISOString();
  const { revision } = await repository.putSourceRevision({
    sourceId: input.source.id,
    content: input.content,
    contentHash: noteHash(input.content, input.metadata),
    capturedAt,
    metadata: input.metadata,
  });
  const evidence = input.metadata.noteStatus === 'active'
    ? await repository.putEvidenceSpans(revision.id, [{ start: 0, end: input.content.length, excerpt: input.content, locator: 'agent-note:content' }])
    : [];
  await repository.reconcileClaims({
    ownerProfile: NOTE_PROFILE,
    revisionId: revision.id,
    extractionVersion: NOTE_EXTRACTION_VERSION,
    claims: input.metadata.noteStatus === 'active'
      ? input.metadata.subjectEntityIds.map((subjectEntityId) => ({
        subjectEntityId,
        predicateKey: NOTE_PREDICATE,
        object: { kind: 'literal' as const, value: input.content, valueType: 'string' as const },
        statement: input.content,
        evidenceIds: [evidence[0].id],
        confidence: input.metadata.confidence,
        sensitivity: input.source.sensitivity,
        allowedUses: input.source.allowedUses,
        validUntil: input.metadata.validUntil,
      }))
      : [],
  });
  const currentSource = await repository.getSource(input.source.id);
  if (!currentSource) throw new Error(`Agent note source disappeared: ${input.source.id}`);
  return materializeNote(repository, currentSource, revision);
}

export async function createKnowledgeNote(repository: KnowledgeRepository, input: CreateKnowledgeNoteInput): Promise<KnowledgeNote> {
  const key = input.key.normalize('NFKC').trim();
  if (!key || key.length > 240) throw new Error('Knowledge note key must contain between 1 and 240 characters.');
  const content = normalizedContent(input.content);
  const subjectEntityIds = normalizedSubjects(input.subjectEntityIds);
  for (const id of subjectEntityIds) if (!await repository.getEntity(id)) throw new Error(`Unknown knowledge note subject: ${id}`);
  for (const id of [...new Set(input.basedOnClaimIds ?? [])]) {
    const claim = await repository.getClaim(id);
    if (!claim || claim.organizationId !== repository.organizationId || claim.status !== 'accepted') throw new Error(`Knowledge note can cite only accepted claims in this organization: ${id}`);
  }
  const metadata: StoredNoteMetadata = {
    noteKind: input.kind,
    noteStatus: 'active',
    subjectEntityIds,
    basedOnClaimIds: [...new Set(input.basedOnClaimIds ?? [])],
    confidence: normalizedConfidence(input.confidence),
    validUntil: input.validUntil,
    attribution: { ...input.attribution },
  };
  const source = await repository.upsertSource({
    kind: 'note',
    canonicalUri: `agent-note://${encodeURIComponent(key)}`,
    title: content.length > 100 ? `${content.slice(0, 97)}...` : content,
    sensitivity: input.sensitivity ?? 'workspace',
    allowedUses: input.allowedUses ?? ['internal'],
    metadata: { managedBy: NOTE_EXTRACTION_VERSION },
  });
  return persistNoteRevision(repository, { source, content, metadata });
}

export async function reviseKnowledgeNote(repository: KnowledgeRepository, input: ReviseKnowledgeNoteInput): Promise<KnowledgeNote> {
  const current = await requireNoteSource(repository, input.noteId);
  if (input.expectedRevisionId && current.revision.id !== input.expectedRevisionId) throw new Error('Knowledge note changed since it was read. Refresh it before revising.');
  const subjectEntityIds = normalizedSubjects(input.subjectEntityIds ?? current.metadata.subjectEntityIds);
  const basedOnClaimIds = [...new Set(input.basedOnClaimIds ?? current.metadata.basedOnClaimIds)];
  for (const id of subjectEntityIds) if (!await repository.getEntity(id)) throw new Error(`Unknown knowledge note subject: ${id}`);
  for (const id of basedOnClaimIds) {
    const claim = await repository.getClaim(id);
    if (!claim || claim.organizationId !== repository.organizationId || claim.status !== 'accepted') throw new Error(`Knowledge note can cite only accepted claims in this organization: ${id}`);
  }
  const source = await repository.upsertSource({
    kind: 'note',
    canonicalUri: current.source.canonicalUri,
    sensitivity: input.sensitivity ?? current.source.sensitivity,
    allowedUses: input.allowedUses ?? current.source.allowedUses,
  });
  const metadata: StoredNoteMetadata = {
    noteKind: input.kind ?? current.metadata.noteKind,
    noteStatus: 'active',
    subjectEntityIds,
    basedOnClaimIds,
    confidence: normalizedConfidence(input.confidence ?? current.metadata.confidence),
    validUntil: input.validUntil ?? current.metadata.validUntil,
    attribution: { ...input.attribution },
  };
  return persistNoteRevision(repository, { source, content: normalizedContent(input.content), metadata });
}

export async function retractKnowledgeNote(repository: KnowledgeRepository, input: {
  noteId: string;
  expectedRevisionId?: string;
  reason?: string;
  attribution: KnowledgeNoteAttribution;
}): Promise<KnowledgeNote> {
  const current = await requireNoteSource(repository, input.noteId);
  if (input.expectedRevisionId && current.revision.id !== input.expectedRevisionId) throw new Error('Knowledge note changed since it was read. Refresh it before retracting.');
  const reason = input.reason?.normalize('NFKC').trim();
  const content = reason ? `Retracted: ${reason}` : 'Retracted.';
  return persistNoteRevision(repository, {
    source: current.source,
    content,
    metadata: { ...current.metadata, noteStatus: 'retracted', attribution: { ...input.attribution } },
  });
}

export async function queryKnowledgeNotes(repository: KnowledgeRepository, input: QueryKnowledgeNotesInput): Promise<KnowledgeNote[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const subjectIds = new Set(input.subjectEntityIds ?? []);
  const statuses = input.statuses ?? ['active'];
  const sources = await repository.listSources({ kind: 'note' });
  const notes: KnowledgeNote[] = [];
  for (const source of sources) {
    if (notes.length >= limit) break;
    if (source.organizationId !== input.policy.organizationId
      || sensitivityRank[source.sensitivity] > sensitivityRank[input.policy.maxSensitivity]
      || !source.allowedUses.includes(input.policy.use)
      || !source.latestRevisionId) continue;
    const revision = await repository.getSourceRevision(source.latestRevisionId);
    const metadata = noteMetadata(revision?.metadata);
    if (!revision || !metadata) continue;
    if (input.kinds?.length && !input.kinds.includes(metadata.noteKind)) continue;
    if (!statuses.includes(metadata.noteStatus)) continue;
    if (subjectIds.size > 0 && !metadata.subjectEntityIds.some((id) => subjectIds.has(id))) continue;
    if (!input.policy.includeStale && metadata.validUntil && new Date(metadata.validUntil) < (input.policy.now ?? new Date())) continue;
    notes.push(await materializeNote(repository, source, revision));
  }
  return notes;
}
