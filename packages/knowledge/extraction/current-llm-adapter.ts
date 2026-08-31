import type { BoundedExtractionSchema, ExtractionCandidates, ExtractionChunk, ExtractorAdapter } from './types';

export type StructuredExtractionFunction = (input: {
  chunks: ExtractionChunk[];
  schema: BoundedExtractionSchema;
  signal?: AbortSignal;
}) => Promise<ExtractionCandidates>;

/** Compatibility boundary for the current structured-output model provider. */
export class CurrentLlmExtractionAdapter implements ExtractorAdapter {
  readonly key = 'current-structured-llm';
  constructor(readonly version: string, private readonly generate: StructuredExtractionFunction) {}
  extract(input: { chunks: ExtractionChunk[]; schema: BoundedExtractionSchema; signal?: AbortSignal }) {
    return this.generate(input);
  }
}
