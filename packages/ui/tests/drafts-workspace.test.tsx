import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMutate } = vi.hoisted(() => ({ apiMutate: vi.fn() }));
vi.mock("@content-automation/platform/network/api-client", () => ({ apiMutate }));

import { DraftsWorkspace } from "../../../products/outreach/ui/components/drafts/DraftsWorkspace";
import type { OutreachMessageWithProspect } from "../../../products/outreach/domain/types";

afterEach(cleanup);

const fixture: OutreachMessageWithProspect = {
  prospect: {
    id: "prospect-1",
    name: "Ada Lovelace",
    company: "Analytical Engines",
    title: "VP Operations",
  },
  message: {
    id: "message-1",
    prospectId: "prospect-1",
    medium: "email",
    subject: "Original subject",
    content: "Original body",
    status: "draft",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  },
};

describe("DraftsWorkspace editing", () => {
  beforeEach(() => {
    apiMutate.mockReset();
  });

  it("preserves edits while saving and coalesces duplicate save input", async () => {
    let finish: ((value: unknown) => void) | undefined;
    apiMutate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<DraftsWorkspace initialMessages={[fixture]} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit message for Ada Lovelace" }));
    const subject = screen.getByLabelText("Subject");
    const content = screen.getByLabelText("Message");
    fireEvent.change(subject, { target: { value: "Updated subject" } });
    fireEvent.change(content, { target: { value: "Updated body with a concrete next step." } });

    const save = screen.getByRole("button", { name: "Save changes" });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(apiMutate).toHaveBeenCalledTimes(1);
    expect(apiMutate).toHaveBeenCalledWith(
      "PATCH",
      "/outreach/messages/message-1",
      { subject: "Updated subject", content: "Updated body with a concrete next step." },
    );
    expect(screen.getByLabelText("Subject")).toHaveValue("Updated subject");
    expect(screen.getByLabelText("Message")).toHaveValue("Updated body with a concrete next step.");

    finish?.({ data: { message: {
      ...fixture.message,
      subject: "Updated subject",
      content: "Updated body with a concrete next step.",
      updatedAt: "2026-08-27T00:01:00.000Z",
    } } });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Updated subject")).toBeInTheDocument();
    expect(screen.getByText("Updated body with a concrete next step.")).toBeInTheDocument();
  });
});
