import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelPicker } from "../components/ModelPicker";
import type { PublicModelDefinition } from "@content-automation/platform/models/catalog";

const models: PublicModelDefinition[] = [
  { key: "text-fast", name: "Fast text", family: "Text family", kind: "language", description: "Fast text model", capabilities: ["text-generation", "tool-use"], surfaces: ["chat"], speed: "fast", creditMultiplier: 0.5, status: "available" },
  { key: "text-balanced", name: "Balanced text", family: "Text family", kind: "language", description: "Balanced text model", capabilities: ["text-generation", "tool-use"], surfaces: ["chat"], speed: "balanced", creditMultiplier: 1, status: "available", recommended: true },
  { key: "image-brand", name: "Brand image", family: "Image family", kind: "image", description: "Editable image model", capabilities: ["image-generation", "image-edit"], surfaces: ["creative"], speed: "balanced", creditMultiplier: 4, status: "available" },
];

afterEach(() => cleanup());

describe("ModelPicker", () => {
  it("shows compatible LiteLLM language choices in chat", async () => {
    const user = userEvent.setup();
    render(
      <ModelPicker
        models={models}
        onValueChange={vi.fn()}
        requiredCapabilities={["text-generation", "tool-use"]}
        surface="chat"
        value="auto"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Model: Auto" }));

    expect(screen.getByText("Fast text")).toBeInTheDocument();
    expect(screen.getByText("Balanced text")).toBeInTheDocument();
    expect(screen.queryByText("Brand image")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
  });

  it("shows only an image-edit-capable FAL model for image editing", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <ModelPicker
        models={models}
        includeAuto={false}
        onValueChange={onValueChange}
        requiredCapabilities={["image-edit"]}
        surface="creative"
        value="image-brand"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Model: Brand image" }),
    );

    expect(screen.getAllByText("Brand image")).toHaveLength(2);
    expect(screen.queryByText("Fast text")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
  });

  it("does not mislabel a removed stored model as Auto", () => {
    render(
      <ModelPicker
        models={models}
        includeAuto={false}
        onValueChange={vi.fn()}
        requiredCapabilities={["text-generation"]}
        surface="chat"
        value="removed-model"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Model: Model unavailable" }),
    ).toBeInTheDocument();
  });
});
