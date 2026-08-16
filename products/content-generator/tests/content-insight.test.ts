import assert from "node:assert/strict";
import test from "node:test";
import {
  combineContentInsightProviders,
  contentIdeaInputFromInsight,
  type ContentInsight,
  type ContentInsightProviderResult,
  type ContentInsightState,
} from "../domain/content-insight";

function insight(input: {
  id: string;
  state: ContentInsightState;
  accountId?: string;
  fitScore?: number;
  timingScore?: number;
  contentScore?: number;
}): ContentInsight {
  return {
    id: input.id,
    provider: "test",
    providerLabel: "Test",
    sourceId: input.id,
    title: `Insight ${input.id}`,
    state: input.state,
    reason: "Calculated reason",
    currentContentScore: input.contentScore ?? 0,
    contentThreshold: 65,
    context: input.accountId ? {
      id: input.accountId,
      label: `Account ${input.accountId}`,
      href: `/accounts/${input.accountId}`,
      fitScore: input.fitScore,
      timingScore: input.timingScore,
    } : undefined,
    evidence: [],
    generatedAt: "2026-08-16T00:00:00.000Z",
  };
}

function provider(
  insights: ContentInsight[],
  overrides: Partial<ContentInsightProviderResult> = {},
): ContentInsightProviderResult {
  return {
    provider: "test",
    providerLabel: "Test",
    calculationStatus: "ready",
    insights,
    ...overrides,
  };
}

test("combines provider projections into deterministic dashboard counts and order", () => {
  const feed = combineContentInsightProviders([provider([
    insight({ id: "covered", state: "covered", accountId: "account-3" }),
    insight({ id: "solution", state: "solution_gap", accountId: "account-2" }),
    insight({
      id: "content-low-fit",
      state: "content_gap",
      accountId: "account-1",
      fitScore: 75,
      timingScore: 90,
      contentScore: 10,
    }),
    insight({
      id: "content-high-fit",
      state: "content_gap",
      accountId: "account-1",
      fitScore: 92,
      timingScore: 40,
      contentScore: 50,
    }),
    insight({ id: "ineligible", state: "account_ineligible", accountId: "account-4" }),
  ])], "2026-08-16T12:00:00.000Z");

  assert.equal(feed.calculationStatus, "ready");
  assert.deepEqual(feed.summary, {
    total: 5,
    contentGaps: 2,
    solutionGaps: 1,
    ineligible: 1,
    covered: 1,
    blockedContexts: 1,
  });
  assert.deepEqual(feed.insights.map((item) => item.id), [
    "content-high-fit",
    "content-low-fit",
    "solution",
    "ineligible",
    "covered",
  ]);
});

test("reports partial and unavailable providers without inventing gap records", () => {
  const unavailable = provider([], {
    provider: "offline",
    providerLabel: "Offline",
    calculationStatus: "unavailable",
    unavailableReason: "Embeddings are unavailable.",
  });
  const partial = combineContentInsightProviders([
    provider([insight({ id: "gap", state: "content_gap", accountId: "account-1" })]),
    unavailable,
  ]);
  assert.equal(partial.calculationStatus, "partial");
  assert.deepEqual(partial.unavailableReasons, ["Embeddings are unavailable."]);

  const emptyUnavailable = combineContentInsightProviders([unavailable]);
  assert.equal(emptyUnavailable.calculationStatus, "unavailable");

  const noProviders = combineContentInsightProviders([]);
  assert.equal(noProviders.calculationStatus, "ready");
  assert.equal(noProviders.summary.total, 0);
});

test("promotes only actionable content gaps into deterministic, sourced ideas", () => {
  const gap = insight({
    id: "content-gap",
    state: "content_gap",
    accountId: "account-1",
    contentScore: 31,
  });
  gap.supportingMatch = { id: "catalog-1", label: "Workflow automation", score: 88 };
  gap.evidence = ["https://example.test/evidence"];

  const input = contentIdeaInputFromInsight(gap);
  assert.equal(input.title, gap.title);
  assert.match(input.description, /Account account-1/);
  assert.match(input.description, /Workflow automation \(88% match\)/);
  assert.match(input.rationale, /31% against the required 65%/);
  assert.deepEqual(input.sourceInsight, {
    provider: "test",
    sourceId: "content-gap",
    title: "Insight content-gap",
    contextId: "account-1",
    contextLabel: "Account account-1",
    evidence: ["https://example.test/evidence"],
    generatedAt: "2026-08-16T00:00:00.000Z",
  });

  assert.throws(
    () => contentIdeaInputFromInsight(insight({ id: "covered", state: "covered" })),
    /Only an actionable content gap/,
  );
});
