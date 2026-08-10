"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ReasoningTicker, ScoreRing } from "@/components/genui";
import { Target, Calendar, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
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
  const percent = Math.round(match.effectiveMatch * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="capitalize text-muted-foreground">
          {formatDimensionKey(match.dimensionKey)}
          {match.hardExclusion && (
            <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" />
          )}
        </span>
        <span className="font-medium">{percent}</span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all duration-500 ${match.hardExclusion ? "bg-destructive" : "bg-chart-2"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
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
                <div key={entry.dimensionKey} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="capitalize text-muted-foreground">
                      {formatDimensionKey(entry.dimensionKey)}
                    </span>
                    <span className="font-medium">
                      {entry.signalCount} signal{entry.signalCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-chart-1 transition-all duration-500"
                      style={{ width: `${Math.round(entry.dimensionValue * 100)}%` }}
                    />
                  </div>
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
  const header = (
    <CardHeader className="flex-row items-center justify-between">
      <CardTitle className="flex items-center gap-2">
        <Target className="h-4 w-4" />
        Fit assessment
      </CardTitle>
      {onRequalify && (
        <Button size="sm" variant="ghost" disabled={live?.isStreaming} onClick={onRequalify}>
          {qualification || legacy ? "Re-score" : "Score fit"}
        </Button>
      )}
    </CardHeader>
  );

  if (isLoading) {
    return (
      <Card>
        {header}
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const streaming = live?.isStreaming ? (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <ReasoningTicker text={live.reasoning} active />
      <p className="text-xs text-muted-foreground">Researching and scoring dimensions…</p>
    </div>
  ) : null;

  if (!qualification) {
    return (
      <Card>
        {header}
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>
    );
  }

  const status = STATUS_CONFIG[qualification.status];

  return (
    <Card>
      {header}
      <CardContent className="space-y-4">
        {streaming}

        <Badge variant="outline" className={status.className}>
          {status.label}
        </Badge>

        <div className="grid grid-cols-3 gap-2">
          <ScoreRing score={Math.round(qualification.icpScore)} label="ICP" />
          <ScoreRing score={Math.round(qualification.personaScore)} label="Persona" />
          <ScoreRing score={Math.round(qualification.timingScore)} label="Timing" />
        </div>
        <p className="text-center text-xs text-muted-foreground">Fit gates. Timing ranks.</p>

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
      </CardContent>
    </Card>
  );
}
