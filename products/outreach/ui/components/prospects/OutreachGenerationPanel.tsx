"use client";

import {
  AlertCircle,
  Check,
  Circle,
  FileText,
  UserPlus,
  Linkedin,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { OutreachMedium, OutreachMessage } from "@/products/outreach/domain/types";

export interface OutreachGenerationProgress {
  kind: "outreach-generation";
  phase: "context" | "draft" | "save";
  label: string;
  state: "running" | "complete";
  updatedAt: string;
}

export interface OutreachGenerationOperation {
  id: string;
  status: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
  progress: number;
  attempt: number;
  maxAttempts: number;
}

const STAGES = [
  { id: "context", label: "Validate opportunity coverage" },
  { id: "draft", label: "Shape the path and next step" },
  { id: "save", label: "Save and schedule follow-up" },
] as const;

const MEDIUM = {
  inmail: { label: "Personalized InMail", icon: Linkedin },
  inmail_traditional: { label: "Traditional InMail", icon: FileText },
  connection_note: { label: "Connection note", icon: UserPlus },
  email: { label: "Email", icon: Mail },
  content_comment: { label: "Content comment", icon: MessageSquare },
} satisfies Record<OutreachMedium, { label: string; icon: typeof Mail }>;

export function OutreachGenerationPanel({
  error,
  isComplete,
  isStreaming,
  medium,
  message,
  onRetry,
  operation,
  progress,
  prospectName,
  retrying,
  simulation,
}: {
  error?: string | null;
  isComplete: boolean;
  isStreaming: boolean;
  medium: OutreachMedium | null;
  message: OutreachMessage | null;
  onRetry: () => void;
  operation: OutreachGenerationOperation | null;
  progress: OutreachGenerationProgress | null;
  prospectName: string;
  retrying: boolean;
  simulation: "sandbox" | null;
}) {
  if (!operation && !isStreaming && !isComplete && !error) return null;

  const operationFailed = operation?.status === "failed";
  const currentStageIndex = progress
    ? STAGES.findIndex((stage) => stage.id === progress.phase)
    : -1;
  const progressValue = operation?.progress ?? (isComplete ? 100 : 0);
  const effectiveMedium = message?.medium ?? medium;
  const mediumConfig = effectiveMedium ? MEDIUM[effectiveMedium] : null;
  const MediumIcon = mediumConfig?.icon ?? Sparkles;

  return (
    <Card
      aria-busy={isStreaming}
      className={cn(
        "gap-0 overflow-hidden border-primary/30 py-0 shadow-md",
        operationFailed && "border-destructive/30",
      )}
      data-testid="outreach-generation-panel"
    >
      <div className="border-b bg-muted/20 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary",
                operationFailed && "bg-destructive/10 text-destructive",
              )}
            >
              {operationFailed ? (
                <AlertCircle className="size-5" />
              ) : isComplete ? (
                <Check className="size-5" />
              ) : (
                <Sparkles className="size-5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">
                  {operationFailed
                    ? "Outreach generation needs attention"
                    : isComplete
                      ? "Customer-first outreach ready"
                      : "Drafting customer-first outreach"}
                </h2>
                <Badge variant={operationFailed ? "destructive" : "secondary"}>
                  {operationFailed ? "Failed safely" : isComplete ? "Saved" : "Durable"}
                </Badge>
                {mediumConfig ? (
                  <Badge className="gap-1" variant="outline">
                    <MediumIcon className="size-3" />
                    {mediumConfig.label}
                  </Badge>
                ) : null}
                {simulation === "sandbox" ? <Badge variant="outline">Sandbox model</Badge> : null}
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {operationFailed
                  ? "The failed attempt is preserved. Retry resumes this operation and reuses any draft that already reached storage."
                  : isComplete
                    ? `Saved ${prospectName}'s message and scheduled the next follow-up.`
                    : progress?.label ?? `Building a message around ${prospectName}'s problem and one clear next step.`}
              </p>
              {operation ? (
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  Operation {operation.id} · attempt {operation.attempt} of {operation.maxAttempts}
                </p>
              ) : null}
            </div>
          </div>
          {operationFailed ? (
            <Button disabled={retrying} onClick={onRetry} size="sm" variant="outline">
              <RefreshCw className={cn("size-4", retrying && "animate-spin")} />
              {retrying ? "Retrying…" : "Retry same operation"}
            </Button>
          ) : null}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Progress aria-label="Outreach generation progress" className="h-1.5" value={progressValue} />
          <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
            {Math.round(progressValue)}%
          </span>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <ol aria-label="Outreach generation stages" className="space-y-2">
          {STAGES.map((stage, index) => {
            const state = isComplete
              ? "complete"
              : index < currentStageIndex
                ? "complete"
                : index === currentStageIndex
                  ? progress?.state === "complete" ? "complete" : operationFailed ? "failed" : "active"
                  : "pending";
            return (
              <li
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-3",
                  state === "complete" && "border-chart-2/20 bg-chart-2/5",
                  state === "active" && "border-primary/30 bg-primary/5",
                  state === "failed" && "border-destructive/30 bg-destructive/5",
                  state === "pending" && "text-muted-foreground",
                )}
                key={stage.id}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs",
                    state === "complete" && "border-chart-2 bg-chart-2 text-white",
                    state === "active" && "border-primary text-primary",
                    state === "failed" && "border-destructive text-destructive",
                  )}
                >
                  {state === "complete" ? (
                    <Check className="size-3.5" />
                  ) : state === "active" ? (
                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                  ) : state === "failed" ? (
                    <AlertCircle className="size-3.5" />
                  ) : (
                    <Circle className="size-3" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{index + 1}. {stage.label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {index === currentStageIndex
                      ? progress?.label
                      : state === "complete" ? "Complete" : "Queued"}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="min-w-0 rounded-xl border bg-card">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Saved draft</p>
              <p className="text-sm font-medium">Customer problem → path → next step</p>
            </div>
            <Badge variant={message ? "tint" : "outline"}>
              {message ? "Ready" : operationFailed ? "Not saved" : "Preparing"}
            </Badge>
          </div>
          <div aria-atomic="true" aria-live="polite" className="min-h-44 px-4 py-4">
            {message ? (
              <>
                {message.subject ? (
                  <p className="mb-3 border-b pb-3 text-sm font-semibold">{message.subject}</p>
                ) : null}
                <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{message.content}</p>
              </>
            ) : operationFailed ? (
              <div className="grid min-h-36 place-items-center text-center text-sm text-muted-foreground">
                No new message was recorded by this failed attempt.
              </div>
            ) : (
              <div className="space-y-3" aria-label="Preparing durable outreach draft">
                <div className="h-3 w-11/12 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                <div className="h-3 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
                <div className="h-3 w-9/12 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                <div className="h-3 w-10/12 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              </div>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 border-t bg-destructive/5 px-5 py-3 text-sm text-destructive sm:px-6">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </Card>
  );
}
