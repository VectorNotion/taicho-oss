"use client";

import {
  AlertTriangle,
  ExternalLink,
  Search,
  User,
} from "lucide-react";
import { ListCard } from "@/components/ListCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentMeter } from "@/components/genui";
import { cn } from "@/lib/utils";
import { personaBand, type ScoreBand } from "@/lib/score-bands";
import type { CompanySummary } from "./CompanySummaryBar";
import {
  AccountResearchInsights,
  EMPTY_RESEARCH_EXECUTION,
  type ResearchExecutionView,
} from "./AccountResearchInsights";
import { ResearchBoxActivity } from "../research/ResearchBoxActivity";
import { safeExternalUrl } from "../../safe-external-url";

export type { ResearchExecutionView } from "./AccountResearchInsights";

export interface PersonaInsightDimension {
  dimensionKey: string;
  observedValue?: string;
  evidence: string[];
  confidence: number;
  matchScore?: number;
  effectiveMatch?: number;
  classification?: string;
  hardExclusion?: boolean;
}

export interface PersonaInsights {
  dimensions: PersonaInsightDimension[];
  personaScore: number | null;
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

export function ProspectResearchInsights({
  persona,
  personaLoading,
  account,
  accountLoading,
  companyName,
  prospectExecution = EMPTY_RESEARCH_EXECUTION,
  accountExecution = EMPTY_RESEARCH_EXECUTION,
  accountResearchAvailable = true,
  accountNeedsResolution = false,
  onResearchProspect,
  onResearchAccount,
}: {
  persona: PersonaInsights | null;
  personaLoading: boolean;
  account: CompanySummary | null;
  accountLoading: boolean;
  companyName?: string;
  prospectExecution?: ResearchExecutionView;
  accountExecution?: ResearchExecutionView;
  accountResearchAvailable?: boolean;
  accountNeedsResolution?: boolean;
  onResearchProspect: () => void;
  onResearchAccount: () => void;
}) {
  const hasPersonResearch = Boolean(persona?.dimensions.length);
  const personaExcluded = Boolean(persona?.dimensions.some((dimension) => dimension.hardExclusion));
  const hasPersonActivity = Boolean(prospectExecution.telemetry?.activities.some((activity) => activity.scope === "person"));
  const showPersonActivity = hasPersonActivity || Boolean(prospectExecution.error) || prospectExecution.isRunning;
  const personResearchComplete = Boolean(prospectExecution.telemetry?.activities.some((activity) => (
    activity.scope === "person" && activity.type === "scope_completed"
  )));
  const personBoxRunning = prospectExecution.isRunning && !personResearchComplete;
  const personBoxState = prospectExecution.error
    ? "failed"
    : personBoxRunning
      ? "researching"
      : hasPersonActivity || hasPersonResearch
        ? "complete"
        : "empty";

  return (
    <ListCard
      description="What research found about this person and their company, with evidence behind each score."
      title="Research insights"
    >
      <div className="grid gap-4 p-6 lg:grid-cols-2">
        <section
          aria-busy={personBoxRunning}
          aria-labelledby="person-insights-title"
          className={cn(
            "rounded-xl border p-4 transition-colors",
            personBoxRunning && "border-primary/35 bg-primary/[0.02]",
            prospectExecution.error && "border-destructive/35 bg-destructive/[0.02]",
          )}
          data-research-state={personBoxState}
        >
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                <User className="size-4" />
              </span>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Prospect</p>
                <h3 className="text-sm font-semibold" id="person-insights-title">Persona insights</h3>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <ScoreBadge
                band={personaBand(persona?.personaScore ?? null, personaExcluded)}
                label="Persona"
                score={persona?.personaScore ?? null}
              />
              <Button
                disabled={personaLoading || personBoxRunning}
                onClick={onResearchProspect}
                size="sm"
                variant="secondary"
              >
                <Search className="size-4" />
                {personBoxRunning ? "Researching…" : hasPersonResearch ? "Re-research prospect" : "Research prospect"}
              </Button>
            </div>
          </div>

          {showPersonActivity ? (
            <ResearchBoxActivity
              completedAt={prospectExecution.completedAt}
              dimensions={prospectExecution.dimensions}
              error={prospectExecution.error}
              isRetrying={prospectExecution.isRetrying}
              isRunning={personBoxRunning}
              onRetry={prospectExecution.onRetry}
              progress={prospectExecution.progress}
              scope="person"
              startedAt={prospectExecution.startedAt}
              telemetry={prospectExecution.telemetry}
            />
          ) : null}

          {personBoxRunning ? null : personaLoading ? (
            <SectionSkeleton />
          ) : (
            <>
              {persona && persona.dimensions.length > 0 ? (
                <div className="space-y-3">
                  {persona.dimensions.map((dimension) => (
                      <FitInsight
                        classification={dimension.classification}
                        dimensionKey={dimension.dimensionKey}
                      effectiveMatch={dimension.effectiveMatch}
                      evidence={dimension.evidence}
                      hardExclusion={dimension.hardExclusion}
                      key={dimension.dimensionKey}
                      observedValue={dimension.observedValue}
                    />
                  ))}
                </div>
              ) : showPersonActivity ? null : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No person research yet.
                </p>
              )}
            </>
          )}
        </section>

        <AccountResearchInsights
          account={account}
          accountLoading={accountLoading}
          companyName={companyName}
          execution={accountExecution}
          needsResolution={accountNeedsResolution}
          onResearch={onResearchAccount}
          researchAvailable={accountResearchAvailable}
        />
      </div>
    </ListCard>
  );
}
