import assert from "node:assert/strict";
import test from "node:test";
import type {
  WorkspaceAccountOpportunityCoverageResult,
  WorkspaceAccountOpportunityWithCoverage,
} from "../domain/account-opportunity";
import { getOutreachContentInsights } from "../services/content-insights";

function opportunity(input: {
  id: string;
  eligible?: boolean;
  solutionGap?: boolean;
  contentGap?: boolean;
  solutionScores?: number[];
  contentScores?: number[];
}): WorkspaceAccountOpportunityWithCoverage {
  const eligible = input.eligible ?? true;
  const solutionGap = input.solutionGap ?? false;
  const contentGap = input.contentGap ?? false;
  return {
    id: input.id,
    accountId: `account-${input.id}`,
    angle: `Opportunity ${input.id}`,
    sourceDimensionKeys: ["manual_work"],
    evidence: ["https://example.test/evidence"],
    evidenceConfidence: 0.8,
    researchRunId: "research-1",
    generatedAt: "2026-08-16T00:00:00.000Z",
    account: {
      id: `account-${input.id}`,
      name: `Account ${input.id}`,
      icpScore: eligible ? 85 : 40,
      timingScore: 72,
      hardExcluded: false,
      eligible,
    },
    solutionMatches: (input.solutionScores ?? []).map((score, index) => ({
      catalogItemId: `catalog-${index}`,
      name: `Solution ${index}`,
      kind: "service",
      score,
    })),
    contentMatches: (input.contentScores ?? []).map((score, index) => ({
      contentId: `content-${index}`,
      title: `Content ${index}`,
      type: "blog_post",
      publishedUrl: `https://example.test/content-${index}`,
      score,
    })),
    coverage: { solutionGap, contentGap, touchReady: eligible && !solutionGap && !contentGap },
  };
}

test("maps current Outreach coverage into flat account-level insight states", async () => {
  const coverage: WorkspaceAccountOpportunityCoverageResult = {
    calculationStatus: "ready",
    thresholds: { solution: 65, content: 65 },
    opportunities: [
      opportunity({ id: "content", contentGap: true, solutionScores: [70, 91], contentScores: [20, 42] }),
      opportunity({ id: "solution", solutionGap: true, contentGap: true }),
      opportunity({ id: "ineligible", eligible: false, contentGap: true }),
      opportunity({ id: "covered", solutionScores: [80], contentScores: [75] }),
    ],
  };
  const result = await getOutreachContentInsights({ getCoverage: async () => coverage });

  assert.equal(result.calculationStatus, "ready");
  assert.deepEqual(result.insights.map((item) => item.state), [
    "content_gap",
    "solution_gap",
    "account_ineligible",
    "covered",
  ]);
  assert.equal(result.insights[0]?.supportingMatch?.label, "Solution 1");
  assert.equal(result.insights[0]?.supportingMatch?.score, 91);
  assert.equal(result.insights[0]?.currentContentScore, 42);
  assert.equal(result.insights[0]?.context?.id, "account-content");
});

test("passes an unavailable coverage calculation through without fabricated insights", async () => {
  const result = await getOutreachContentInsights({
    getCoverage: async () => ({
      calculationStatus: "unavailable",
      unavailableReason: "Embedding configuration is missing.",
      thresholds: { solution: 65, content: 65 },
      opportunities: [],
    }),
  });
  assert.deepEqual(result, {
    provider: "outreach",
    providerLabel: "Outreach",
    calculationStatus: "unavailable",
    unavailableReason: "Embedding configuration is missing.",
    insights: [],
  });
});
