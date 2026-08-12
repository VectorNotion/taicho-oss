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

/** Adapt dimension progress into a `data-dimension-progress` stream part. */
export function streamingDimensionProgress(emit: StreamEmit): (part: DimensionProgress) => void {
  return (part) =>
    emit({
      type: 'data-dimension-progress',
      id: `${part.scope ?? 'person'}-${part.dimensionKey}-${part.phase}`,
      data: part,
    });
}
