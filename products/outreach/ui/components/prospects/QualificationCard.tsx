"use client";

import { useState, type ReactNode } from "react";
import { ListCard } from "@/components/ListCard";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ReasoningTicker, ScoreTile, SegmentMeter } from "@/components/genui";
import { Target, Calendar, ChevronDown, ChevronRight, AlertTriangle, RefreshCw } from "lucide-react";
import { icpBand, personaBand, timingBand } from "@/lib/score-bands";
import type { LegacyQualification } from "@/products/outreach/domain/types";
import type {
  DimensionMatch,
  ProspectQualificationResult,
  QualificationStatus,
} from "@/products/outreach/domain/qualification";

interface QualificationCardProps {
  qualification: ProspectQualificationResult | null;
  /** Flat pre-dimension score, rendered when no new qualification exists yet. */
  legacy?: LegacyQualification | null;
  isLoading?: boolean;
  onRequalify?: () => void;
  live?: { reasoning: string; isStreaming: boolean };
}

const STATUS_CONFIG: Record<QualificationStatus, { label: string; className: string }> = {
  QUALIFIED: { label: "Qualified", className: "text-chart-2 border-chart-2/40" },
  UNQUALIFIED: { label: "Unqualified", className: "text-muted-foreground" },
  REVIEW: { label: "Needs review", className: "text-chart-1 border-chart-1/40" },
  HARD_EXCLUDED: { label: "Hard excluded", className: "text-destructive border-destructive/40" },
  CONTACT_DISCOVERY_REQUIRED: {
    label: "Find another contact",
    className: "text-chart-6 border-chart-6/40",
  },
};

function formatDimensionKey(key: string): string {
  return key.replaceAll("_", " ");
}

function MatchRow({ match }: { match: DimensionMatch }) {
  const insufficientEvidence = match.classification === "insufficient_evidence";
  const percent = Math.round(match.effectiveMatch * 100);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 flex-1 truncate text-xs capitalize text-muted-foreground">
        {formatDimensionKey(match.dimensionKey)}
        {match.hardExclusion && (
          <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" />
        )}
      </span>
      {insufficientEvidence
        ? <Badge variant="outline">Insufficient evidence</Badge>
        : (
            <>
              <SegmentMeter excluded={match.hardExclusion} fraction={match.effectiveMatch} />
              <span className="w-6 text-right text-xs font-semibold tabular-nums">{percent}</span>
            </>
          )}
    </div>
  );
}

function DimensionBreakdown({ qualification }: { qualification: ProspectQualificationResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t pt-3">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Dimension breakdown
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          {qualification.icpMatches.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium">Company fit</p>
              {qualification.icpMatches.map((match) => (
                <MatchRow key={match.dimensionKey} match={match} />
              ))}
            </div>
          )}
          {qualification.personaMatches.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium">Persona fit</p>
              {qualification.personaMatches.map((match) => (
                <MatchRow key={match.dimensionKey} match={match} />
              ))}
            </div>
          )}
          {qualification.timingBreakdown.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium">Timing signals</p>
              {qualification.timingBreakdown.map((entry) => (
                <div key={entry.dimensionKey} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-xs capitalize text-muted-foreground">
                    {formatDimensionKey(entry.dimensionKey)}
                  </span>
                  {entry.signalCount === 0
                    ? <Badge variant="outline">Insufficient evidence</Badge>
                    : (
                        <>
                          <SegmentMeter fraction={entry.dimensionValue} />
                          <span className="w-16 text-right text-xs font-medium tabular-nums text-muted-foreground">
                            {entry.signalCount} signal{entry.signalCount === 1 ? "" : "s"}
                          </span>
                        </>
                      )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LegacyBody({ legacy }: { legacy: LegacyQualification }) {
  const scoreClass =
    legacy.score >= 80 ? "text-chart-2" : legacy.score >= 50 ? "text-muted-foreground" : "text-destructive";
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{legacy.matchedPersonaName}</span>
        <span className={`text-sm font-bold ${scoreClass}`}>{legacy.score}/100</span>
      </div>
      <p className="text-sm italic text-muted-foreground">&quot;{legacy.notes}&quot;</p>
      <p className="text-xs text-muted-foreground">
        Pre-dimension score — re-score for the full ICP / persona / timing assessment.
      </p>
    </div>
  );
}

export function QualificationCard({
  qualification,
  legacy = null,
  isLoading = false,
  onRequalify,
  live,
}: QualificationCardProps) {
  const actions = onRequalify ? (
    <Button disabled={live?.isStreaming} onClick={onRequalify} size="sm" variant="secondary">
      <RefreshCw className={`h-4 w-4 ${live?.isStreaming ? "animate-spin" : ""}`} />
      {qualification || legacy ? "Re-score" : "Score fit"}
    </Button>
  ) : null;

  const shell = (children: ReactNode) => (
    <ListCard
      actions={actions}
      description="The current qualification decision from company fit, person fit, and buying-window timing."
      title="Qualification"
    >
      <div className="space-y-4 p-6">{children}</div>
    </ListCard>
  );

  if (isLoading) {
    return shell(
      <div className="space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-3 w-1/2" />
      </div>,
    );
  }

  const streaming = live?.isStreaming ? (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <ReasoningTicker text={live.reasoning} active />
      <p className="text-xs text-muted-foreground">Researching and scoring dimensions…</p>
    </div>
  ) : null;

  if (!qualification) {
    return shell(
      <>
        {streaming}
        {legacy ? (
          <LegacyBody legacy={legacy} />
        ) : (
          !live?.isStreaming && (
            <div className="py-4 text-center text-muted-foreground">
              <Target className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p className="text-sm">Not assessed yet</p>
              <p className="mt-1 text-xs">
                Run research to score this account and person against your ICP
              </p>
            </div>
          )
        )}
      </>,
    );
  }

  const status = STATUS_CONFIG[qualification.status];
  const icpExcluded = qualification.icpMatches.some((match) => match.hardExclusion);
  const personaExcluded = qualification.personaMatches.some((match) => match.hardExclusion);

  return shell(
    <>
      {streaming}

      <Badge variant="outline" className={status.className}>
        {status.label}
      </Badge>

      <div className="space-y-3">
          <ScoreTile
            band={icpBand(qualification.icpScore, icpExcluded)}
            explanation="How well the company matches your ideal-customer profile. Fit gates."
            label="ICP fit"
            score={qualification.icpScore}
          />
          <ScoreTile
            band={personaBand(qualification.personaScore, personaExcluded)}
            explanation="How well this person matches your target persona."
            label="Persona fit"
            score={qualification.personaScore}
          />
          <ScoreTile
            band={timingBand(qualification.timingScore)}
            explanation="How active the company's buying-window signals are right now. Timing ranks."
            label="Timing"
            score={qualification.timingScore}
          />
        </div>

        {qualification.reviewReason && (
          <p className="rounded-md border border-chart-1/40 bg-muted/20 p-2 text-xs text-muted-foreground">
            {qualification.reviewReason}
          </p>
        )}

        <DimensionBreakdown qualification={qualification} />

      <div className="flex items-center gap-1 border-t pt-2 text-xs text-muted-foreground">
        <Calendar className="h-3 w-3" />
        <span>Assessed {new Date(qualification.computedAt).toLocaleDateString()}</span>
      </div>
    </>,
  );
}
