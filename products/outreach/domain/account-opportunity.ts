export interface AccountOpportunityAngle {
  id: string;
  accountId: string;
  angle: string;
  sourceDimensionKeys: string[];
  evidence: string[];
  evidenceConfidence: number;
  researchRunId: string;
  generatedAt: string;
}

export interface OpportunitySolutionMatch {
  catalogItemId: string;
  name: string;
  kind: string;
  summary?: string;
  positioning?: string;
  outcomes?: string;
  differentiators?: string;
  proof?: string;
  score: number;
}

export interface OpportunityContentMatch {
  contentId: string;
  title: string;
  type: string;
  publishedUrl: string;
  score: number;
}

export interface OpportunityCoverageCalculation {
  solutionGap: boolean;
  contentGap: boolean;
  touchReady: boolean;
}

export interface AccountOpportunityWithCoverage extends AccountOpportunityAngle {
  solutionMatches: OpportunitySolutionMatch[];
  contentMatches: OpportunityContentMatch[];
  /** Null means embeddings are unavailable; it never represents a persisted gap. */
  coverage: OpportunityCoverageCalculation | null;
}

export interface OpportunityCoverageThresholds {
  solution: number;
  content: number;
}

export interface AccountOpportunityCoverageResult {
  calculationStatus: "ready" | "unavailable";
  unavailableReason?: string;
  accountEligible: boolean;
  thresholds: OpportunityCoverageThresholds;
  opportunities: AccountOpportunityWithCoverage[];
}

export interface WorkspaceAccountOpportunityWithCoverage extends AccountOpportunityWithCoverage {
  account: {
    id: string;
    name: string;
    icpScore: number | null;
    timingScore: number | null;
    hardExcluded: boolean;
    eligible: boolean;
  };
}

export interface WorkspaceAccountOpportunityCoverageResult {
  calculationStatus: "ready" | "unavailable";
  unavailableReason?: string;
  thresholds: OpportunityCoverageThresholds;
  opportunities: WorkspaceAccountOpportunityWithCoverage[];
}

export const DEFAULT_OPPORTUNITY_COVERAGE_THRESHOLDS: OpportunityCoverageThresholds = {
  solution: 65,
  content: 65,
};

export function similarityPercent(similarity: number): number {
  if (!Number.isFinite(similarity)) return 0;
  return Math.round(Math.max(0, Math.min(1, similarity)) * 100);
}

/**
 * Gaps and touch readiness are projections of current match scores. They are
 * deliberately not durable domain records: changing Catalog or content must
 * change the answer without rewriting the opportunity angle.
 */
export function calculateOpportunityCoverage(
  solutionMatches: OpportunitySolutionMatch[],
  contentMatches: OpportunityContentMatch[],
  accountEligible: boolean,
  thresholds: OpportunityCoverageThresholds = DEFAULT_OPPORTUNITY_COVERAGE_THRESHOLDS,
): OpportunityCoverageCalculation {
  const bestSolution = Math.max(0, ...solutionMatches.map((match) => match.score));
  const bestContent = Math.max(0, ...contentMatches.map((match) => match.score));
  const solutionGap = bestSolution < thresholds.solution;
  const contentGap = bestContent < thresholds.content;
  return {
    solutionGap,
    contentGap,
    touchReady: accountEligible && !solutionGap && !contentGap,
  };
}

/** Pull the current gaps from a calculated list without creating a Gap record. */
export function selectOpportunityGaps(
  opportunities: AccountOpportunityWithCoverage[],
): AccountOpportunityWithCoverage[] {
  return opportunities.filter((opportunity) =>
    opportunity.coverage != null
    && (opportunity.coverage.solutionGap || opportunity.coverage.contentGap));
}
