"use client";

import { useState } from "react";
import type { ToolCallMessagePartStatus } from "@assistant-ui/react";
import { useAssistantApi } from "@assistant-ui/react";
import { AlertTriangleIcon, ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ToolRecoveryCardProps = {
  toolName: string;
  status: ToolCallMessagePartStatus;
  isError?: boolean;
  partialResult?: unknown;
};

const reasonCopy = {
  cancelled: "This work was stopped before it finished.",
  length: "The tool response ended before all results arrived.",
  "content-filter": "The provider could not safely return this result.",
  other: "This tool could not finish its work.",
  error: "The tool encountered a temporary problem.",
};

function formatPartialResult(result: unknown): string | null {
  if (result === undefined || result === null) return null;
  if (typeof result === "string") return result;

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return "Partial results were received but could not be displayed.";
  }
}

/** ACTION-04 — honest recovery for failed, cancelled, or truncated tool work. */
export function ToolRecoveryCard({
  toolName,
  status,
  partialResult,
}: ToolRecoveryCardProps) {
  const assistant = useAssistantApi();
  const [showPartial, setShowPartial] = useState(false);
  const partial = formatPartialResult(partialResult);

  const retry = () => {
    assistant.message().reload();
  };

  return (
    <motion.section
      data-component="ACTION-04 Recovery Card"
      data-testid="tool-recovery-card"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      className="my-3 overflow-hidden rounded-xl border border-amber-500/25 bg-amber-500/[0.045]"
      aria-label={`${toolName} recovery`}
    >
      <div className="flex items-start gap-3 p-3.5">
        <div className="mt-0.5 rounded-full border border-amber-500/25 bg-amber-500/10 p-1.5 text-amber-600 dark:text-amber-300">
          <AlertTriangleIcon className="size-3.5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700/80 dark:text-amber-300/80">
            Work paused safely
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {status.type === "incomplete" ? reasonCopy[status.reason] : "The tool encountered a temporary problem."}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Nothing new was written. Retry this turn, or adjust the request and send it again.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={retry}>
          <RefreshCwIcon className="size-3.5" aria-hidden="true" />
          Retry
        </Button>
      </div>

      {partial && (
        <div className="border-t border-amber-500/15">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-amber-500/[0.04]"
            onClick={() => setShowPartial((current) => !current)}
            aria-expanded={showPartial}
          >
            <span>Partial output retained</span>
            <ChevronDownIcon className={cn("size-3.5 transition-transform", showPartial && "rotate-180")} />
          </button>
          {showPartial && (
            <pre className="max-h-44 overflow-auto border-t border-amber-500/10 px-3.5 py-3 text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap">
              {partial}
            </pre>
          )}
        </div>
      )}
    </motion.section>
  );
}
