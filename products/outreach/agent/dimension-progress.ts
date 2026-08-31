/**
 * Streaming progress for dimension-driven research (design 2026-08-10 §5, §6).
 * One `DimensionProgress` = one lane of the research surface, shared by the
 * account and prospect research operations.
 */
import type { StreamEmit } from '@content-automation/platform/agents/streaming';
import type { TimingSignal } from '../domain/qualification';

export interface DimensionProgress {
  dimensionKey: string;
  name: string;
  type: 'fit' | 'timing';
  phase: 'searching' | 'found' | 'matched';
  observedValue?: string;
  signals?: TimingSignal[];
  evidence?: string[];
  matchScore?: number;
  classification?: string;
  /**
   * Which entity this lane belongs to. Defaults to the primary entity of the
   * operation ('person' on the prospect stream, 'account' on the account stream).
   * The cross-entity cascade tags the *other* side so one stream can carry both:
   * researching a prospect streams its account's lanes as 'account', and vice
   * versa (streamed compactly). The UI groups by scope.
   */
  scope?: 'person' | 'account';
  /** Name of the entity this lane belongs to (e.g. the account name), for grouping headers. */
  entityName?: string;
}

export interface ResearchPageActivity {
  title: string;
  url: string;
  /** A bounded Markdown excerpt of the text supplied to synthesis. */
  contentPreview: string;
  status: 'extracted' | 'snippet' | 'failed';
  error?: string;
}

/**
 * Provider-level activity that is persisted with durable research operations.
 * This deliberately describes real work (queries, pages, and synthesis), not
 * presentation steps invented by the frontend.
 */
export interface ResearchActivity {
  type:
    | 'query_started'
    | 'query_completed'
    | 'query_failed'
    | 'synthesis_started'
    | 'synthesis_completed'
    | 'observations_persisted'
    | 'graph_enrichment_started'
    | 'graph_enrichment_completed'
    | 'graph_enrichment_warning'
    | 'scoring_started'
    | 'scoring_completed'
    | 'scope_completed';
  scope: 'person' | 'account';
  occurredAt: string;
  dimensionKey?: string;
  dimensionName?: string;
  query?: string;
  pagesFound?: number;
  pagesRead?: number;
  pagesFailed?: number;
  durationMs?: number;
  pages?: ResearchPageActivity[];
  criteriaTotal?: number;
  criteriaCompleted?: number;
  criteriaWithoutEvidence?: number;
  observationCount?: number;
  claimCount?: number;
  entityCount?: number;
  warnings?: string[];
  error?: string;
}

/** Adapt dimension progress into a `data-dimension-progress` stream part. */
export function streamingDimensionProgress(emit: StreamEmit): (part: DimensionProgress) => void {
  return (part) =>
    emit({
      type: 'data-dimension-progress',
      id: `${part.scope ?? 'person'}-${part.dimensionKey}-${part.phase}`,
      data: part,
    });
}
