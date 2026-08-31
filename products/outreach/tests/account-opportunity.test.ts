import assert from "node:assert/strict";
import test from "node:test";
import {
  refreshAccountOpportunityAngles,
  type RefreshAccountOpportunitiesInput,
} from "../agent/account-opportunities";
import {
  calculateOpportunityCoverage,
  selectOpportunityGaps,
  similarityPercent,
  type AccountOpportunityWithCoverage,
  type OpportunityContentMatch,
  type OpportunitySolutionMatch,
} from "../domain/account-opportunity";
import type { StoreAccountOpportunityAngle } from "../data/account-opportunity-repository";

const INPUT: RefreshAccountOpportunitiesInput = {
  account: { id: "account-1", name: "Northstar" },
  dimensions: [{
    id: "dimension-1",
    key: "human_process_intensity",
    name: "Human Process Intensity",
    dimensionType: "fit",
    appliesTo: "account",
    researchInstruction: "Research repeated human work.",
    idealValue: "Repeated human work exists.",
    weight: 1,
    freshnessWindowDays: 90,
    isActive: true,
    createdAt: "2026-08-01T00:00:00.000Z",
  }],
  observations: [{
    id: "observation-1",
    dimensionKey: "human_process_intensity",
    shape: "prose",
    observedValue: "Review work is coordinated manually across a large operations team.",
    evidence: ["https://example.test/operations"],
    confidence: 0.8,
    researchedAt: "2026-08-16T00:00:00.000Z",
    runId: "research-1",
    claimIds: ["claim-1"],
    evidenceIds: ["evidence-1"],
  }],
  matches: [{
    dimensionKey: "human_process_intensity",
    matchScore: 0.9,
    effectiveMatch: 0.72,
    classification: "strong_match",
    hardExclusion: false,
    confidence: 0.8,
  }],
  timingBreakdown: [],
  researchRunId: "research-1",
  generatedAt: "2026-08-16T00:00:00.000Z",
};

test("opportunity generation grounds angles in account dimension evidence", async () => {
  let stored: StoreAccountOpportunityAngle[] = [];
  await refreshAccountOpportunityAngles(INPUT, {
    complete: async () => ({
      opportunities: [
        {
          angle: "Reduce the manual coordination required for operational review work.",
          sourceDimensionKeys: ["human_process_intensity"],
        },
        {
          angle: "This unsupported angle must be discarded.",
          sourceDimensionKeys: ["missing_dimension"],
        },
      ],
    }),
    embeddingConfig: () => ({
      embeddingUrl: "https://embedding.test",
      embeddingModel: "test-model",
      embeddingDimensions: 2,
      queryInputType: "query",
      documentInputType: "passage",
    }),
    embed: async (_config, texts, inputType) => {
      assert.deepEqual(texts, ["Reduce the manual coordination required for operational review work."]);
      assert.equal(inputType, "query");
      return [[0.1, 0.2]];
    },
    replace: async (_accountId, opportunities) => {
      stored = opportunities;
      return [];
    },
    id: () => "opportunity-1",
  });

  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.id, "opportunity-1");
  assert.deepEqual(stored[0]?.evidence, ["https://example.test/operations"]);
  assert.deepEqual(stored[0]?.sourceClaimIds, ["claim-1"]);
  assert.deepEqual(stored[0]?.sourceEvidenceIds, ["evidence-1"]);
  assert.equal(stored[0]?.evidenceConfidence, 0.8);
});

test("coverage and touch readiness are calculated from current scores", () => {
  const solutions: OpportunitySolutionMatch[] = [{
    catalogItemId: "catalog-1",
    name: "Automation advisory",
    kind: "service",
    score: 86,
  }];
  const weakContent: OpportunityContentMatch[] = [{
    contentId: "content-1",
    title: "Generic article",
    type: "blog_post",
    publishedUrl: "https://example.test/article",
    score: 42,
  }];
  assert.deepEqual(calculateOpportunityCoverage(solutions, weakContent, true), {
    solutionGap: false,
    contentGap: true,
    touchReady: false,
  });
  assert.deepEqual(calculateOpportunityCoverage(solutions, [{ ...weakContent[0]!, score: 81 }], true), {
    solutionGap: false,
    contentGap: false,
    touchReady: true,
  });
  assert.equal(
    calculateOpportunityCoverage(solutions, [{ ...weakContent[0]!, score: 81 }], false).touchReady,
    false,
    "coverage does not override the account qualification gate",
  );
  assert.equal(
    calculateOpportunityCoverage(
      [{ ...solutions[0]!, score: 20 }, { ...solutions[0]!, catalogItemId: "catalog-2", score: 90 }],
      [{ ...weakContent[0]!, score: 85 }],
      true,
    ).touchReady,
    true,
    "coverage uses the best current match rather than relying on array order",
  );
});

test("cosine similarities are exposed as bounded percentages", () => {
  assert.equal(similarityPercent(0.864), 86);
  assert.equal(similarityPercent(2), 100);
  assert.equal(similarityPercent(-0.3), 0);
});

test("gaps are selected from current calculations rather than stored separately", () => {
  const opportunity = (id: string, solutionGap: boolean): AccountOpportunityWithCoverage => ({
    id,
    accountId: "account-1",
    angle: `Angle ${id}`,
    sourceDimensionKeys: ["human_process_intensity"],
    evidence: [],
    evidenceConfidence: 0.8,
    researchRunId: "research-1",
    generatedAt: "2026-08-16T00:00:00.000Z",
    solutionMatches: [],
    contentMatches: [],
    coverage: { solutionGap, contentGap: false, touchReady: !solutionGap },
  });
  assert.deepEqual(
    selectOpportunityGaps([opportunity("covered", false), opportunity("gap", true)])
      .map((item) => item.id),
    ["gap"],
  );
});
