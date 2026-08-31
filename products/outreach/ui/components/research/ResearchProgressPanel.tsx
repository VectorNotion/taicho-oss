"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { DimensionLane } from "./useDimensionResearch";
import { safeExternalUrl } from "../../safe-external-url";

export interface ResearchProgressGroup {
  id: string;
  entityName: string;
  kind: "person" | "account";
  label: string;
  dimensions: DimensionLane[];
  pendingLabel?: string;
}

export interface BackgroundResearchItem {
  id: string;
  name: string;
}

type StepState = "pending" | "active" | "complete" | "error";
type GroupRunState = "queued" | "active" | "complete" | "error";

const RUN_STEPS = [
  { key: "plan", label: "Plan", description: "Load research criteria" },
  { key: "investigate", label: "Investigate", description: "Gather sources and signals" },
  { key: "evaluate", label: "Evaluate", description: "Score fit and timing" },
  { key: "apply", label: "Apply", description: "Save scores and status" },
] as const;

const PHASE_PROGRESS: Record<DimensionLane["phase"], number> = {
  searching: 0.2,
  found: 0.65,
  matched: 1,
};

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function formatDimensionKey(key: string): string {
  return key.replaceAll("_", " ");
}

function phaseCounts(dimensions: DimensionLane[]) {
  return dimensions.reduce(
    (counts, dimension) => {
      counts[dimension.phase] += 1;
      return counts;
    },
    { searching: 0, found: 0, matched: 0 },
  );
}

function groupProgress(group: ResearchProgressGroup): number {
  if (group.dimensions.length === 0) return 0;
  return (
    group.dimensions.reduce((total, dimension) => total + PHASE_PROGRESS[dimension.phase], 0)
    / group.dimensions.length
  ) * 100;
}

function runStepStates({
  dimensions,
  hasQueuedGroup,
  isComplete,
  isStreaming,
  error,
}: {
  dimensions: DimensionLane[];
  hasQueuedGroup: boolean;
  isComplete: boolean;
  isStreaming: boolean;
  error?: string | null;
}): StepState[] {
  const hasDimensions = dimensions.length > 0;
  const evidenceComplete = hasDimensions
    && dimensions.every((dimension) => dimension.phase !== "searching")
    && !hasQueuedGroup;
  const evaluationStarted = dimensions.some((dimension) => dimension.phase !== "searching");
  const scoresComplete = hasDimensions
    && dimensions.every((dimension) => dimension.phase === "matched")
    && !hasQueuedGroup;

  const states: StepState[] = [
    isComplete || hasDimensions ? "complete" : isStreaming ? "active" : "pending",
    isComplete || evidenceComplete
      ? "complete"
      : isStreaming && hasDimensions
        ? "active"
        : "pending",
    isComplete || scoresComplete
      ? "complete"
      : isStreaming && evaluationStarted
        ? "active"
        : "pending",
    isComplete ? "complete" : isStreaming && scoresComplete ? "active" : "pending",
  ];

  if (error) {
    const interrupted = states.findIndex((state) => state !== "complete");
    states[interrupted === -1 ? states.length - 1 : interrupted] = "error";
  }
  return states;
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "complete") return <Check className="size-3.5" />;
  if (state === "active") return <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />;
  if (state === "error") return <AlertCircle className="size-3.5" />;
  return <Circle className="size-3.5" />;
}

function RunStageRail({ states }: { states: StepState[] }) {
  return (
    <ol aria-label="Research stages" className="grid gap-3 sm:grid-cols-4">
      {RUN_STEPS.map((step, index) => {
        const state = states[index];
        return (
          <li
            className={cn(
              "border-l-2 pl-3 sm:border-l-0 sm:border-t-2 sm:pl-0 sm:pt-3",
              state === "complete" && "border-chart-2",
              state === "active" && "border-primary",
              state === "error" && "border-destructive",
              state === "pending" && "border-border",
            )}
            key={step.key}
          >
            <div
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium",
                state === "complete" && "text-chart-2",
                state === "active" && "text-primary",
                state === "error" && "text-destructive",
                state === "pending" && "text-muted-foreground",
              )}
            >
              <StepIcon state={state} />
              {step.label}
              <span className="sr-only">— {state}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.description}</p>
          </li>
        );
      })}
    </ol>
  );
}

function CriterionSteps({ phase }: { phase: DimensionLane["phase"] }) {
  const steps: Array<{ label: string; state: StepState }> = [
    { label: "Search", state: phase === "searching" ? "active" : "complete" },
    {
      label: "Evidence",
      state: phase === "searching" ? "pending" : "complete",
    },
    {
      label: "Score",
      state: phase === "matched" ? "complete" : phase === "found" ? "active" : "pending",
    },
  ];

  return (
    <ol aria-label="Criterion progress" className="mt-3 flex items-center">
      {steps.map((step, index) => (
        <li className="flex min-w-0 flex-1 items-center last:flex-none" key={step.label}>
          <span className="flex min-w-0 flex-col items-center gap-1">
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full border text-[10px]",
                step.state === "complete" && "border-chart-2 bg-chart-2 text-white",
                step.state === "active" && "border-primary bg-primary/10 text-primary",
                step.state === "pending" && "border-border bg-background text-muted-foreground",
              )}
            >
              {step.state === "complete" ? (
                <Check className="size-3" />
              ) : step.state === "active" ? (
                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
              ) : (
                index + 1
              )}
            </span>
            <span className="text-[10px] text-muted-foreground">{step.label}</span>
          </span>
          {index < steps.length - 1 ? (
            <span
              className={cn(
                "mx-2 mb-4 h-px min-w-4 flex-1",
                steps[index + 1].state !== "pending" ? "bg-chart-2" : "bg-border",
              )}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function EvidenceLinks({ urls }: { urls: string[] }) {
  const unique = [...new Set(urls.map((url) => safeExternalUrl(url)).filter((url): url is string => Boolean(url)))].slice(0, 4);
  if (unique.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {unique.map((url) => (
        <a
          className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
          href={url}
          key={url}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-3" />
          {hostname(url)}
        </a>
      ))}
    </div>
  );
}

function DimensionCard({ dimension }: { dimension: DimensionLane }) {
  const score = dimension.matchScore == null ? null : Math.round(dimension.matchScore * 100);
  const evidence = dimension.evidence ?? dimension.signals?.flatMap((signal) => signal.evidence) ?? [];
  const phaseLabel = dimension.phase === "searching"
    ? "Searching sources"
    : dimension.phase === "found"
      ? "Evidence ready for scoring"
      : score == null
        ? "Scored"
        : dimension.type === "timing"
          ? `${score}% signal heat`
          : `${score}% match`;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 transition-colors",
        dimension.phase === "searching" && "border-primary/30 bg-primary/5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium capitalize">
              {formatDimensionKey(dimension.name || dimension.dimensionKey)}
            </h4>
            <Badge className="px-1.5 py-0 text-[10px]" variant="outline">
              {dimension.type === "timing" ? "Timing" : "Fit"}
            </Badge>
          </div>
          <p
            className={cn(
              "mt-1 text-xs text-muted-foreground",
              dimension.phase === "searching" && "text-primary",
              dimension.phase === "matched" && "text-chart-2",
            )}
          >
            {phaseLabel}
          </p>
        </div>
        {dimension.phase === "matched" ? (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-chart-2/10 text-chart-2">
            <CheckCircle2 className="size-4" />
          </span>
        ) : dimension.phase === "searching" ? (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <Search className="size-4" />
          </span>
        ) : (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </span>
        )}
      </div>

      <CriterionSteps phase={dimension.phase} />

      {dimension.observedValue ? (
        <p className="mt-3 border-t pt-3 text-sm leading-6 text-muted-foreground">
          {dimension.observedValue}
        </p>
      ) : null}
      {dimension.signals && dimension.signals.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t pt-3">
          {dimension.signals.slice(0, 4).map((signal, index) => (
            <li className="flex items-baseline justify-between gap-3 text-sm" key={`${signal.signal}-${index}`}>
              <span className="text-muted-foreground">{signal.signal}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{signal.date}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <EvidenceLinks urls={evidence} />
    </div>
  );
}

function GroupStatus({ group, state }: { group: ResearchProgressGroup; state: GroupRunState }) {
  if (state === "complete") return <Badge variant="tint">Done</Badge>;
  if (state === "error") return <Badge variant="destructive">Needs attention</Badge>;
  if (state === "queued") return <Badge variant="outline">Queued</Badge>;
  if (group.dimensions.length === 0) return <Badge variant="secondary">Starting</Badge>;
  const counts = phaseCounts(group.dimensions);
  if (counts.found > 0 || counts.matched > 0) return <Badge variant="secondary">Scoring</Badge>;
  return <Badge variant="secondary">Gathering evidence</Badge>;
}

function ResearchGroupSection({
  group,
  sequence,
  state,
}: {
  group: ResearchProgressGroup;
  sequence: number;
  state: GroupRunState;
}) {
  const counts = phaseCounts(group.dimensions);
  const Icon = group.kind === "account" ? Building2 : User;
  const [open, setOpen] = useState(state === "active" || state === "error");

  return (
    <Collapsible asChild onOpenChange={setOpen} open={open}>
      <section
        aria-labelledby={`research-group-${group.id}`}
        className={cn(
          "rounded-xl border bg-muted/20 transition-colors",
          state === "active" && "border-primary/30 bg-primary/[0.03]",
          state === "complete" && "bg-muted/10",
          state === "error" && "border-destructive/30",
        )}
      >
        <CollapsibleTrigger asChild>
          <button
            className="flex w-full flex-col gap-3 px-4 py-4 text-left sm:flex-row sm:items-center sm:justify-between"
            type="button"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg bg-background text-primary shadow-sm ring-1 ring-border",
                  state === "complete" && "text-chart-2",
                  state === "queued" && "text-muted-foreground",
                  state === "error" && "text-destructive",
                )}
              >
                {state === "complete" ? <Check className="size-4" /> : <Icon className="size-4" />}
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Step {sequence} · {group.label}
                </p>
                <h3 className="truncate text-sm font-semibold" id={`research-group-${group.id}`}>
                  {group.entityName}
                </h3>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {group.dimensions.length > 0 ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {counts.matched}/{group.dimensions.length} scored
                </span>
              ) : null}
              <GroupStatus group={group} state={state} />
              <ChevronDown
                aria-hidden="true"
                className={cn("size-4 text-muted-foreground transition-transform", !open && "-rotate-90")}
              />
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          {group.dimensions.length === 0 ? (
            <div className="flex items-center gap-3 border-t px-4 py-5 text-sm text-muted-foreground">
              {state === "active" ? (
                <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
              ) : (
                <Circle className="size-4 shrink-0" />
              )}
              {state === "active"
                ? `Preparing ${group.label.toLowerCase()}…`
                : group.pendingLabel ?? "Waiting for this part of the research run to begin."}
            </div>
          ) : (
            <div className="grid gap-3 border-t p-3 lg:grid-cols-2">
              {group.dimensions.map((dimension) => (
                <DimensionCard dimension={dimension} key={`${dimension.scope ?? group.kind}:${dimension.dimensionKey}`} />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

export function ResearchProgressPanel({
  groups,
  isStreaming,
  isComplete,
  error,
  backgroundItems = [],
  operationId,
  persistedProgress,
  onRetry,
  isRetrying = false,
}: {
  groups: ResearchProgressGroup[];
  isStreaming: boolean;
  isComplete: boolean;
  error?: string | null;
  backgroundItems?: BackgroundResearchItem[];
  operationId?: string | null;
  persistedProgress?: number;
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const dimensions = useMemo(() => groups.flatMap((group) => group.dimensions), [groups]);
  const groupStates = useMemo(() => {
    const complete = groups.map((group) =>
      group.dimensions.length > 0
      && group.dimensions.every((dimension) => dimension.phase === "matched"),
    );
    const current = complete.findIndex((done) => !done);
    return groups.map((_, index): GroupRunState => {
      if (complete[index]) return "complete";
      if (index === current && error) return "error";
      if (index === current && isStreaming) return "active";
      return "queued";
    });
  }, [error, groups, isStreaming]);
  const counts = phaseCounts(dimensions);
  const hasQueuedGroup = groups.some((group) => group.dimensions.length === 0);
  const states = runStepStates({ dimensions, hasQueuedGroup, isComplete, isStreaming, error });
  const rawProgress = groups.length > 0
    ? groups.reduce((total, group) => total + groupProgress(group), 0) / groups.length
    : 0;
  const progress = isComplete
    ? 100
    : Math.min(96, Math.max(persistedProgress ?? 0, isStreaming && rawProgress === 0 ? 5 : rawProgress));

  const status = error
    ? { label: "Needs attention", variant: "destructive" as const }
    : isComplete
      ? { label: "Complete", variant: "tint" as const }
      : { label: "In progress", variant: "secondary" as const };
  const summary = error
    ? "Research stopped before every criterion was completed. Your completed findings are preserved."
    : isComplete
      ? `${counts.matched} ${counts.matched === 1 ? "criterion" : "criteria"} scored and applied.`
      : dimensions.length === 0
        ? "Preparing the research plan and loading your criteria…"
        : hasQueuedGroup && counts.matched === dimensions.length
          ? "Person research is scored. Moving to company research next…"
          : counts.searching > 0
            ? `Gathering evidence for ${counts.searching} ${counts.searching === 1 ? "criterion" : "criteria"}…`
            : counts.found > 0
              ? `Evidence gathered. Scoring ${counts.found} ${counts.found === 1 ? "criterion" : "criteria"}…`
              : "Saving the new scores and qualification status…";

  // This surface is operational, not historical. Once the durable insight and
  // scores have refreshed, the live run should yield the page back to them.
  if (isComplete && !error) return null;

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <Card
        aria-busy={isStreaming}
        className={cn("gap-0 overflow-hidden py-0", isStreaming && "border-primary/30 shadow-md")}
        data-testid="research-progress-panel"
      >
      <div className="border-b bg-muted/20 px-5 py-5 sm:px-6">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl",
              error ? "bg-destructive/10 text-destructive" : isComplete ? "bg-chart-2/10 text-chart-2" : "bg-primary/10 text-primary",
            )}
          >
            {error ? (
              <AlertCircle className="size-5" />
            ) : isComplete ? (
              <CheckCircle2 className="size-5" />
            ) : (
              <Search className="size-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Research run</h2>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            <p aria-atomic="true" aria-live="polite" className="mt-1 text-sm leading-6 text-muted-foreground">
              {summary}
            </p>
            {operationId ? (
              <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                Durable run {operationId.slice(0, 8)}
              </p>
            ) : null}
          </div>
          {dimensions.length > 0 || backgroundItems.length > 0 ? (
            <CollapsibleTrigger asChild>
              <Button aria-label={open ? "Collapse research details" : "Expand research details"} size="icon-sm" variant="ghost">
                <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />
              </Button>
            </CollapsibleTrigger>
          ) : null}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Progress aria-label="Overall research progress" className="h-1.5" value={progress} />
          <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <RunStageRail states={states} />
      </div>

        <CollapsibleContent>
          <div className="space-y-3 border-t px-3 py-3 sm:px-4">
            {backgroundItems.length > 0 ? (
              <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                <Users className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">
                    Person research started in the background
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {backgroundItems.slice(0, 3).map((item) => item.name).join(", ")}
                    {backgroundItems.length > 3 ? ` and ${backgroundItems.length - 3} more` : ""}
                    {backgroundItems.length === 1 ? " is" : " are"} continuing separately. Their prospect pages will update as each run finishes.
                  </p>
                </div>
              </div>
            ) : null}
            {groups.map((group, index) => (
              <ResearchGroupSection
                group={group}
                // Remount on a stage transition so the completed stage closes
                // and the newly active stage opens. Within one state, users can
                // still expand/collapse it manually without being overridden.
                key={`${group.id}:${groupStates[index]}`}
                sequence={index + 1}
                state={groupStates[index]}
              />
            ))}
            {error ? (
              <div className="flex flex-col gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
                {onRetry ? (
                  <Button disabled={isRetrying} onClick={onRetry} size="sm" variant="outline">
                    {isRetrying ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                    Retry failed run
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
