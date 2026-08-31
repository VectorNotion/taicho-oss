"use client";

import { AlertTriangle, Building2, ExternalLink, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentMeter } from "@/components/genui";
import { cn } from "@/lib/utils";
import { icpBand, timingBand, type ScoreBand } from "@/lib/score-bands";
import { safeExternalUrl } from "../../safe-external-url";
import { ResearchBoxActivity } from "../research/ResearchBoxActivity";
import type { DimensionLane } from "../research/useDimensionResearch";
import type { ResearchTelemetrySnapshot } from "../research/useDurableDimensionResearch";

export interface ResearchExecutionView {
  dimensions: DimensionLane[];
  isRunning: boolean;
  error: string | null;
  telemetry: ResearchTelemetrySnapshot | null;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  isRetrying: boolean;
  onRetry?: () => void;
}

export const EMPTY_RESEARCH_EXECUTION: ResearchExecutionView = {
  dimensions: [],
  isRunning: false,
  error: null,
  telemetry: null,
  progress: 0,
  startedAt: null,
  completedAt: null,
  isRetrying: false,
};

export interface AccountResearchInsightsData {
  name: string;
  icpScore: number | null;
  timingScore: number | null;
  hardExcluded: boolean;
  icpObservations?: Array<{
    dimensionKey: string;
    observedValue?: string;
    evidence: string[];
    effectiveMatch?: number;
    classification?: string;
    hardExclusion?: boolean;
  }>;
  timingSignals?: Array<{
    dimensionKey: string;
    signals: Array<{ signal: string; date: string; evidence: string[] }>;
    signalCount: number;
  }>;
}

function formatDimensionKey(key: string): string {
  return key.replaceAll("_", " ");
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function EvidenceLinks({ urls }: { urls: string[] }) {
  const unique = [...new Set(urls.map((url) => safeExternalUrl(url)).filter((url): url is string => Boolean(url)))].slice(0, 4);
  if (unique.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
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

function ScoreBadge({ label, score, band }: { label: string; score: number | null; band: ScoreBand }) {
  return (
    <Badge variant={band.variant}>
      {label} {score == null ? "—" : Math.round(score)} · {band.label}
    </Badge>
  );
}

function FitInsight({
  dimensionKey,
  observedValue,
  evidence,
  effectiveMatch,
  classification,
  hardExclusion,
}: {
  dimensionKey: string;
  observedValue?: string;
  evidence: string[];
  effectiveMatch?: number;
  classification?: string;
  hardExclusion?: boolean;
}) {
  const insufficientEvidence = classification === "insufficient_evidence";
  const percent = effectiveMatch == null || insufficientEvidence ? null : Math.round(effectiveMatch * 100);
  return (
    <div className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium capitalize">
          {formatDimensionKey(dimensionKey)}
          {hardExclusion ? <AlertTriangle className="ml-1 inline size-3.5 text-destructive" /> : null}
        </span>
        {insufficientEvidence
          ? <Badge variant="outline">Insufficient evidence</Badge>
          : percent == null
            ? null
            : <span className="text-xs font-medium tabular-nums">{percent}%</span>}
      </div>
      {observedValue ? <p className="text-sm leading-6 text-muted-foreground">{observedValue}</p> : null}
      <EvidenceLinks urls={evidence} />
      {effectiveMatch == null || insufficientEvidence ? null : (
        <div className="flex items-center gap-3">
          <SegmentMeter excluded={hardExclusion} fraction={effectiveMatch} />
          <span className="text-[11px] text-muted-foreground">Match strength</span>
        </div>
      )}
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

export function AccountResearchInsights({
  account,
  accountLoading,
  companyName,
  execution = EMPTY_RESEARCH_EXECUTION,
  researchAvailable = true,
  needsResolution = false,
  onResearch,
}: {
  account: AccountResearchInsightsData | null;
  accountLoading: boolean;
  companyName?: string;
  execution?: ResearchExecutionView;
  researchAvailable?: boolean;
  needsResolution?: boolean;
  onResearch: () => void;
}) {
  const hasResearch = Boolean(account?.icpScore != null)
    || account?.timingScore != null
    || Boolean(account?.icpObservations?.length)
    || Boolean(account?.timingSignals?.length);
  const observations = account?.icpObservations ?? [];
  const timingSignals = account?.timingSignals ?? [];
  const hasActivity = Boolean(execution.telemetry?.activities.some((activity) => activity.scope === "account"));
  const showActivity = hasActivity || Boolean(execution.error) || execution.isRunning;
  const researchComplete = Boolean(execution.telemetry?.activities.some((activity) => (
    activity.scope === "account" && activity.type === "scope_completed"
  )));
  const isRunning = execution.isRunning && !researchComplete;
  const state = execution.error
    ? "failed"
    : isRunning
      ? "researching"
      : hasActivity || hasResearch
        ? "complete"
        : "empty";

  return (
    <section
      aria-busy={isRunning}
      aria-labelledby="company-insights-title"
      className={cn(
        "rounded-xl border p-4 transition-colors",
        isRunning && "border-primary/35 bg-primary/[0.02]",
        execution.error && "border-destructive/35 bg-destructive/[0.02]",
      )}
      data-research-state={state}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Account</p>
            <h3 className="truncate text-sm font-semibold" id="company-insights-title">
              {account?.name ?? companyName ?? "Company insights"}
            </h3>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ScoreBadge
            band={icpBand(account?.icpScore ?? null, Boolean(account?.hardExcluded))}
            label="ICP"
            score={account?.icpScore ?? null}
          />
          <ScoreBadge
            band={timingBand(account?.timingScore ?? null)}
            label="Timing"
            score={account?.timingScore ?? null}
          />
          <Button
            disabled={accountLoading || !researchAvailable || isRunning}
            onClick={onResearch}
            size="sm"
            title={researchAvailable ? undefined : "Add a company before researching the account"}
            variant="secondary"
          >
            <Search className="size-4" />
            {isRunning
              ? "Researching…"
              : needsResolution
                ? "Resolve & research account"
                : hasResearch
                  ? "Re-research account"
                  : "Research account"}
          </Button>
        </div>
      </div>

      {showActivity ? (
        <ResearchBoxActivity
          completedAt={execution.completedAt}
          dimensions={execution.dimensions}
          error={execution.error}
          isRetrying={execution.isRetrying}
          isRunning={isRunning}
          onRetry={execution.onRetry}
          progress={execution.progress}
          scope="account"
          startedAt={execution.startedAt}
          telemetry={execution.telemetry}
        />
      ) : null}

      {isRunning ? null : accountLoading ? (
        <SectionSkeleton />
      ) : account && (observations.length > 0 || timingSignals.length > 0) ? (
        <div className="space-y-4">
          {observations.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">ICP findings</p>
              {observations.map((observation) => (
                <FitInsight
                  classification={observation.classification}
                  dimensionKey={observation.dimensionKey}
                  effectiveMatch={observation.effectiveMatch}
                  evidence={observation.evidence}
                  hardExclusion={observation.hardExclusion}
                  key={observation.dimensionKey}
                  observedValue={observation.observedValue}
                />
              ))}
            </div>
          ) : null}

          {timingSignals.length > 0 ? (
            <div className="space-y-3 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground">Buying signals</p>
              {timingSignals.map((entry) => (
                <div className="space-y-2" key={entry.dimensionKey}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium capitalize">{formatDimensionKey(entry.dimensionKey)}</span>
                    {entry.signalCount === 0
                      ? <Badge variant="outline">Insufficient evidence</Badge>
                      : (
                          <span className="text-xs text-muted-foreground">
                            {entry.signalCount} {entry.signalCount === 1 ? "signal" : "signals"}
                          </span>
                        )}
                  </div>
                  {entry.signals.slice(0, 3).map((signal, index) => (
                    <div className="flex items-baseline justify-between gap-3 text-sm" key={`${signal.signal}-${index}`}>
                      <span className="text-muted-foreground">{signal.signal}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{signal.date}</span>
                    </div>
                  ))}
                  <EvidenceLinks urls={entry.signals.flatMap((signal) => signal.evidence)} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : showActivity ? null : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {companyName
            ? "No company research yet."
            : "Add a company to include ICP and timing insight."}
        </p>
      )}
    </section>
  );
}
