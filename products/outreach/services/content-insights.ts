import type {
  ContentInsight,
  ContentInsightProviderResult,
  ContentInsightState,
} from "@content-automation/content-generator/domain/content-insight";
import { getWorkspaceAccountOpportunityCoverage } from "./account-opportunity-coverage";

function bestMatch<T extends { score: number }>(matches: T[]): T | undefined {
  return matches.reduce<T | undefined>(
    (best, match) => !best || match.score > best.score ? match : best,
    undefined,
  );
}

function insightState(input: {
  eligible: boolean;
  solutionGap: boolean;
  contentGap: boolean;
}): ContentInsightState {
  if (!input.eligible) return "account_ineligible";
  if (input.solutionGap) return "solution_gap";
  if (input.contentGap) return "content_gap";
  return "covered";
}

function insightReason(state: ContentInsightState): string {
  switch (state) {
    case "content_gap":
      return "The account and offering are viable, but current published content is below the coverage threshold.";
    case "solution_gap":
      return "Current catalogue coverage is below threshold. Product or solution work comes before content production.";
    case "account_ineligible":
      return "The account does not currently pass the ICP gate, so this demand is not actionable yet.";
    case "covered":
      return "Both catalogue and published-content coverage pass their current thresholds.";
  }
}

/** Outreach contributes a calculated read model; no ContentGap record is created. */
export async function getOutreachContentInsights(deps: {
  getCoverage?: typeof getWorkspaceAccountOpportunityCoverage;
} = {}): Promise<ContentInsightProviderResult> {
  const coverage = await (deps.getCoverage ?? getWorkspaceAccountOpportunityCoverage)();
  if (coverage.calculationStatus === "unavailable") {
    return {
      provider: "outreach",
      providerLabel: "Outreach",
      calculationStatus: "unavailable",
      unavailableReason: coverage.unavailableReason,
      insights: [],
    };
  }

  const insights: ContentInsight[] = coverage.opportunities.flatMap((opportunity) => {
    if (!opportunity.coverage) return [];
    const state = insightState({
      eligible: opportunity.account.eligible,
      solutionGap: opportunity.coverage.solutionGap,
      contentGap: opportunity.coverage.contentGap,
    });
    const content = bestMatch(opportunity.contentMatches);
    const solution = bestMatch(opportunity.solutionMatches);
    return [{
      id: `outreach:${opportunity.id}`,
      provider: "outreach",
      providerLabel: "Outreach",
      sourceId: opportunity.id,
      title: opportunity.angle,
      state,
      reason: insightReason(state),
      currentContentScore: content?.score ?? 0,
      contentThreshold: coverage.thresholds.content,
      supportingMatch: solution ? {
        id: solution.catalogItemId,
        label: solution.name,
        score: solution.score,
      } : undefined,
      context: {
        id: opportunity.account.id,
        label: opportunity.account.name,
        href: `/outreach/accounts/${opportunity.account.id}`,
        fitScore: opportunity.account.icpScore,
        timingScore: opportunity.account.timingScore,
      },
      evidence: opportunity.evidence,
      generatedAt: opportunity.generatedAt,
    }];
  });

  return {
    provider: "outreach",
    providerLabel: "Outreach",
    calculationStatus: "ready",
    insights,
  };
}
