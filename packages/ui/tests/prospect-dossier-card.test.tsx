import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("shows the person, account, and timing decision together with independent actions", () => {
    const researchPerson = vi.fn();
    const researchAccount = vi.fn();
    render(
      <ProspectDossierCard
        dossier={dossier()}
        isLoading={false}
        isResearchingAccount={false}
        isResearchingPerson={false}
        isRequalifying={false}
        onResearchAccount={researchAccount}
        onResearchPerson={researchPerson}
        onRequalify={vi.fn()}
      />,
    );

    expect(screen.getByText("Is this person worth pursuing?")).toBeVisible();
    expect(screen.getByText("Is this company worth pursuing?")).toBeVisible();
    expect(screen.getByText("Is now a good time?")).toBeVisible();
    expect(screen.getByText("Person: Fresh")).toBeVisible();
    expect(screen.getByText("Account: Fresh")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Research person" }));
    fireEvent.click(screen.getByRole("button", { name: "Research account" }));
    expect(researchPerson).toHaveBeenCalledOnce();
    expect(researchAccount).toHaveBeenCalledOnce();
  });

  it("offers explicit account resolution and disables it when no company exists", () => {
    const available = dossier();
    available.account = null;
    available.accountResolution = { state: "available", companyName: "Analytical Engines" };
    const { rerender } = render(
      <ProspectDossierCard
        dossier={available}
        isLoading={false}
        isResearchingAccount={false}
        isResearchingPerson={false}
        isRequalifying={false}
        onResearchAccount={vi.fn()}
        onResearchPerson={vi.fn()}
        onRequalify={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Resolve & research account" })).toBeEnabled();

    available.accountResolution = { state: "unavailable", companyName: null };
    rerender(
      <ProspectDossierCard
        dossier={available}
        isLoading={false}
        isResearchingAccount={false}
        isResearchingPerson={false}
        isRequalifying={false}
        onResearchAccount={vi.fn()}
        onResearchPerson={vi.fn()}
        onRequalify={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Research account" })).toBeDisabled();
  });
});
