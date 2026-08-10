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
}

/** Adapt dimension progress into a `data-dimension-progress` stream part. */
export function streamingDimensionProgress(emit: StreamEmit): (part: DimensionProgress) => void {
  return (part) =>
    emit({ type: 'data-dimension-progress', id: `${part.dimensionKey}-${part.phase}`, data: part });
}
