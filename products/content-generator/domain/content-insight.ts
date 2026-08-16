import type { CreateContentIdeaInput } from "./content";

export type ContentInsightState =
  | "content_gap"
  | "solution_gap"
  | "account_ineligible"
  | "covered";

export interface ContentInsightMatch {
  id: string;
  label: string;
  score: number;
}

/**
 * A dashboard read model contributed by a product module. It is deliberately
 * not a persisted Gap entity: providers recalculate these fields from their
 * current source data whenever the feed is read.
 */
export interface ContentInsight {
  id: string;
  provider: string;
  providerLabel: string;
  sourceId: string;
  title: string;
  state: ContentInsightState;
  reason: string;
  currentContentScore: number;
  contentThreshold: number;
  supportingMatch?: ContentInsightMatch;
  context?: {
    id: string;
    label: string;
    href: string;
    fitScore?: number | null;
    timingScore?: number | null;
  };
  evidence: string[];
  generatedAt: string;
}

export interface ContentInsightProviderResult {
  provider: string;
  providerLabel: string;
  calculationStatus: "ready" | "unavailable";
  unavailableReason?: string;
  insights: ContentInsight[];
}

export interface ContentInsightFeed {
  calculatedAt: string;
  calculationStatus: "ready" | "partial" | "unavailable";
  unavailableReasons: string[];
  summary: {
    total: number;
    contentGaps: number;
    solutionGaps: number;
    ineligible: number;
    covered: number;
    blockedContexts: number;
  };
  insights: ContentInsight[];
}

const STATE_ORDER: Record<ContentInsightState, number> = {
  content_gap: 0,
  solution_gap: 1,
  account_ineligible: 2,
  covered: 3,
};

/** Combine independent module projections without asking a model to rank them. */
export function combineContentInsightProviders(
  providers: ContentInsightProviderResult[],
  calculatedAt = new Date().toISOString(),
): ContentInsightFeed {
  const insights = providers
    .flatMap((provider) => provider.insights)
    .sort((left, right) =>
      STATE_ORDER[left.state] - STATE_ORDER[right.state]
      || (right.context?.fitScore ?? -1) - (left.context?.fitScore ?? -1)
      || (right.context?.timingScore ?? -1) - (left.context?.timingScore ?? -1)
      || left.currentContentScore - right.currentContentScore
      || left.title.localeCompare(right.title)
      || left.id.localeCompare(right.id));
  const unavailable = providers.filter((provider) => provider.calculationStatus === "unavailable");
  const blockedContexts = new Set(insights
    .filter((insight) => insight.state === "content_gap")
    .map((insight) => insight.context?.id)
    .filter((id): id is string => Boolean(id)));
  return {
    calculatedAt,
    calculationStatus: providers.length === 0 || unavailable.length === 0
      ? "ready"
      : unavailable.length === providers.length
        ? "unavailable"
        : "partial",
    unavailableReasons: unavailable
      .map((provider) => provider.unavailableReason)
      .filter((reason): reason is string => Boolean(reason)),
    summary: {
      total: insights.length,
      contentGaps: insights.filter((insight) => insight.state === "content_gap").length,
      solutionGaps: insights.filter((insight) => insight.state === "solution_gap").length,
      ineligible: insights.filter((insight) => insight.state === "account_ineligible").length,
      covered: insights.filter((insight) => insight.state === "covered").length,
      blockedContexts: blockedContexts.size,
    },
    insights,
  };
}

/**
 * Promote a calculated content gap into a durable idea without generating or
 * persisting the gap itself. The source snapshot keeps the idea explainable
 * even when later catalogue/content changes recalculate the insight.
 */
export function contentIdeaInputFromInsight(insight: ContentInsight): CreateContentIdeaInput & {
  sourceInsight: NonNullable<CreateContentIdeaInput["sourceInsight"]>;
} {
  if (insight.state !== "content_gap") {
    throw new Error("Only an actionable content gap can become a content idea.");
  }
  const account = insight.context?.label ?? "Workspace demand";
  const solution = insight.supportingMatch
    ? `${insight.supportingMatch.label} (${insight.supportingMatch.score}% match)`
    : "No catalogue match";
  return {
    title: insight.title,
    description: `${account} has this account-level opportunity. The strongest current offering is ${solution}.`,
    rationale: `${insight.reason} Best published-content coverage is ${insight.currentContentScore}% against the required ${insight.contentThreshold}%.`,
    priority: "medium",
    sourceInsight: {
      provider: insight.provider,
      sourceId: insight.sourceId,
      title: insight.title,
      contextId: insight.context?.id,
      contextLabel: insight.context?.label,
      evidence: insight.evidence,
      generatedAt: insight.generatedAt,
    },
  };
}
