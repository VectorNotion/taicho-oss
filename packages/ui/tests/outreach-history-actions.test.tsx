import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutreachHistory } from "../../../products/outreach/ui/components/prospects/OutreachHistory";

afterEach(cleanup);

function renderHistory(overrides: Partial<Parameters<typeof OutreachHistory>[0]> = {}) {
  const onGenerate = vi.fn();
  const onOpenCommentDialog = vi.fn();
  render(
    <OutreachHistory
      messages={[]}
      isLoading={false}
      isGenerating={false}
      prospectName="Ada Lovelace"
      onGenerate={onGenerate}
      onOpenCommentDialog={onOpenCommentDialog}
      onToggleStatus={vi.fn()}
      onDelete={vi.fn()}
      {...overrides}
    />,
  );
  return { onGenerate, onOpenCommentDialog };
}

describe("outreach draft actions", () => {
  it("renders one icon per medium and no dropdown", () => {
    renderHistory();
    for (const label of [
      "Draft Personalized InMail",
      "Draft Traditional InMail",
      "Draft Connection note",
      "Draft Email",
      "Draft Content comment",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
    expect(screen.queryByRole("button", { name: "Draft outreach" })).toBeNull();
  });

  it("starts generation directly on click, including the connection note", () => {
    const { onGenerate, onOpenCommentDialog } = renderHistory();
    fireEvent.click(screen.getByRole("button", { name: "Draft Connection note" }));
    expect(onGenerate).toHaveBeenCalledWith("connection_note");
    fireEvent.click(screen.getByRole("button", { name: "Draft Personalized InMail" }));
    expect(onGenerate).toHaveBeenCalledWith("inmail");
    fireEvent.click(screen.getByRole("button", { name: "Draft Content comment" }));
    expect(onOpenCommentDialog).toHaveBeenCalled();
  });

  it("disables all draft icons while generating", () => {
    renderHistory({ isGenerating: true });
    for (const label of ["Draft Connection note", "Draft Email"]) {
      expect((screen.getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
