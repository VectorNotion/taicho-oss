import { createHash } from 'node:crypto';
import type { KnowledgeUse } from './registry/types';

export const KNOWLEDGE_SCHEMA_VERSION = 'knowledge.v1' as const;
export type KnowledgeSensitivity = 'public' | 'workspace' | 'restricted';
export type SourceKind = 'web' | 'note' | 'transcript' | 'reply' | 'manual' | 'product' | 'api';
export type ClaimStatus = 'candidate' | 'accepted' | 'rejected' | 'superseded';

export interface KnowledgeSource {
  id: string;
  schemaVersion: typeof KNOWLEDGE_SCHEMA_VERSION;
  organizationId: string;
  kind: SourceKind;
  canonicalUri: string;
  title?: string;
  sensitivity: KnowledgeSensitivity;
  allowedUses: KnowledgeUse[];
  metadata: Record<string, unknown>;
  latestRevisionId?: string;
  /** Most recent observation time, including a source reverting to an older content hash. */
  latestRevisionObservedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceRevision {
  id: string;
  schemaVersion: typeof KNOWLEDGE_SCHEMA_VERSION;
  organizationId: string;
  sourceId: string;
  contentHash: string;
  content: string;
  language?: string;
  capturedAt: string;
  metadata: Record<string, unknown>;
}

export interface EvidenceSpan {
  id: string;
  schemaVersion: typeof KNOWLEDGE_SCHEMA_VERSION;
  organizationId: string;
  revisionId: string;
  start: number;
  end: number;
  excerpt: string;
  locator?: string;
}

export interface CanonicalEntity {
  id: string;
  schemaVersion: typeof KNOWLEDGE_SCHEMA_VERSION;
  organizationId: string;
  /** Primary historical type plus every module-contributed role on this identity. */
  typeKey: string;
  typeKeys: string[];
  name: string;
  normalizedName: string;
  aliases: string[];
  externalIds: Record<string, string>;
  sensitivity: KnowledgeSensitivity;
  createdAt: string;
  updatedAt: string;
}

export type ClaimObject =
  | { kind: 'entity'; entityId: string }
  | { kind: 'literal'; value: string | number | boolean; valueType: 'string' | 'number' | 'boolean' | 'date' };

export interface Claim {
  id: string;
  schemaVersion: typeof KNOWLEDGE_SCHEMA_VERSION;
  organizationId: string;
  ownerProfile: string;
  revisionId: string;
  subjectEntityId: string;
  predicateKey: string;
  object: ClaimObject;
  statement: string;
  evidenceIds: string[];
  status: ClaimStatus;
  confidence: number;
  sensitivity: KnowledgeSensitivity;
  allowedUses: KnowledgeUse[];
  validFrom?: string;
  validUntil?: string;
  extractionVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface Assessment {
  id: string;
  schemaVersion: typeof KNOWLEDGE_SCHEMA_VERSION;
  organizationId: string;
  kind: string;
  subjectEntityIds: string[];
  policyKey: string;
  policyVersion: number;
  result: Record<string, unknown>;
  supportingClaimIds: string[];
  contradictingClaimIds: string[];
  sensitivity: KnowledgeSensitivity;
  allowedUses: KnowledgeUse[];
  createdAt: string;
}

export interface Artifact {
  id: string;
  schemaVersion: typeof KNOWLEDGE_SCHEMA_VERSION;
  organizationId: string;
  kind: string;
  externalId?: string;
  usedClaimIds: string[];
  usedEvidenceIds: string[];
  sensitivity: KnowledgeSensitivity;
  allowedUses: KnowledgeUse[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface KnowledgeRun {
  id: string;
  schemaVersion: typeof KNOWLEDGE_SCHEMA_VERSION;
  organizationId: string;
  kind: 'ingestion' | 'extraction' | 'assessment' | 'generation' | 'lookup';
  revisionId?: string;
  registryHash?: string;
  profileKey?: string;
  adapterKey?: string;
  adapterVersion?: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  completedAt?: string;
  metrics: Record<string, number>;
}

export interface ContextBundle {
  registryHash: string;
  projectionKey: string;
  subjectEntityIds: string[];
  claims: Claim[];
  entities: CanonicalEntity[];
  evidence: EvidenceSpan[];
  sources: Array<Pick<KnowledgeSource, 'id' | 'kind' | 'canonicalUri' | 'title' | 'sensitivity'> & { revisionIds: string[] }>;
  artifacts: Artifact[];
  assessments: Assessment[];
  contradictions: Array<{ claimId: string; conflictingClaimIds: string[] }>;
  generatedAt: string;
}

export type KnowledgeSearchHit = {
  kind: 'entity' | 'claim';
  id: string;
  label: string;
  score: number;
  entityIds: string[];
  claimIds: string[];
  typeKeys: string[];
  snippet?: string;
};

export interface KnowledgeSearchResult {
  registryHash: string;
  projectionKey: string;
  query: string;
  hits: KnowledgeSearchHit[];
  generatedAt: string;
}

export type KnowledgeTraversalDirection = 'outgoing' | 'incoming' | 'both';

export interface KnowledgeTraversalEdge {
  claimId: string;
  predicateKey: string;
  subjectEntityId: string;
  objectEntityId: string;
  statement: string;
  confidence: number;
  evidenceIds: string[];
}

export interface KnowledgeTraversalPath {
  entityIds: string[];
  claimIds: string[];
  directions: Array<'outgoing' | 'incoming'>;
}

export interface KnowledgeTraversalResult {
  registryHash: string;
  projectionKey: string;
  startEntityIds: string[];
  entities: CanonicalEntity[];
  claims: Claim[];
  edges: KnowledgeTraversalEdge[];
  paths: KnowledgeTraversalPath[];
  truncated: boolean;
  generatedAt: string;
}

export type KnowledgeNoteKind = 'observation' | 'decision' | 'preference' | 'summary' | 'hypothesis';
export type KnowledgeNoteStatus = 'active' | 'retracted';

export interface KnowledgeNoteAttribution {
  actorType: 'user' | 'service' | 'system';
  actorId?: string;
  clientId?: string;
  agentId?: string;
  agentVersionId?: string;
  deploymentId?: string;
  sessionId?: string;
  runId?: string;
  executionId?: string;
  channel?: string;
}

/**
 * Agent-facing view over a note source and its immutable latest revision.
 * Notes remain evidence-backed knowledge sources rather than a second memory store.
 */
export interface KnowledgeNote {
  id: string;
  sourceId: string;
  revisionId: string;
  organizationId: string;
  kind: KnowledgeNoteKind;
  status: KnowledgeNoteStatus;
  content: string;
  subjectEntityIds: string[];
  basedOnClaimIds: string[];
  claimIds: string[];
  evidenceIds: string[];
  sensitivity: KnowledgeSensitivity;
  allowedUses: KnowledgeUse[];
  confidence: number;
  validUntil?: string;
  attribution: KnowledgeNoteAttribution;
  createdAt: string;
  updatedAt: string;
}

export function stableKnowledgeId(prefix: string, ...parts: Array<string | number | boolean | undefined>): string {
  const digest = createHash('sha256').update(parts.map((value) => String(value ?? '')).join('\u001f')).digest('hex').slice(0, 32);
  return `${prefix}_${digest}`;
}
