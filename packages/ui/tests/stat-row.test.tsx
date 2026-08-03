import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatRow, type Stat } from "../components/StatRow";

const STATS: Stat[] = [
  { label: "Published", value: "12", delta: "+4", direction: "up" },
  { label: "Failed", value: "2", delta: "−1", direction: "down" },
  { label: "Active runs", value: "3", delta: "steady", direction: "flat" },
];

describe("StatRow direction states", () => {
  it("inks the delta chip per direction — flat is muted, never a fake trend", () => {
    const { container } = render(<StatRow stats={STATS} />);
    const view = within(container);
    expect(view.getByText("+4").closest("span")).toHaveClass("text-chart-2");
    expect(view.getByText("−1").closest("span")).toHaveClass("text-destructive");
    expect(view.getByText("steady").closest("span")).toHaveClass("text-muted-foreground");
  });

  it("renders a tile per stat with label and value", () => {
    const { container } = render(<StatRow stats={STATS} />);
    const view = within(container);
    for (const stat of STATS) {
      expect(view.getByText(stat.label)).toBeInTheDocument();
      expect(view.getByText(stat.value)).toBeInTheDocument();
    }
  });
});
