import type { KnowledgeSensitivity, SourceKind } from '../domain';
import type { KnowledgeUse } from '../registry/types';

export interface SourceDocument {
  kind: SourceKind;
  canonicalUri: string;
  title?: string;
  content: string;
  language?: string;
  capturedAt?: string;
  sensitivity?: KnowledgeSensitivity;
  allowedUses?: KnowledgeUse[];
  metadata?: Record<string, unknown>;
}

export interface SourceAdapter<I = unknown> {
  readonly key: string;
  readonly version: string;
  load(input: I): Promise<SourceDocument>;
}

export class InlineSourceAdapter implements SourceAdapter<SourceDocument> {
  readonly key = 'knowledge.inline';
  readonly version = '1';
  async load(input: SourceDocument) { return input; }
}
