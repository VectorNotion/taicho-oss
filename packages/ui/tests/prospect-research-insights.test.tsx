import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProspectResearchInsights } from "../../../products/outreach/ui/components/prospects/ProspectResearchInsights";

afterEach(cleanup);

describe("prospect research insights", () => {
  it("places person and company evidence in one research view", () => {
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
        isResearching={false}
        onResearch={vi.fn()}
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
  });
});
