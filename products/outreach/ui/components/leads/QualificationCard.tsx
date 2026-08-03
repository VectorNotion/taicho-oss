"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ReasoningTicker, ScoreRing, StreamingText } from "@/components/genui";
import { Target, Calendar } from "lucide-react";
import type { LeadQualification } from "@/products/outreach/domain/types";

interface QualificationCardProps {
  qualification: LeadQualification | null;
  isLoading?: boolean;
  onRequalify?: () => void;
  live?: { score: number | null; notes: string; reasoning: string; isStreaming: boolean };
}

function getScoreColor(score: number): string {
  if (score >= 80) return "text-chart-2";
  if (score >= 50) return "text-muted-foreground";
  return "text-destructive";
}

function getScoreLabel(score: number): string {
  if (score >= 80) return "High match";
  if (score >= 50) return "Medium match";
  return "Low match";
}

function getProgressColor(score: number): string {
  if (score >= 80) return "bg-chart-2";
  if (score >= 50) return "bg-muted-foreground";
  return "bg-destructive";
}

export function QualificationCard({
  qualification,
  isLoading = false,
  onRequalify,
  live,
}: QualificationCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Target className="h-4 w-4" />Fit assessment</CardTitle>
        </CardHeader>
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

  if (!qualification) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Fit assessment
          </CardTitle>
          {onRequalify && <Button size="sm" variant="ghost" disabled={live?.isStreaming} onClick={onRequalify}>Score fit</Button>}
        </CardHeader>
        <CardContent>
          {live?.isStreaming ? (
            <div className="space-y-3">
              <ReasoningTicker text={live.reasoning} active />
              <ScoreRing score={live.score} label="scoring…" />
              {live.notes && <StreamingText text={live.notes} done={false} />}
            </div>
          ) : <div className="text-center py-4 text-muted-foreground">
            <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Not assessed yet</p>
            <p className="text-xs mt-1">
              Run research to automatically score this person against your personas
            </p>
          </div>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Target className="h-4 w-4" />
          Fit assessment
        </CardTitle>
        {onRequalify && <Button size="sm" variant="ghost" disabled={live?.isStreaming} onClick={onRequalify}>Re-score</Button>}
      </CardHeader>
      <CardContent className="space-y-4">
        {live?.isStreaming && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <ReasoningTicker text={live.reasoning} active />
            <ScoreRing score={live.score} label="scoring…" />
            {live.notes && <StreamingText text={live.notes} done={false} />}
          </div>
        )}
        {/* Persona Match */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium">
              {qualification.matchedPersonaName}
            </span>
            <Badge variant="outline" className={getScoreColor(qualification.score)}>
              {getScoreLabel(qualification.score)}
            </Badge>
          </div>
        </div>

        {/* Score Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Match score</span>
            <span className={`font-bold ${getScoreColor(qualification.score)}`}>
              {qualification.score}/100
            </span>
          </div>
          <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full ${getProgressColor(qualification.score)} transition-all duration-500`}
              style={{ width: `${qualification.score}%` }}
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <p className="text-sm text-muted-foreground italic">
            &quot;{qualification.notes}&quot;
          </p>
        </div>

        {/* Assessment date */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground pt-2 border-t">
          <Calendar className="h-3 w-3" />
          <span>
            Assessed {new Date(qualification.qualifiedAt).toLocaleDateString()}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
