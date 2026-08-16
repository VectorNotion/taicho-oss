"use client";

import { CheckIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatToolApproval } from "@/components/chat/chat-runtime-provider";

function displayToolName(name: string) {
  return name
    .replaceAll("__", " › ")
    .replaceAll("_", " ");
}

export function ChatToolApprovalCard() {
  const { pendingApproval, responding, error, respondToApproval } = useChatToolApproval();
  if (!pendingApproval) return null;
  const serializedArgs = JSON.stringify(pendingApproval.args, null, 2);
  const args = serializedArgs.length > 1_600
    ? `${serializedArgs.slice(0, 1_600)}\n…`
    : serializedArgs;

  return (
    <div
      className="mx-auto mb-3 w-full max-w-3xl rounded-xl border border-amber-500/35 bg-amber-500/5 p-3 shadow-sm sm:p-4"
      data-testid="chat-tool-approval"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-lg bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
          <ShieldAlertIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Taicho needs your approval</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Review the exact MCP operation before it changes workspace data.
          </p>
          <p className="mt-3 break-words font-mono text-xs font-medium">
            {displayToolName(pendingApproval.toolName)}
          </p>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg border bg-background/80 p-2 text-[11px] leading-5 text-muted-foreground">
            {args}
          </pre>
          {error ? (
            <p className="mt-2 text-xs text-destructive" role="status">
              {error} You can try again.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              disabled={responding}
              onClick={() => void respondToApproval(false).catch(() => undefined)}
              size="sm"
              variant="outline"
            >
              <XIcon className="size-3.5" />
              Decline
            </Button>
            <Button
              disabled={responding}
              onClick={() => void respondToApproval(true).catch(() => undefined)}
              size="sm"
            >
              <CheckIcon className="size-3.5" />
              {responding ? "Continuing…" : "Approve and continue"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
