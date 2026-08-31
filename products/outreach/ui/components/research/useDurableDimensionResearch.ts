"use client";

import { useMemo } from "react";
import { useDurableOperation } from "@content-automation/ui/hooks/use-durable-operation";
import type { BackgroundResearchTarget, DimensionLane } from "./useDimensionResearch";

export interface ResearchPageTelemetry {
  title: string;
  url: string;
  contentPreview: string;
  status: "extracted" | "snippet" | "failed";
  error?: string;
}

export interface ResearchActivityTelemetry {
  id: string;
  type:
    | "query_started"
    | "query_completed"
    | "query_failed"
    | "synthesis_started"
    | "synthesis_completed"
    | "observations_persisted"
    | "graph_enrichment_started"
    | "graph_enrichment_completed"
    | "graph_enrichment_warning"
    | "scoring_started"
    | "scoring_completed"
    | "scope_completed";
  scope: "person" | "account";
  occurredAt: string;
  dimensionKey?: string;
  dimensionName?: string;
  query?: string;
  pagesFound?: number;
  pagesRead?: number;
  pagesFailed?: number;
  durationMs?: number;
  pages?: ResearchPageTelemetry[];
  criteriaTotal?: number;
  criteriaCompleted?: number;
  criteriaWithoutEvidence?: number;
  observationCount?: number;
  claimCount?: number;
  entityCount?: number;
  warnings?: string[];
  error?: string;
}

export interface ResearchTelemetrySnapshot {
  startedAt: string;
  queriesStarted: number;
  queriesCompleted: number;
  pagesFound: number;
  pagesRead: number;
  pagesFailed: number;
  activeQueries: string[];
  activities: ResearchActivityTelemetry[];
}

interface DimensionResearchProgressSnapshot {
  kind: "dimension-research";
  dimensions: DimensionLane[];
  backgroundTargets: BackgroundResearchTarget[];
  telemetry?: ResearchTelemetrySnapshot;
  updatedAt: string;
}

/** Durable counterpart to the interactive SSE research hook. */
export function useDurableDimensionResearch({
  action,
  entityId,
  startApi,
  body,
  primaryScope,
}: {
  action: "research_prospect" | "research_account";
  entityId: string;
  startApi: string;
  body: Record<string, unknown>;
  primaryScope: "person" | "account";
}) {
  const durable = useDurableOperation<Record<string, unknown>, DimensionResearchProgressSnapshot>({
    action,
    entityId,
    startApi,
    body,
  });
  const allDimensions = durable.progressSnapshot?.dimensions ?? [];
  const dimensions = useMemo(
    () => allDimensions.filter((dimension) => (dimension.scope ?? primaryScope) === primaryScope),
    [allDimensions, primaryScope],
  );
  const personDimensions = useMemo(
    () => allDimensions.filter((dimension) => (dimension.scope ?? primaryScope) === "person"),
    [allDimensions, primaryScope],
  );
  const accountDimensions = useMemo(
    () => allDimensions.filter((dimension) => (dimension.scope ?? primaryScope) === "account"),
    [allDimensions, primaryScope],
  );

  return {
    start: durable.start,
    retry: durable.retry,
    isRetrying: durable.isRetrying,
    isStreaming: durable.isRunning,
    final: durable.final,
    error: durable.error,
    dimensions,
    personDimensions,
    accountDimensions,
    backgroundTargets: durable.progressSnapshot?.backgroundTargets ?? [],
    telemetry: durable.progressSnapshot?.telemetry ?? null,
    isComplete: durable.isComplete,
    operationId: durable.operation?.id ?? null,
    operationStatus: durable.operation?.status ?? null,
    progress: durable.operation?.progress ?? 0,
    startedAt: durable.operation?.startedAt ?? durable.operation?.createdAt ?? null,
    completedAt: durable.operation?.completedAt ?? null,
  };
}
