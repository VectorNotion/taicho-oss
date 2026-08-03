"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

function Progress({
  value = 0,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & { value?: number }) {
  const bounded = Math.min(100, Math.max(0, value))
  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(bounded)}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      {...props}
    >
      <div
        className="h-full bg-primary transition-[width] duration-500"
        style={{ width: `${bounded}%` }}
      />
    </div>
  )
}

export { Progress }
