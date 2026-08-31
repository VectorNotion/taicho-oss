import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProspectDossierCard } from "../../../products/outreach/ui/components/prospects/ProspectDossierCard";
import type { ProspectDossier } from "../../../products/outreach/domain/prospect-dossier";

afterEach(cleanup);

function dossier(): ProspectDossier {
  const research = {
    status: "fresh" as const,
    configuredDimensionCount: 2,
    researchedDimensionCount: 2,
    missingDimensionKeys: [],
    staleDimensionKeys: [],
    latestResearchedAt: "2026-08-15T09:00:00.000Z",
  };
  return {
    snapshotAt: "2026-08-15T10:00:00.000Z",
    prospect: { id: "p1", name: "Ada", companyName: "Analytical Engines" },
    person: {
      personaScore: 88,
      hardExcluded: false,
      reviewReason: null,
      computedAt: "2026-08-15T09:00:00.000Z",
      research,
      findings: [],
    },
    account: {
      id: "a1",
      name: "Analytical Engines",
      prospectCount: 1,
      qualifiedCount: 1,
      isTarget: true,
      icpScore: 84,
      timingScore: 62,
      hardExcluded: false,
      reviewReason: null,
      computedAt: "2026-08-15T09:00:00.000Z",
      research,
      fitFindings: [],
      timingFindings: [],
    },
    accountResolution: { state: "resolved", companyName: "Analytical Engines" },
    qualification: {
      status: "QUALIFIED",
      thresholds: { icpMinimum: 70, personaMinimum: 65, lowConfidenceCutoff: 0.5 },
      explanation: "Both fit gates passed; timing ranks urgency without changing the qualification gate.",
      recommendedAction: "Continue outreach.",
      computedAt: "2026-08-15T09:01:00.000Z",
      isStale: false,
      icpMatches: [],
      personaMatches: [],
      timingBreakdown: [],
      legacy: null,
    },
  };
}

describe("prospect dossier card", () => {
  it("shows the person, account, and timing decision without duplicating research actions", () => {
    render(
      <ProspectDossierCard
        dossier={dossier()}
        isLoading={false}
        isRequalifying={false}
        onRequalify={vi.fn()}
        onRetryQualification={vi.fn()}
        qualificationError={null}
        qualificationOperation={null}
        qualificationProgress={null}
        qualificationRetrying={false}
      />,
    );

    expect(screen.getByText("Is this person worth pursuing?")).toBeVisible();
    expect(screen.getByText("Is this company worth pursuing?")).toBeVisible();
    expect(screen.getByText("Is now a good time?")).toBeVisible();
    expect(screen.getByText("Person: Fresh")).toBeVisible();
    expect(screen.getByText("Account: Fresh")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Research person" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Research account" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-score" })).toBeVisible();
  });

  it("keeps a failed durable scoring operation visible and retryable", () => {
    const retry = vi.fn();
    render(
      <ProspectDossierCard
        dossier={dossier()}
        isLoading={false}
        isRequalifying={false}
        onRequalify={vi.fn()}
        onRetryQualification={retry}
        qualificationError="Qualification needs an active company-fit targeting dimension."
        qualificationOperation={{
          id: "11111111-1111-4111-8111-111111111111",
          status: "failed",
          progress: 20,
          attempt: 1,
          maxAttempts: 3,
        }}
        qualificationProgress={{ phase: "loading", label: "Loading research scores and targeting policy" }}
        qualificationRetrying={false}
      />,
    );

    expect(screen.getByText("Scoring needs attention")).toBeVisible();
    expect(screen.getByText(/Qualification needs an active company-fit/)).toBeVisible();
    screen.getByRole("button", { name: "Retry same operation" }).click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
