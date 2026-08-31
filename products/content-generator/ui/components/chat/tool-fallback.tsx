"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { ToolRecoveryCard } from "@/components/chat/tool-parts/tool-recovery-card";

export const ToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
  status,
  isError,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const isRunning = status.type === "running" || status.type === "requires-action";
  const output = result && typeof result === "object" && !Array.isArray(result)
    ? result as { error?: unknown; streamError?: unknown; effectState?: unknown }
    : null;
  const resultError = typeof output?.streamError === "string"
    ? output.streamError
    : typeof output?.error === "string"
      ? output.error
      : null;
  const statusError = status.type === "incomplete"
    ? typeof status.error === "string"
      ? status.error
      : status.error && typeof status.error === "object" && "message" in status.error && typeof status.error.message === "string"
        ? status.error.message
        : null
    : null;

  if (isError || status.type === "incomplete" || resultError) {
    return (
      <ToolRecoveryCard
        toolName={toolName}
        status={status}
        isError={isError}
        partialResult={isError ? undefined : result}
        errorMessage={resultError ?? statusError ?? undefined}
        effectState={output?.effectState === "committed" ? "committed" : "none"}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="mb-4 flex w-full flex-col gap-3 rounded-lg border py-3"
    >
      <div className="flex items-center gap-2 px-4">
        {isRunning ? (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <CheckIcon className="size-4 text-green-600" />
        )}
        <p className="flex-grow text-sm">
          {isRunning ? "Running" : "Used"}: <b>{toolName}</b>
        </p>
        {!isRunning && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronUpIcon className="h-4 w-4" />}
          </Button>
        )}
      </div>
      <AnimatePresence>
        {!isCollapsed && !isRunning && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 border-t pt-2">
              <div className="px-4">
                <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{argsText}</pre>
              </div>
              {result !== undefined && (
                <div className="border-t border-dashed px-4 pt-2">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Result:</p>
                  <pre className="whitespace-pre-wrap text-xs text-muted-foreground max-h-40 overflow-auto">
                    {typeof result === "string"
                      ? result
                      : JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
