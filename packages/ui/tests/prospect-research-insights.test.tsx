import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProspectResearchInsights } from "../../../products/outreach/ui/components/prospects/ProspectResearchInsights";

afterEach(cleanup);

describe("prospect research insights", () => {
  it("places person and company evidence in one research view", () => {
    const researchPerson = vi.fn();
    const researchAccount = vi.fn();
    render(
      <ProspectResearchInsights
        account={{
          id: "a1",
          name: "Analytical Engines",
          prospectCount: 1,
          qualifiedCount: 1,
          icpScore: 82,
          timingScore: 45,
          isTarget: true,
          hardExcluded: false,
          icpObservations: [
            {
              dimensionKey: "company_size",
              observedValue: "A growing mid-market company.",
              evidence: ["https://example.com/company"],
              effectiveMatch: 0.82,
            },
          ],
          timingSignals: [
            {
              dimensionKey: "hiring_activity",
              dimensionValue: 0.45,
              signalCount: 1,
              signals: [{ signal: "Hiring revenue operations", date: "2026-08-01", evidence: ["https://example.com/jobs"] }],
            },
          ],
        }}
        accountLoading={false}
        onResearchAccount={researchAccount}
        onResearchPerson={researchPerson}
        persona={{
          personaScore: 91,
          dimensions: [
            {
              dimensionKey: "decision_authority",
              observedValue: "Owns the buying decision.",
              evidence: ["https://example.com/person"],
              confidence: 1,
              effectiveMatch: 0.91,
            },
          ],
        }}
        personaLoading={false}
      />,
    );

    expect(screen.getByText("Research insights")).toBeVisible();
    expect(screen.getByText("Persona 91 · Strong fit")).toBeVisible();
    expect(screen.getByText("ICP 82 · Strong fit · target")).toBeVisible();
    expect(screen.getByText("Timing 45 · Warming")).toBeVisible();
    expect(screen.getByText("Owns the buying decision.")).toBeVisible();
    expect(screen.getByText("A growing mid-market company.")).toBeVisible();
    expect(screen.getByText("Hiring revenue operations")).toBeVisible();

    const personBox = screen.getByRole("region", { name: "Persona insights" });
    const accountBox = screen.getByRole("region", { name: "Analytical Engines" });
    fireEvent.click(within(personBox).getByRole("button", { name: "Re-research person" }));
    fireEvent.click(within(accountBox).getByRole("button", { name: "Re-research account" }));
    expect(researchPerson).toHaveBeenCalledOnce();
    expect(researchAccount).toHaveBeenCalledOnce();
  });

  it("renders each active research loader inside its corresponding box", () => {
    render(
      <ProspectResearchInsights
        account={null}
        accountLoading={false}
        accountResearchDimensions={[
          {
            dimensionKey: "company_size",
            name: "Company size",
            type: "fit",
            phase: "found",
            scope: "account",
          },
        ]}
        companyName="Analytical Engines"
        isResearchingAccount
        isResearchingPerson
        onResearchAccount={vi.fn()}
        onResearchPerson={vi.fn()}
        persona={null}
        personaLoading={false}
        personResearchDimensions={[
          {
            dimensionKey: "decision_authority",
            name: "Decision authority",
            type: "fit",
            phase: "searching",
            scope: "person",
          },
        ]}
      />,
    );

    const personBox = screen.getByRole("region", { name: "Persona insights" });
    const accountBox = screen.getByRole("region", { name: "Analytical Engines" });
    expect(within(personBox).getByText("Researching person")).toBeVisible();
    expect(within(personBox).getByText("Decision authority")).toBeVisible();
    expect(within(personBox).getByText("Searching sources")).toBeVisible();
    expect(within(accountBox).getByText("Researching account")).toBeVisible();
    expect(within(accountBox).getByText("Company size")).toBeVisible();
    expect(within(accountBox).getByText("Scoring evidence")).toBeVisible();
    expect(within(personBox).getByRole("button", { name: "Researching…" })).toBeDisabled();
    expect(within(accountBox).getByRole("button", { name: "Researching…" })).toBeDisabled();
  });
});
