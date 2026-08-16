"use client";

import { useMemo } from "react";
import { useCapabilityStream } from "@content-automation/ui/hooks/use-capability-stream";

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
  /** Which entity the lane belongs to; drives which card renders it. */
  scope?: "person" | "account";
  /** Entity name supplied by a cascaded research operation. */
  entityName?: string;
}

export interface BackgroundResearchTarget {
  entityId: string;
  scope: "person" | "account";
  phase: "researching";
}

const PHASE_ORDER: Record<DimensionLane["phase"], number> = { searching: 0, found: 1, matched: 2 };

/**
 * Drives a dimension-research stream (account or prospect) and folds the
 * cumulative `data-dimension-progress` parts into one lane per dimension,
 * keeping the most advanced phase and merging the fields that arrive with it.
 */
export function useDimensionResearch(
  /** Stream-capability rest path under /api/v1, without the /stream suffix. */
  api: string,
  options: { primaryScope?: "person" | "account" } = {},
) {
  const stream = useCapabilityStream<unknown, unknown>({ api });
  const primaryScope = options.primaryScope ?? "person";

  const allDimensions = useMemo(() => {
    // Key by scope + dimensionKey so a person and account lane never collide.
    const map = new Map<string, DimensionLane>();
    for (const part of stream.dataParts) {
      if (part.type !== "data-dimension-progress") continue;
      const d = part.data as DimensionLane;
      if (!d?.dimensionKey) continue;
      const scope = d.scope ?? primaryScope;
      const mapKey = `${scope}:${d.dimensionKey}`;
      const existing = map.get(mapKey) ?? {
        dimensionKey: d.dimensionKey,
        name: d.name,
        type: d.type,
        phase: "searching" as const,
        scope,
      };
      const next: DimensionLane = {
        ...existing,
        name: d.name ?? existing.name,
        type: d.type ?? existing.type,
        scope,
        entityName: d.entityName ?? existing.entityName,
      };
      if (PHASE_ORDER[d.phase] >= PHASE_ORDER[existing.phase]) next.phase = d.phase;
      if (d.observedValue !== undefined) next.observedValue = d.observedValue;
      if (d.signals !== undefined) next.signals = d.signals;
      if (d.evidence !== undefined) next.evidence = d.evidence;
      if (d.matchScore !== undefined) next.matchScore = d.matchScore;
      if (d.classification !== undefined) next.classification = d.classification;
      map.set(mapKey, next);
    }
    return [...map.values()];
  }, [primaryScope, stream.dataParts]);

  const backgroundTargets = useMemo(() => {
    const targets = new Map<string, BackgroundResearchTarget>();
    for (const part of stream.dataParts) {
      if (part.type !== "data-research-cascade") continue;
      const target = part.data as BackgroundResearchTarget;
      if (!target?.entityId || !target.scope) continue;
      targets.set(`${target.scope}:${target.entityId}`, target);
    }
    return [...targets.values()];
  }, [stream.dataParts]);

  // The primary entity's lanes vs the cascaded other-entity's lanes. On the
  // prospect stream, `person` is the prospect and `account` is its company card;
  // on the account stream, `account` is the primary and `person` would be a
  // prospect. Callers render each on its own card.
  const dimensions = useMemo(
    () => allDimensions.filter((d) => d.scope === primaryScope),
    [allDimensions, primaryScope],
  );
  const personDimensions = useMemo(() => allDimensions.filter((d) => d.scope === "person"), [allDimensions]);
  const accountDimensions = useMemo(() => allDimensions.filter((d) => d.scope === "account"), [allDimensions]);

  return {
    start: stream.start,
    isStreaming: stream.isStreaming,
    final: stream.final,
    error: stream.error,
    dimensions,
    personDimensions,
    accountDimensions,
    backgroundTargets,
    isComplete: stream.final !== null,
  };
}
