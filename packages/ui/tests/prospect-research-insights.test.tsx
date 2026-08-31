import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountResearchInsights } from "../../../products/outreach/ui/components/prospects/AccountResearchInsights";
import { ProspectResearchInsights } from "../../../products/outreach/ui/components/prospects/ProspectResearchInsights";

afterEach(cleanup);

describe("prospect research insights", () => {
  it("renders the shared permanent account box as a standalone surface", () => {
    const researchAccount = vi.fn();
    render(
      <AccountResearchInsights
        account={{
          name: "Analytical Engines",
          icpScore: 82,
          timingScore: 45,
          hardExcluded: false,
          icpObservations: [{
            dimensionKey: "company_size",
            observedValue: "A growing mid-market company.",
            evidence: ["https://example.com/company"],
            effectiveMatch: 0.82,
          }],
          timingSignals: [],
        }}
        accountLoading={false}
        onResearch={researchAccount}
      />,
    );

    const accountBox = screen.getByRole("region", { name: "Analytical Engines" });
    expect(accountBox).toHaveAttribute("data-research-state", "complete");
    expect(within(accountBox).getByText("A growing mid-market company.")).toBeVisible();
    fireEvent.click(within(accountBox).getByRole("button", { name: "Re-research account" }));
    expect(researchAccount).toHaveBeenCalledOnce();
  });

  it("keeps prospect and account results and controls independent", () => {
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
          icpObservations: [{
            dimensionKey: "company_size",
            observedValue: "A growing mid-market company.",
            evidence: ["https://example.com/company"],
            effectiveMatch: 0.82,
          }],
          timingSignals: [{
            dimensionKey: "hiring_activity",
            dimensionValue: 0.45,
            signalCount: 1,
            signals: [{ signal: "Hiring revenue operations", date: "2026-08-01", evidence: ["https://example.com/jobs"] }],
          }],
        }}
        accountLoading={false}
        onResearchAccount={researchAccount}
        onResearchProspect={researchPerson}
        persona={{
          personaScore: 91,
          dimensions: [{
            dimensionKey: "decision_authority",
            observedValue: "Owns the buying decision.",
            evidence: ["https://example.com/person"],
            confidence: 1,
            effectiveMatch: 0.91,
          }],
        }}
        personaLoading={false}
      />,
    );

    const prospectBox = screen.getByRole("region", { name: "Persona insights" });
    const accountBox = screen.getByRole("region", { name: "Analytical Engines" });
    expect(within(prospectBox).getByText("Owns the buying decision.")).toBeVisible();
    expect(within(accountBox).getByText("A growing mid-market company.")).toBeVisible();

    fireEvent.click(within(prospectBox).getByRole("button", { name: "Re-research prospect" }));
    expect(researchPerson).toHaveBeenCalledOnce();
    expect(researchAccount).not.toHaveBeenCalled();

    fireEvent.click(within(accountBox).getByRole("button", { name: "Re-research account" }));
    expect(researchAccount).toHaveBeenCalledOnce();
  });

  it("renders both running executions from their own telemetry", () => {
    const startedAt = new Date(Date.now() - 12_000).toISOString();
    render(
      <ProspectResearchInsights
        account={null}
        accountExecution={{
          completedAt: null,
          dimensions: [{ dimensionKey: "company_size", name: "Company size", type: "fit", phase: "found", scope: "account" }],
          error: null,
          isRetrying: false,
          isRunning: true,
          progress: 65,
          startedAt,
          telemetry: {
            startedAt,
            queriesStarted: 1,
            queriesCompleted: 1,
            pagesFound: 5,
            pagesRead: 4,
            pagesFailed: 1,
            activeQueries: [],
            activities: [{
              id: "account-query",
              type: "query_completed",
              scope: "account",
              occurredAt: new Date().toISOString(),
              dimensionKey: "company_size",
              dimensionName: "Company size",
              query: "Analytical Engines company size",
              pagesFound: 5,
              pagesRead: 4,
              pagesFailed: 1,
              durationMs: 2_450,
              pages: [{
                title: "Analytical Engines — About",
                url: "https://example.com/about",
                contentPreview: "## Research evidence\n\nAnalytical Engines has **expanded** its commercial team.\n\n- Three markets\n- [Unsafe](javascript:alert(1))\n\n<script>alert('bad')</script>",
                status: "extracted",
              }],
            }],
          },
        }}
        accountLoading={false}
        companyName="Analytical Engines"
        onResearchAccount={vi.fn()}
        onResearchProspect={vi.fn()}
        persona={null}
        personaLoading={false}
        prospectExecution={{
          completedAt: null,
          dimensions: [{ dimensionKey: "decision_authority", name: "Decision authority", type: "fit", phase: "searching", scope: "person" }],
          error: null,
          isRetrying: false,
          isRunning: true,
          progress: 25,
          startedAt,
          telemetry: {
            startedAt,
            queriesStarted: 1,
            queriesCompleted: 0,
            pagesFound: 0,
            pagesRead: 0,
            pagesFailed: 0,
            activeQueries: ["Ada Lovelace decision authority Analytical Engines"],
            activities: [{
              id: "prospect-query",
              type: "query_started",
              scope: "person",
              occurredAt: new Date().toISOString(),
              dimensionKey: "decision_authority",
              dimensionName: "Decision authority",
              query: "Ada Lovelace decision authority Analytical Engines",
            }],
          },
        }}
      />,
    );

    const prospectBox = screen.getByRole("region", { name: "Persona insights" });
    const accountBox = screen.getByRole("region", { name: "Analytical Engines" });
    expect(prospectBox).toHaveAttribute("data-research-state", "researching");
    expect(accountBox).toHaveAttribute("data-research-state", "researching");
    expect(within(prospectBox).getByText("Ada Lovelace decision authority Analytical Engines")).toBeVisible();
    expect(within(accountBox).getByText("Analytical Engines company size")).toBeVisible();
    expect(within(accountBox).getByText("Research evidence")).toBeVisible();
    expect(within(accountBox).getByText("expanded").tagName).toBe("STRONG");
    expect(within(accountBox).getByText("Unsafe").closest("a")).toBeNull();
    expect(within(accountBox).queryByText(/alert\('bad'\)/)).not.toBeInTheDocument();
    expect(within(prospectBox).getByRole("button", { name: "Researching…" })).toBeDisabled();
    expect(within(accountBox).getByRole("button", { name: "Researching…" })).toBeDisabled();
  });

  it("collapses a completed prospect execution while account research keeps running", () => {
    render(
      <ProspectResearchInsights
        account={{
          id: "a1",
          name: "Analytical Engines",
          prospectCount: 1,
          qualifiedCount: 0,
          icpScore: 20,
          timingScore: 0,
          isTarget: false,
          hardExcluded: false,
          icpObservations: [{ dimensionKey: "company_size", observedValue: "Stale account result.", evidence: [], effectiveMatch: 0.2 }],
          timingSignals: [],
        }}
        accountExecution={{
          completedAt: null,
          dimensions: [{ dimensionKey: "company_size", name: "Company size", type: "fit", phase: "searching", scope: "account" }],
          error: null,
          isRetrying: false,
          isRunning: true,
          progress: 25,
          startedAt: "2026-08-30T10:00:02.000Z",
          telemetry: {
            startedAt: "2026-08-30T10:00:02.000Z",
            queriesStarted: 1,
            queriesCompleted: 0,
            pagesFound: 0,
            pagesRead: 0,
            pagesFailed: 0,
            activeQueries: ["Analytical Engines current company size"],
            activities: [{
              id: "account-running",
              type: "query_started",
              scope: "account",
              occurredAt: "2026-08-30T10:00:03.000Z",
              query: "Analytical Engines current company size",
            }],
          },
        }}
        accountLoading={false}
        onResearchAccount={vi.fn()}
        onResearchProspect={vi.fn()}
        persona={{
          personaScore: 91,
          dimensions: [{
            dimensionKey: "decision_authority",
            observedValue: "Owns the current buying decision.",
            evidence: ["https://example.com/person"],
            confidence: 1,
            effectiveMatch: 0.91,
          }],
        }}
        personaLoading={false}
        prospectExecution={{
          completedAt: "2026-08-30T10:00:09.000Z",
          dimensions: [{ dimensionKey: "decision_authority", name: "Decision authority", type: "fit", phase: "matched", scope: "person" }],
          error: null,
          isRetrying: false,
          isRunning: false,
          progress: 100,
          startedAt: "2026-08-30T10:00:00.000Z",
          telemetry: {
            startedAt: "2026-08-30T10:00:00.000Z",
            queriesStarted: 1,
            queriesCompleted: 1,
            pagesFound: 3,
            pagesRead: 3,
            pagesFailed: 0,
            activeQueries: [],
            activities: [
              {
                id: "person-query",
                type: "query_completed",
                scope: "person",
                occurredAt: "2026-08-30T10:00:07.000Z",
                query: "Ada Lovelace decision authority",
                pagesFound: 3,
                pagesRead: 3,
                pagesFailed: 0,
                pages: [{ title: "Person page", url: "https://example.com/person", contentPreview: "Grounded person evidence.", status: "extracted" }],
              },
              {
                id: "person-warning",
                type: "graph_enrichment_warning",
                scope: "person",
                occurredAt: "2026-08-30T10:00:08.000Z",
                error: "One optional Brain relationship was not recorded.",
              },
              {
                id: "person-complete",
                type: "scope_completed",
                scope: "person",
                occurredAt: "2026-08-30T10:00:09.000Z",
                criteriaTotal: 1,
                criteriaCompleted: 1,
              },
            ],
          },
        }}
      />,
    );

    const prospectBox = screen.getByRole("region", { name: "Persona insights" });
    const accountBox = screen.getByRole("region", { name: "Analytical Engines" });
    expect(prospectBox).toHaveAttribute("data-research-state", "complete");
    expect(accountBox).toHaveAttribute("data-research-state", "researching");
    expect(within(prospectBox).getByText("Prospect research complete")).toBeVisible();
    expect(within(prospectBox).getByText("9s · 3 pages read · 1/1 criteria scored · 1 warning")).toBeVisible();
    expect(within(prospectBox).getByText("Owns the current buying decision.")).toBeVisible();
    expect(within(prospectBox).queryByText("Latest query receipts")).not.toBeInTheDocument();
    expect(within(prospectBox).queryByText("Research was preserved with processing warnings")).not.toBeInTheDocument();
    expect(within(accountBox).getByText("Analytical Engines current company size")).toBeVisible();
    expect(within(accountBox).queryByText("Stale account result.")).not.toBeInTheDocument();

    fireEvent.click(within(prospectBox).getByRole("button", { name: "View logs" }));
    expect(within(prospectBox).getByText("Latest query receipts")).toBeVisible();
    expect(within(prospectBox).getByText("Person page")).toBeVisible();
    expect(within(prospectBox).getByText("Research was preserved with processing warnings")).toBeVisible();
    fireEvent.click(within(prospectBox).getByRole("button", { name: "Hide logs" }));
    expect(within(prospectBox).queryByText("Latest query receipts")).not.toBeInTheDocument();
  });

  it("keeps final criteria hidden until that execution reaches scope completion", () => {
    render(
      <ProspectResearchInsights
        account={null}
        accountLoading={false}
        onResearchAccount={vi.fn()}
        onResearchProspect={vi.fn()}
        persona={{
          personaScore: 50,
          dimensions: [{ dimensionKey: "decision_authority", observedValue: "Old prospect result.", evidence: [], confidence: 0.5 }],
        }}
        personaLoading={false}
        prospectExecution={{
          completedAt: null,
          dimensions: [{ dimensionKey: "decision_authority", name: "Decision authority", type: "fit", phase: "found", scope: "person" }],
          error: null,
          isRetrying: false,
          isRunning: true,
          progress: 55,
          startedAt: "2026-08-30T10:00:00.000Z",
          telemetry: {
            startedAt: "2026-08-30T10:00:00.000Z",
            queriesStarted: 1,
            queriesCompleted: 1,
            pagesFound: 2,
            pagesRead: 2,
            pagesFailed: 0,
            activeQueries: [],
            activities: [{
              id: "synthesis-1",
              type: "synthesis_completed",
              scope: "person",
              occurredAt: "2026-08-30T10:00:08.000Z",
              criteriaTotal: 1,
              criteriaCompleted: 1,
            }],
          },
        }}
      />,
    );

    const prospectBox = screen.getByRole("region", { name: "Persona insights" });
    expect(prospectBox).toHaveAttribute("data-research-state", "researching");
    expect(within(prospectBox).getByText("Preparing prospect scoring")).toBeVisible();
    expect(within(prospectBox).queryByText("Old prospect result.")).not.toBeInTheDocument();
    expect(within(prospectBox).queryByText("Prospect research complete")).not.toBeInTheDocument();
  });
});
