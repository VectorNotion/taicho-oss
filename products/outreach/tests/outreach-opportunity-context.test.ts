import assert from "node:assert/strict";
import test from "node:test";
import type { AccountOpportunityCoverageResult } from "../domain/account-opportunity";
import {
  evaluateOutreachOpportunityReadiness,
  getOutreachOpportunityContext,
  requireOutreachOpportunityReadiness,
  type OutreachOpportunityContext,
} from "../services/outreach-opportunity-context";

function coverage(input: {
  accountEligible?: boolean;
  solutionGap?: boolean;
  contentGap?: boolean;
  touchReady?: boolean;
} = {}): AccountOpportunityCoverageResult {
  return {
    calculationStatus: "ready",
    accountEligible: input.accountEligible ?? true,
    thresholds: { solution: 65, content: 65 },
    opportunities: [{
      id: "opportunity-1",
      accountId: "account-1",
      angle: "Reduce manual operational review work.",
      sourceDimensionKeys: ["manual_work"],
      evidence: ["https://example.test/evidence"],
      evidenceConfidence: 0.8,
      researchRunId: "research-1",
      generatedAt: "2026-08-16T00:00:00.000Z",
      solutionMatches: [],
      contentMatches: [],
      coverage: {
        solutionGap: input.solutionGap ?? false,
        contentGap: input.contentGap ?? false,
        touchReady: input.touchReady ?? true,
      },
    }],
  };
}

function context(value: AccountOpportunityCoverageResult): OutreachOpportunityContext {
  return {
    account: {
      id: "account-1",
      name: "Northstar",
      icpScore: 84,
      timingScore: 71,
      hardExcluded: false,
    },
    coverage: value,
  };
}

test("loads baseline account eligibility and current opportunity coverage for a prospect", async () => {
  let coverageInput: { accountId: string; accountEligible: boolean } | undefined;
  const result = await getOutreachOpportunityContext("prospect-1", {
    getAccount: async () => ({
      id: "account-1",
      name: "Northstar",
      prospectCount: 2,
      qualifiedCount: 1,
      icpScore: 20,
      timingScore: 10,
      isTarget: true,
      hardExcluded: false,
    }),
    getScore: async (_accountId, catalogItemId) => {
      assert.equal(catalogItemId, undefined, "outreach readiness uses the workspace account score");
      return {
        icpScore: 84,
        icpScoreConfident: 84,
        timingScore: 71,
        hardExcluded: false,
        timingBreakdown: [],
        computedAt: "2026-08-16T00:00:00.000Z",
      };
    },
    getCoverage: async (input) => {
      coverageInput = input;
      return coverage();
    },
  });

  assert.deepEqual(coverageInput, { accountId: "account-1", accountEligible: true });
  assert.equal(result?.account.icpScore, 84);
});

test("allows generation when at least one current account opportunity is touch-ready", () => {
  assert.deepEqual(evaluateOutreachOpportunityReadiness(context(coverage())), {
    ready: true,
    touchReadyOpportunityIds: ["opportunity-1"],
  });
});

test("blocks generation deterministically for missing account, eligibility, and coverage gaps", () => {
  const missing = evaluateOutreachOpportunityReadiness(null);
  assert.equal(missing.ready, false);
  if (!missing.ready) assert.equal(missing.code, "account_missing");

  const ineligible = evaluateOutreachOpportunityReadiness(context(coverage({
    accountEligible: false,
    touchReady: false,
  })));
  assert.equal(ineligible.ready, false);
  if (!ineligible.ready) assert.equal(ineligible.code, "account_ineligible");

  const gaps = evaluateOutreachOpportunityReadiness(context(coverage({
    solutionGap: true,
    contentGap: true,
    touchReady: false,
  })));
  assert.equal(gaps.ready, false);
  if (!gaps.ready) {
    assert.equal(gaps.code, "opportunity_gap");
    assert.match(gaps.message, /1 solution gap and 1 content gap/);
  }
  assert.throws(
    () => requireOutreachOpportunityReadiness(context(coverage({
      contentGap: true,
      touchReady: false,
    }))),
    /Outreach is blocked/,
  );
});
