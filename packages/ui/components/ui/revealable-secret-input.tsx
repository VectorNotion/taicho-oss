"use client"

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"

import { cn } from "../../lib/utils"
import { Input } from "./input"

function useSecretVisibility(resetKey?: string | number) {
  const [isRevealed, setIsRevealed] = React.useState(false)

  React.useEffect(() => {
    setIsRevealed(false)
  }, [resetKey])

  React.useEffect(() => {
    const hideOnSubmit = () => setIsRevealed(false)
    document.addEventListener("submit", hideOnSubmit, true)
    return () => document.removeEventListener("submit", hideOnSubmit, true)
  }, [])

  return {
    isRevealed,
    hide: () => setIsRevealed(false),
    toggle: () => setIsRevealed((current) => !current),
  }
}

function SecretVisibilityButton({
  className,
  disabled,
  inputId,
  isRevealed,
  onToggle,
  secretLabel = "password",
}: {
  className?: string
  disabled?: boolean
  inputId?: string
  isRevealed: boolean
  onToggle: () => void
  secretLabel?: string
}) {
  const action = isRevealed ? "Hide" : "Show"
  const label = `${action} ${secretLabel}`

  return (
    <button
      aria-controls={inputId}
      aria-label={label}
      aria-pressed={isRevealed}
      className={cn(
        "absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      disabled={disabled}
      onClick={onToggle}
      title={label}
      type="button"
    >
      {isRevealed ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
    </button>
  )
}

type RevealableSecretInputProps = Omit<React.ComponentProps<typeof Input>, "type"> & {
  buttonClassName?: string
  resetKey?: string | number
  secretLabel?: string
  wrapperClassName?: string
}

function RevealableSecretInput({
  buttonClassName,
  className,
  disabled,
  id,
  resetKey,
  secretLabel,
  wrapperClassName,
  ...props
}: RevealableSecretInputProps) {
  const visibility = useSecretVisibility(resetKey)
  const generatedId = React.useId()
  const inputId = id ?? generatedId

  return (
    <div className={cn("relative", wrapperClassName)} data-slot="revealable-secret-input">
      <Input
        {...props}
        className={cn("pr-10", className)}
        disabled={disabled}
        id={inputId}
        type={visibility.isRevealed ? "text" : "password"}
      />
      <SecretVisibilityButton
        className={buttonClassName}
        disabled={disabled}
        inputId={inputId}
        isRevealed={visibility.isRevealed}
        onToggle={visibility.toggle}
        secretLabel={secretLabel}
      />
    </div>
  )
}

export {
  RevealableSecretInput,
  SecretVisibilityButton,
  useSecretVisibility,
  type RevealableSecretInputProps,
}
