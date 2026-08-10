"use client";

import { useMemo } from "react";
import { useActionStream } from "@/hooks/use-action-stream";

export interface DimensionSignal {
  signal: string;
  date: string;
  evidence: string[];
  confidence: number;
}

export interface DimensionLane {
  dimensionKey: string;
  name: string;
  type: "fit" | "timing";
  phase: "searching" | "found" | "matched";
  observedValue?: string;
  signals?: DimensionSignal[];
  evidence?: string[];
  matchScore?: number;
  classification?: string;
}

const PHASE_ORDER: Record<DimensionLane["phase"], number> = { searching: 0, found: 1, matched: 2 };

/**
 * Drives a dimension-research stream (account or prospect) and folds the
 * cumulative `data-dimension-progress` parts into one lane per dimension,
 * keeping the most advanced phase and merging the fields that arrive with it.
 */
export function useDimensionResearch(api: string) {
  const stream = useActionStream<unknown, unknown>({ api });

  const dimensions = useMemo(() => {
    const map = new Map<string, DimensionLane>();
    for (const part of stream.dataParts) {
      if (part.type !== "data-dimension-progress") continue;
      const d = part.data as DimensionLane;
      if (!d?.dimensionKey) continue;
      const existing = map.get(d.dimensionKey) ?? {
        dimensionKey: d.dimensionKey,
        name: d.name,
        type: d.type,
        phase: "searching" as const,
      };
      const next: DimensionLane = { ...existing, name: d.name ?? existing.name, type: d.type ?? existing.type };
      if (PHASE_ORDER[d.phase] >= PHASE_ORDER[existing.phase]) next.phase = d.phase;
      if (d.observedValue !== undefined) next.observedValue = d.observedValue;
      if (d.signals !== undefined) next.signals = d.signals;
      if (d.evidence !== undefined) next.evidence = d.evidence;
      if (d.matchScore !== undefined) next.matchScore = d.matchScore;
      if (d.classification !== undefined) next.classification = d.classification;
      map.set(d.dimensionKey, next);
    }
    return [...map.values()];
  }, [stream.dataParts]);

  return {
    start: stream.start,
    isStreaming: stream.isStreaming,
    final: stream.final,
    error: stream.error,
    dimensions,
  };
}
