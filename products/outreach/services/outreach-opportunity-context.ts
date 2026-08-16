import { getAccountForProspect } from "../data/account-repository";
import { getAccountScore } from "../data/qualification-repository";
import type { AccountOpportunityCoverageResult } from "../domain/account-opportunity";
import { DEFAULT_THRESHOLDS } from "../domain/qualification";
import { getAccountOpportunityCoverage } from "./account-opportunity-coverage";

export interface OutreachOpportunityContext {
  account: {
    id: string;
    name: string;
    icpScore: number | null;
    timingScore: number | null;
    hardExcluded: boolean;
  };
  coverage: AccountOpportunityCoverageResult;
}

export type OutreachOpportunityReadiness =
  | {
      ready: true;
      touchReadyOpportunityIds: string[];
    }
  | {
      ready: false;
      code:
        | "account_missing"
        | "coverage_unavailable"
        | "opportunities_missing"
        | "account_ineligible"
        | "opportunity_gap";
      message: string;
    };

export interface OutreachOpportunityContextDeps {
  getAccount: typeof getAccountForProspect;
  getScore: typeof getAccountScore;
  getCoverage: typeof getAccountOpportunityCoverage;
}

const defaultDeps: OutreachOpportunityContextDeps = {
  getAccount: getAccountForProspect,
  getScore: getAccountScore,
  getCoverage: getAccountOpportunityCoverage,
};

/** Load account-owned opportunity coverage for a prospect-facing action. */
export async function getOutreachOpportunityContext(
  prospectId: string,
  deps: Partial<OutreachOpportunityContextDeps> = {},
): Promise<OutreachOpportunityContext | null> {
  const d = { ...defaultDeps, ...deps };
  const account = await d.getAccount(prospectId);
  if (!account) return null;
  const score = await d.getScore(account.id);
  const accountEligible = score != null
    && !score.hardExcluded
    && score.icpScore >= DEFAULT_THRESHOLDS.icpMinimum;
  const coverage = await d.getCoverage({
    accountId: account.id,
    accountEligible,
  });
  return {
    account: {
      id: account.id,
      name: account.name,
      icpScore: score?.icpScore ?? null,
      timingScore: score?.timingScore ?? null,
      hardExcluded: score?.hardExcluded ?? false,
    },
    coverage,
  };
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * Keep outreach gating deterministic. The model receives ready opportunities;
 * it never decides whether a touch is commercially allowed.
 */
export function evaluateOutreachOpportunityReadiness(
  context: OutreachOpportunityContext | null,
): OutreachOpportunityReadiness {
  if (!context) {
    return {
      ready: false,
      code: "account_missing",
      message: "Outreach is blocked until this prospect is linked to a researched account.",
    };
  }
  if (context.coverage.calculationStatus === "unavailable") {
    return {
      ready: false,
      code: "coverage_unavailable",
      message: context.coverage.unavailableReason
        ? `Outreach is blocked: ${context.coverage.unavailableReason}`
        : "Outreach is blocked because opportunity coverage is unavailable.",
    };
  }
  if (context.coverage.opportunities.length === 0) {
    return {
      ready: false,
      code: "opportunities_missing",
      message: "Outreach is blocked until account research produces an opportunity angle.",
    };
  }
  if (!context.coverage.accountEligible) {
    return {
      ready: false,
      code: "account_ineligible",
      message: "Outreach is blocked because this account does not currently pass the ICP gate.",
    };
  }
  const touchReadyOpportunityIds = context.coverage.opportunities
    .filter((opportunity) => opportunity.coverage?.touchReady)
    .map((opportunity) => opportunity.id);
  if (touchReadyOpportunityIds.length > 0) {
    return { ready: true, touchReadyOpportunityIds };
  }
  const solutionGaps = context.coverage.opportunities
    .filter((opportunity) => opportunity.coverage?.solutionGap).length;
  const contentGaps = context.coverage.opportunities
    .filter((opportunity) => opportunity.coverage?.contentGap).length;
  const blockers = [
    solutionGaps > 0 ? plural(solutionGaps, "solution gap") : null,
    contentGaps > 0 ? plural(contentGaps, "content gap") : null,
  ].filter((item): item is string => Boolean(item));
  return {
    ready: false,
    code: "opportunity_gap",
    message: `Outreach is blocked while this account has ${blockers.join(" and ") || "unresolved opportunity coverage"}.`,
  };
}

export class OutreachOpportunityBlockedError extends Error {
  readonly code: Exclude<OutreachOpportunityReadiness, { ready: true }>["code"];

  constructor(readiness: Exclude<OutreachOpportunityReadiness, { ready: true }>) {
    super(readiness.message);
    this.name = "OutreachOpportunityBlockedError";
    this.code = readiness.code;
  }
}

export function requireOutreachOpportunityReadiness(
  context: OutreachOpportunityContext | null,
): Extract<OutreachOpportunityReadiness, { ready: true }> {
  const readiness = evaluateOutreachOpportunityReadiness(context);
  if (!readiness.ready) throw new OutreachOpportunityBlockedError(readiness);
  return readiness;
}
