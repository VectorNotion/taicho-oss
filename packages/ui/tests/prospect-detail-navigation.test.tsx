import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DetailNavigation,
  ProspectDetailNavigation,
} from "../../../products/outreach/ui/components/prospects/ProspectDetailNavigation";

afterEach(cleanup);

describe("prospect detail navigation", () => {
  it("links to both neighbouring prospects and shows the current position", () => {
    render(
      <ProspectDetailNavigation
        navigation={{
          previous: { id: "newer", name: "Grace Hopper", company: "Navy" },
          next: { id: "older", name: "Alan Turing", company: "Bletchley Park" },
          position: 2,
          total: 3,
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Previous prospect: Grace Hopper" })).toHaveAttribute(
      "href",
      "/outreach/prospects/newer",
    );
    expect(screen.getByRole("link", { name: "Next prospect: Alan Turing" })).toHaveAttribute(
      "href",
      "/outreach/prospects/older",
    );
    expect(screen.getByLabelText("Prospect 2 of 3")).toHaveTextContent("2 of 3");
  });

  it("disables a direction at the end of the pipeline", () => {
    render(
      <ProspectDetailNavigation
        navigation={{ previous: null, next: null, position: 1, total: 1 }}
      />,
    );

    expect(screen.getByRole("button", { name: "No previous prospect" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "No next prospect" })).toBeDisabled();
  });

  it("does not present a loading failure as list boundaries", () => {
    render(<ProspectDetailNavigation hasError navigation={null} />);

    expect(screen.getByText("Prospect navigation could not be loaded. Refresh to try again.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "No previous prospect" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "No next prospect" })).not.toBeInTheDocument();
  });

  it("supports the same navigation pattern for accounts", () => {
    render(
      <DetailNavigation
        entityLabel="Account"
        hrefBase="/outreach/accounts"
        navigation={{
          previous: { id: "alpha", name: "Alpha" },
          next: { id: "gamma", name: "Gamma" },
          position: 2,
          total: 3,
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Previous account: Alpha" })).toHaveAttribute(
      "href",
      "/outreach/accounts/alpha",
    );
    expect(screen.getByRole("link", { name: "Next account: Gamma" })).toHaveAttribute(
      "href",
      "/outreach/accounts/gamma",
    );
    expect(screen.getByLabelText("Account 2 of 3")).toHaveTextContent("2 of 3");
  });
});
