import type { BaseEntityKind } from '../registry/types';

export const ONTOLOGY_SCHEMA_VERSION = 'knowledge.v1' as const;

/**
 * A recurring concept the extractor could not type against the current
 * ontology. Candidates accumulate recurrence across documents; the curation
 * pass turns durable clusters into learned types with no human approval.
 */
export interface TypeCandidate {
  id: string;
  schemaVersion: typeof ONTOLOGY_SCHEMA_VERSION;
  organizationId: string;
  /** Surface form as extracted, e.g. "hybrid retrieval". */
  surface: string;
  normalizedSurface: string;
  /** The extractor's own loose type phrase, e.g. "retrieval technique". */
  proposedTypeName: string;
  normalizedProposedTypeName: string;
  /** One-line definition drafted at extraction time. */
  definition: string;
  baseKind: BaseEntityKind;
  /** Extraction profile that produced the miss. */
  profileKey: string;
  /** Evidence excerpt from the most recent observation. */
  evidence: string;
  /** Distinct source documents (canonical URIs) that produced this candidate. */
  docRefs: string[];
  /** Canonical entities stored under a generic kind awaiting a real type. */
  entityIds: string[];
  recurrence: number;
  status: 'open' | 'promoted' | 'dismissed' | 'vetoed';
  promotedTypeKey?: string;
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

export type OntologyEventKind =
  | 'candidate_recorded'
  | 'type_created'
  | 'type_removed'
  | 'type_vetoed'
  | 'alias_mapped'
  | 'candidate_dismissed'
  | 'entities_merged';

/** Append-only audit trail of every automatic ontology change. */
export interface OntologyEvent {
  id: string;
  schemaVersion: typeof ONTOLOGY_SCHEMA_VERSION;
  organizationId: string;
  kind: OntologyEventKind;
  summary: string;
  detail: Record<string, unknown>;
  at: string;
}

/** A veto is permanent rejection memory: the same type never comes back. */
export interface OntologyVeto {
  id: string;
  schemaVersion: typeof ONTOLOGY_SCHEMA_VERSION;
  organizationId: string;
  normalizedName: string;
  typeKey?: string;
  reason?: string;
  at: string;
}

export interface LearnedTypeRecord {
  key: string;
  name: string;
  description: string;
  baseKind: BaseEntityKind;
  createdAt: string;
}
