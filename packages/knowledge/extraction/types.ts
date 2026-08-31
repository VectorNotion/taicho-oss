import type { ClaimObject, KnowledgeSensitivity } from '../domain';
import type { KnowledgeUse } from '../registry/types';

export interface ExtractionChunk {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface CandidateEntity {
  localKey: string;
  typeKey: string;
  name: string;
  aliases?: string[];
  externalIds?: Record<string, string>;
  sensitivity?: KnowledgeSensitivity;
}

export type CandidateClaimObject =
  | { kind: 'entity'; entityKey: string }
  | Extract<ClaimObject, { kind: 'literal' }>;

export interface CandidateClaim {
  subjectKey: string;
  predicateKey: string;
  object: CandidateClaimObject;
  statement: string;
  evidence: Array<{ start: number; end: number; excerpt?: string; locator?: string }>;
  confidence: number;
  sensitivity?: KnowledgeSensitivity;
  allowedUses?: KnowledgeUse[];
  validFrom?: string;
  validUntil?: string;
}

export interface ExtractionCandidates {
  entities: CandidateEntity[];
  claims: CandidateClaim[];
  warnings?: string[];
}

export interface BoundedExtractionSchema {
  profileKeys: string[];
  entityTypes: Array<{ key: string; name: string; description: string; baseKind: string }>;
  predicates: Array<{ key: string; name: string; description: string; subjectTypes: string[]; objectTypes: string[]; objectKind: string }>;
  instructions: string[];
}

export interface ExtractorAdapter {
  readonly key: string;
  readonly version: string;
  extract(input: { chunks: ExtractionChunk[]; schema: BoundedExtractionSchema; signal?: AbortSignal }): Promise<ExtractionCandidates>;
}
