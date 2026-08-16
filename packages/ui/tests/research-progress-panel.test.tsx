import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResearchProgressPanel } from "../../../products/outreach/ui/components/research/ResearchProgressPanel";

afterEach(cleanup);

describe("research progress panel", () => {
  it("organizes overlapping criterion work and a queued account run", () => {
    render(
      <ResearchProgressPanel
        backgroundItems={[{ id: "p2", name: "Grace Hopper" }]}
        groups={[
          {
            id: "person",
            entityName: "Ada Lovelace",
            kind: "person",
            label: "Person research",
            dimensions: [
              {
                dimensionKey: "decision_authority",
                name: "Decision authority",
                type: "fit",
                phase: "matched",
                matchScore: 0.9,
                scope: "person",
              },
              {
                dimensionKey: "problem_ownership",
                name: "Problem ownership",
                type: "fit",
                phase: "found",
                observedValue: "Owns the operating problem.",
                scope: "person",
              },
            ],
          },
          {
            id: "account",
            entityName: "Analytical Engines",
            kind: "account",
            label: "Company research",
            dimensions: [],
            pendingLabel: "Queued after person research.",
          },
        ]}
        isComplete={false}
        isStreaming
      />,
    );

    expect(screen.getByTestId("research-progress-panel")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("progressbar", { name: "Overall research progress" })).toHaveAttribute("aria-valuenow");
    expect(screen.getByText("1/2 scored")).toBeVisible();
    expect(screen.getByText("Evidence ready for scoring")).toBeVisible();
    // The queued group renders collapsed with its state badge; the
    // pendingLabel copy only appears once expanded.
    expect(screen.getByText("Queued")).toBeVisible();
    expect(screen.getByText("90% match")).toBeVisible();
    expect(screen.getByText("Person research started in the background")).toBeVisible();
  });

  it("disappears as soon as a successful research run completes", () => {
    const { container } = render(
      <ResearchProgressPanel
        backgroundItems={[{ id: "p1", name: "Grace Hopper" }]}
        groups={[
          {
            id: "account",
            entityName: "Compiler Co",
            kind: "account",
            label: "Company research",
            dimensions: [
              {
                dimensionKey: "hiring_activity",
                name: "Hiring activity",
                type: "timing",
                phase: "matched",
                matchScore: 0.78,
                scope: "account",
              },
            ],
          },
        ]}
        isComplete
        isStreaming={false}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
