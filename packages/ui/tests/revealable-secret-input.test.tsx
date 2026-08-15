import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { RevealableSecretInput } from "../components/ui/revealable-secret-input"

describe("RevealableSecretInput", () => {
  it("reveals and hides the entered value without changing it", async () => {
    const user = userEvent.setup()
    render(<RevealableSecretInput aria-label="Login password" defaultValue="correct horse" />)

    const input = screen.getByLabelText("Login password")
    const reveal = screen.getByRole("button", { name: "Show password" })
    expect(input).toHaveAttribute("type", "password")

    await user.click(reveal)
    expect(input).toHaveAttribute("type", "text")
    expect(input).toHaveValue("correct horse")
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true")

    await user.keyboard("{Enter}")
    expect(input).toHaveAttribute("type", "password")
    expect(input).toHaveValue("correct horse")
  })

  it("returns to masked mode whenever its form is submitted", async () => {
    const user = userEvent.setup()
    render(
      <form onSubmit={(event) => event.preventDefault()}>
        <RevealableSecretInput aria-label="Signing secret" secretLabel="signing secret" />
        <button type="submit">Save</button>
      </form>,
    )

    const input = screen.getByLabelText("Signing secret")
    await user.click(screen.getByRole("button", { name: "Show signing secret" }))
    expect(input).toHaveAttribute("type", "text")

    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!)
    expect(input).toHaveAttribute("type", "password")
  })

  it("returns to masked mode when the caller resets the field", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <RevealableSecretInput aria-label="API key" resetKey={0} secretLabel="API key" />,
    )
    const input = screen.getByLabelText("API key")

    await user.click(screen.getByRole("button", { name: "Show API key" }))
    expect(input).toHaveAttribute("type", "text")

    rerender(<RevealableSecretInput aria-label="API key" resetKey={1} secretLabel="API key" />)
    expect(input).toHaveAttribute("type", "password")
  })
})
