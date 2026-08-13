"use client";

import {
  AlertCircle,
  Check,
  Circle,
  FileText,
  Linkedin,
  Loader2,
  Mail,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { OutreachMedium } from "@/products/outreach/domain/types";

export interface OutreachDraftPartial {
  subject?: string | null;
  content?: string;
  reportUrl?: string | null;
  reportSlug?: string | null;
  reportId?: string | null;
}

export interface OutreachGenerationStep {
  id: string;
  label: string;
  state: string;
}

const STAGES = [
  { id: "context", label: "Understand their pain" },
  { id: "draft", label: "Shape the path and next step" },
  { id: "save", label: "Save the draft" },
] as const;

const MEDIUM = {
  inmail: { label: "Personalized InMail", icon: Linkedin },
  inmail_traditional: { label: "Traditional InMail", icon: FileText },
  email: { label: "Email", icon: Mail },
  content_comment: { label: "Content comment", icon: MessageSquare },
} satisfies Record<OutreachMedium, { label: string; icon: typeof Mail }>;

export function OutreachGenerationPanel({
  error,
  isComplete,
  isStreaming,
  medium,
  partial,
  prospectName,
  progress,
}: {
  error?: string | null;
  isComplete: boolean;
  isStreaming: boolean;
  medium: OutreachMedium | null;
  partial: OutreachDraftPartial | null;
  prospectName: string;
  progress: OutreachGenerationStep[];
}) {
  if (!isStreaming && !isComplete && !error) return null;

  const byId = new Map(progress.map((step) => [step.id, step]));
  const activeIndex = STAGES.findIndex((stage) => byId.get(stage.id)?.state === "running");
  const completeCount = STAGES.filter((stage) => byId.get(stage.id)?.state === "complete").length;
  const progressValue = isComplete
    ? 100
    : error
    ? Math.max(8, (completeCount / STAGES.length) * 100)
    : Math.max(8, ((completeCount + (activeIndex >= 0 ? 0.35 : 0)) / STAGES.length) * 100);
  const mediumConfig = medium ? MEDIUM[medium] : null;
  const MediumIcon = mediumConfig?.icon ?? Sparkles;

  return (
    <Card
      aria-busy={isStreaming}
      className={cn(
        "gap-0 overflow-hidden border-primary/30 py-0 shadow-md",
        error && "border-destructive/30",
      )}
      data-testid="outreach-generation-panel"
    >
      <div className="border-b bg-muted/20 px-5 py-5 sm:px-6">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary",
              error && "bg-destructive/10 text-destructive",
            )}
          >
            {error ? (
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
                {isComplete ? "Customer-first outreach ready" : "Drafting customer-first outreach"}
              </h2>
              <Badge variant={error ? "destructive" : "secondary"}>
                {error ? "Needs attention" : isComplete ? "Saved" : "Live"}
              </Badge>
              {mediumConfig ? (
                <Badge className="gap-1" variant="outline">
                  <MediumIcon className="size-3" />
                  {mediumConfig.label}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {isComplete
                ? `Saved ${prospectName}'s customer-first message to outreach drafts.`
                : `Building the message around ${prospectName}'s problem, the path to solve it, and one clear next step.`}
            </p>
          </div>
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
            const streamed = byId.get(stage.id);
            const state = streamed?.state === "complete"
              ? "complete"
              : streamed?.state === "running"
                ? "active"
                : "pending";
            return (
              <li
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-3",
                  state === "complete" && "border-chart-2/20 bg-chart-2/5",
                  state === "active" && "border-primary/30 bg-primary/5",
                  state === "pending" && "text-muted-foreground",
                )}
                key={stage.id}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs",
                    state === "complete" && "border-chart-2 bg-chart-2 text-white",
                    state === "active" && "border-primary text-primary",
                  )}
                >
                  {state === "complete" ? (
                    <Check className="size-3.5" />
                  ) : state === "active" ? (
                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Circle className="size-3" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{index + 1}. {stage.label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {streamed?.label ?? (state === "pending" ? "Queued" : stage.label)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="min-w-0 rounded-xl border bg-card">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Live draft</p>
              <p className="text-sm font-medium">Customer problem → path → next step</p>
            </div>
            {isComplete ? (
              <Badge variant="tint">Ready</Badge>
            ) : partial?.content ? (
              <Badge variant="tint">Writing</Badge>
            ) : (
              <Badge variant="outline">Preparing</Badge>
            )}
          </div>
          <div aria-atomic="true" aria-live="polite" className="min-h-44 px-4 py-4">
            {partial?.subject ? (
              <p className="mb-3 border-b pb-3 text-sm font-semibold">{partial.subject}</p>
            ) : null}
            {partial?.content ? (
              <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{partial.content}</p>
            ) : (
              <div className="space-y-3" aria-label="Preparing live outreach draft">
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
