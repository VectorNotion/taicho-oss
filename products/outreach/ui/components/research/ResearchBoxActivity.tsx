"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  ChevronDown,
  ExternalLink,
  FileSearch,
  Files,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import { LiveDot } from "@/components/LiveDot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { safeExternalUrl } from "../../safe-external-url";
import type { DimensionLane } from "./useDimensionResearch";
import type { ResearchActivityTelemetry, ResearchTelemetrySnapshot } from "./useDurableDimensionResearch";

function elapsedMilliseconds(startedAt: string | null, completedAt: string | null, now: number) {
  if (!startedAt) return 0;
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

function durationLabel(milliseconds: number) {
  const safeMilliseconds = Math.max(0, milliseconds);
  if (safeMilliseconds < 10_000) {
    const preciseSeconds = (safeMilliseconds / 1_000).toFixed(2).replace(/\.?0+$/, "");
    return `${preciseSeconds}s`;
  }
  const seconds = Math.floor(safeMilliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function Metric({ icon: Icon, label, value }: {
  icon: typeof Clock3;
  label: string;
  value: string | number;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-1 text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function activityLabel(activity: ResearchActivityTelemetry) {
  switch (activity.type) {
    case "query_failed": return "Query failed";
    case "query_completed": return "Pages returned";
    case "query_started": return "Searching now";
    case "synthesis_started": return "Summarizing evidence";
    case "synthesis_completed": return "Evidence summarized";
    case "observations_persisted": return "Research findings saved";
    case "graph_enrichment_started": return "Linking findings to the Brain";
    case "graph_enrichment_completed": return "Brain enrichment complete";
    case "graph_enrichment_warning": return "Brain enrichment skipped";
    case "scoring_started": return "Scoring criteria";
    case "scoring_completed": return "Criteria scored";
    case "scope_completed": return "Research complete";
  }
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="max-h-40 overflow-y-auto rounded-sm border-l-2 border-border pl-2 text-xs leading-5 text-muted-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h1: ({ children }) => <p className="mb-1 font-semibold text-foreground">{children}</p>,
          h2: ({ children }) => <p className="mb-1 font-semibold text-foreground">{children}</p>,
          h3: ({ children }) => <p className="mb-1 font-medium text-foreground">{children}</p>,
          h4: ({ children }) => <p className="mb-1 font-medium text-foreground">{children}</p>,
          p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-4">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => <blockquote className="mb-1.5 border-l-2 pl-2 italic">{children}</blockquote>,
          code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{children}</code>,
          pre: ({ children }) => <pre className="mb-1.5 overflow-x-auto rounded bg-muted p-2 text-[11px]">{children}</pre>,
          a: ({ children, href }) => {
            const safeHref = safeExternalUrl(href ?? "");
            return safeHref ? (
              <a className="text-primary underline underline-offset-2" href={safeHref} rel="noopener noreferrer" target="_blank">
                {children}
              </a>
            ) : <span>{children}</span>;
          },
          img: ({ alt }) => <span className="italic">{alt ? `[Image: ${alt}]` : "[Image]"}</span>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function QueryReceipt({ activity }: { activity: ResearchActivityTelemetry }) {
  const failed = activity.type === "query_failed";
  const safePages = (activity.pages ?? []).map((page) => ({
    ...page,
    safeUrl: safeExternalUrl(page.url),
  }));

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {failed
              ? <AlertCircle className="size-4 shrink-0 text-destructive" />
              : <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />}
            <span className="text-xs font-medium">{activityLabel(activity)}</span>
            {activity.dimensionName ? <Badge variant="outline">{activity.dimensionName}</Badge> : null}
          </div>
          {activity.query ? (
            <p className="mt-2 break-words font-mono text-xs leading-5 text-foreground/80">{activity.query}</p>
          ) : null}
        </div>
        <div className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {activity.durationMs != null ? <p>{durationLabel(activity.durationMs)}</p> : null}
          {!failed ? <p>{activity.pagesRead ?? 0}/{activity.pagesFound ?? 0} read</p> : null}
        </div>
      </div>

      {activity.error ? <p className="mt-2 text-xs leading-5 text-destructive">{activity.error}</p> : null}

      {safePages.length > 0 ? (
        <ul aria-label={`Pages for ${activity.query ?? "research query"}`} className="mt-3 space-y-2">
          {safePages.map((page, index) => (
            <li className="grid gap-1 rounded-md bg-muted/40 px-2.5 py-2" key={`${page.url}-${index}`}>
              <div className="flex min-w-0 items-center gap-2">
                <Badge className={cn("shrink-0", page.status === "failed" && "border-destructive/30 text-destructive")} variant="outline">
                  {page.status === "extracted" ? "Extracted" : page.status === "failed" ? "Failed" : "Snippet"}
                </Badge>
                {page.safeUrl ? (
                  <a className="flex min-w-0 items-center gap-1 text-xs font-medium text-primary hover:underline" href={page.safeUrl} rel="noopener noreferrer" target="_blank">
                    <span className="truncate">{page.title || hostname(page.url)}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                ) : (
                  <span className="truncate text-xs font-medium">{page.title || "Unknown page"}</span>
                )}
                <span className="ml-auto hidden shrink-0 text-[10px] text-muted-foreground sm:inline">{hostname(page.url)}</span>
              </div>
              <p className="truncate font-mono text-[10px] text-muted-foreground/80" title={page.url}>{page.url}</p>
              {page.contentPreview ? (
                <MarkdownPreview content={page.contentPreview} />
              ) : (
                <p className="text-xs text-muted-foreground">{page.error || "No readable content returned."}</p>
              )}
              {page.error && page.contentPreview ? <p className="text-[11px] leading-4 text-destructive">Extraction issue: {page.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ResearchBoxActivity({
  telemetry,
  dimensions,
  isRunning,
  scope,
  error,
  progress,
  startedAt,
  completedAt,
  isRetrying = false,
  onRetry,
}: {
  telemetry: ResearchTelemetrySnapshot | null;
  dimensions: DimensionLane[];
  isRunning: boolean;
  scope: "person" | "account";
  error?: string | null;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  isRetrying?: boolean;
  onRetry?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [logsExpanded, setLogsExpanded] = useState(isRunning);
  useEffect(() => {
    if (!isRunning) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isRunning]);
  useEffect(() => {
    setLogsExpanded(isRunning);
  }, [isRunning, startedAt]);

  const scopedActivities = useMemo(
    () => (telemetry?.activities ?? []).filter((activity) => activity.scope === scope),
    [scope, telemetry?.activities],
  );
  const queryReceipts = useMemo(
    () => scopedActivities
      .filter((activity) => activity.type === "query_completed" || activity.type === "query_failed")
      .reverse(),
    [scopedActivities],
  );
  const synthesisActivity = [...scopedActivities]
    .reverse()
    .find((activity) => activity.type === "synthesis_started" || activity.type === "synthesis_completed");
  const scopeCompletedActivity = [...scopedActivities]
    .reverse()
    .find((activity) => activity.type === "scope_completed");
  const latestStageActivity = [...scopedActivities]
    .reverse()
    .find((activity) => activity.type !== "query_started" && activity.type !== "query_completed" && activity.type !== "query_failed");
  const warningActivities = scopedActivities.filter((activity) => (
    activity.type === "query_failed"
    || activity.type === "graph_enrichment_warning"
    || (activity.warnings?.length ?? 0) > 0
  ));
  const queryState = new Map<string, string>();
  for (const activity of scopedActivities) {
    if (!activity.query) continue;
    const key = activity.dimensionKey ?? activity.query;
    if (activity.type === "query_started") queryState.set(key, activity.query);
    if (activity.type === "query_completed" || activity.type === "query_failed") queryState.delete(key);
  }
  const activeQueries = [...queryState.values()];
  const queriesStarted = scopedActivities.filter((activity) => activity.type === "query_started").length;
  const queriesCompleted = queryReceipts.length;
  const pagesFound = queryReceipts.reduce((total, activity) => total + (activity.pagesFound ?? 0), 0);
  const pagesRead = queryReceipts.reduce((total, activity) => total + (activity.pagesRead ?? 0), 0);
  const pagesFailed = queryReceipts.reduce((total, activity) => total + (activity.pagesFailed ?? 0), 0);
  const scopedStartedAt = scopedActivities.find((activity) => (
    activity.type === "query_started" || activity.type === "synthesis_started"
  ))?.occurredAt ?? telemetry?.startedAt ?? startedAt;
  const scopedCompletedAt = scopeCompletedActivity?.occurredAt ?? (!isRunning && !error ? completedAt : null);
  const scopeLabel = scope === "person" ? "Prospect" : "Account";
  const scopeIsRunning = isRunning && !scopeCompletedActivity;
  const scoringIsComplete = scopedActivities.some((activity) => activity.type === "scoring_completed");
  const scored = dimensions.filter((dimension) => dimension.phase === "matched").length;
  const criteriaTotal = scopeCompletedActivity?.criteriaTotal ?? dimensions.length;
  const criteriaCompleted = scopeCompletedActivity?.criteriaCompleted ?? scored;
  const warningCount = warningActivities.reduce((total, activity) => (
    total + (activity.error ? 1 : 0) + (activity.warnings?.length ?? 0)
  ), 0);
  const phaseProgress = dimensions.length > 0
    ? dimensions.reduce((total, dimension) => total + (
        dimension.phase === "matched" ? 100 : dimension.phase === "found" ? 65 : 25
      ), 0) / dimensions.length
    : progress;
  const scopedProgress = scopeCompletedActivity || (!isRunning && !error)
    ? 100
    : Math.min(95, Math.max(phaseProgress, progress));
  const elapsed = durationLabel(elapsedMilliseconds(scopedStartedAt, scopedCompletedAt, now));
  const statusLabel = error
    ? `${scopeLabel} research stopped`
    : scopeIsRunning
      ? latestStageActivity?.type === "scoring_started"
        ? `Scoring ${scopeLabel.toLowerCase()} criteria`
        : latestStageActivity?.type === "scoring_completed"
          ? `Finalizing ${scopeLabel.toLowerCase()} research`
          : latestStageActivity?.type === "graph_enrichment_started"
            ? `Linking ${scopeLabel.toLowerCase()} findings`
            : latestStageActivity?.type === "graph_enrichment_completed" || latestStageActivity?.type === "graph_enrichment_warning"
              ? scoringIsComplete
                ? `Finalizing ${scopeLabel.toLowerCase()} research`
                : `Preparing ${scopeLabel.toLowerCase()} scoring`
              : latestStageActivity?.type === "observations_persisted" || latestStageActivity?.type === "synthesis_completed"
                ? `Preparing ${scopeLabel.toLowerCase()} scoring`
                : synthesisActivity?.type === "synthesis_started"
                  ? `Summarizing ${scopeLabel.toLowerCase()} evidence`
                  : `Researching ${scopeLabel.toLowerCase()} sources`
      : `${scopeLabel} research complete`;
  const hasLogs = scopedActivities.length > 0;
  const showLogDetails = scopeIsRunning || logsExpanded;
  const compactSummary = [
    elapsed,
    `${pagesRead} ${pagesRead === 1 ? "page" : "pages"} read`,
    ...(pagesFailed > 0 ? [`${pagesFailed} failed`] : []),
    `${criteriaCompleted}/${criteriaTotal} criteria scored`,
    ...(warningCount > 0 ? [`${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`] : []),
  ].join(" · ");

  return (
    <div aria-live="polite" className="mb-4 space-y-3 border-b pb-4" data-research-feed={scope}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div aria-label={`${scopeLabel} research status`} role="status">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {scopeIsRunning
              ? <LiveDot label={statusLabel} />
              : error
                ? <><AlertCircle className="size-4 text-destructive" />{statusLabel}</>
                : <><CheckCircle2 className="size-4 text-emerald-600" />{statusLabel}</>}
          </div>
          {scopeIsRunning ? (
            <p className="mt-1 text-xs text-muted-foreground">Exact queries, pages, and returned content for this insight.</p>
          ) : (
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">{compactSummary}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!scopeIsRunning && hasLogs ? (
            <Button
              aria-expanded={logsExpanded}
              onClick={() => setLogsExpanded((expanded) => !expanded)}
              size="sm"
              variant="ghost"
            >
              <ChevronDown className={cn("size-4 transition-transform", logsExpanded && "rotate-180")} />
              {logsExpanded ? "Hide logs" : "View logs"}
            </Button>
          ) : null}
          {error && onRetry ? (
            <Button disabled={isRetrying} onClick={onRetry} size="sm" variant="outline">
              <RotateCcw className={cn("size-4", isRetrying && "animate-spin")} />
              {isRetrying ? "Retrying…" : "Retry research"}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm leading-6 text-destructive">{error}</p> : null}

      {showLogDetails ? (
        <div className={cn("space-y-4", !scopeIsRunning && "border-t pt-4")} data-research-logs={scope}>
          <dl className="grid grid-cols-3 gap-x-3 gap-y-3 border-y py-3">
            <Metric icon={Clock3} label="Elapsed" value={elapsed} />
            <Metric icon={Search} label="Queries" value={`${queriesCompleted}/${queriesStarted}`} />
            <Metric icon={Files} label="Pages found" value={pagesFound} />
            <Metric icon={FileSearch} label="Pages read" value={pagesRead} />
            <Metric icon={AlertCircle} label="Pages failed" value={pagesFailed} />
            <Metric icon={Sparkles} label="Criteria scored" value={`${criteriaCompleted}/${criteriaTotal}`} />
          </dl>

          {scopeIsRunning ? <Progress aria-label={`${scopeLabel} research progress`} className="h-1.5" value={scopedProgress} /> : null}

          {activeQueries.length > 0 ? (
            <div className="rounded-md bg-muted/35 px-3 py-3">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Search className="size-3.5 text-primary" />
                Queries running now
              </div>
              <ul className="mt-2 space-y-1.5">
                {activeQueries.map((query) => (
                  <li className="break-words font-mono text-xs leading-5 text-muted-foreground" key={query}>{query}</li>
                ))}
              </ul>
            </div>
          ) : scopeIsRunning && queryReceipts.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Search className="size-3.5 text-primary" />
              Preparing research queries…
            </div>
          ) : null}

          {latestStageActivity ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 font-medium"><Sparkles className="size-3.5 text-primary" />{activityLabel(latestStageActivity)}</span>
              {latestStageActivity.durationMs != null ? <span className="tabular-nums text-muted-foreground">{durationLabel(latestStageActivity.durationMs)}</span> : null}
            </div>
          ) : null}

          {warningActivities.length > 0 ? (
            <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:text-amber-200">
              <p className="font-medium">Research was preserved with processing warnings</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {warningActivities.flatMap((activity) => [
                  ...(activity.error ? [activity.error] : []),
                  ...(activity.warnings ?? []),
                ]).slice(0, 8).map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {queryReceipts.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-medium">Latest query receipts</p>
                <p className="text-[11px] text-muted-foreground">{queryReceipts.length} completed</p>
              </div>
              <ul aria-label={`${scopeLabel} research query receipts`} className="max-h-[32rem] divide-y overflow-y-auto pr-1">
                {queryReceipts.map((activity) => <QueryReceipt activity={activity} key={activity.id} />)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
