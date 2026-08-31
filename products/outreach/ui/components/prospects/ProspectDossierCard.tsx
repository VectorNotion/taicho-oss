"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  RefreshCw,
  Target,
} from "lucide-react";
import { ListCard } from "@/components/ListCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreTile } from "@/components/genui";
import { icpBand, personaBand, timingBand } from "@/lib/score-bands";
import type {
  ProspectDossier,
  ResearchFreshness,
} from "@/products/outreach/domain/prospect-dossier";
import type { QualificationStatus } from "@/products/outreach/domain/qualification";

const STATUS_CONFIG: Record<QualificationStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  QUALIFIED: { label: "Qualified", variant: "default" },
  UNQUALIFIED: { label: "Unqualified", variant: "secondary" },
  REVIEW: { label: "Needs review", variant: "outline" },
  HARD_EXCLUDED: { label: "Hard excluded", variant: "destructive" },
  CONTACT_DISCOVERY_REQUIRED: { label: "Find another person", variant: "outline" },
};

const FRESHNESS_LABEL: Record<ResearchFreshness["status"], string> = {
  fresh: "Fresh",
  stale: "Stale",
  partial: "Partial",
  missing: "Missing",
};

function FreshnessBadge({ label, research }: { label: string; research: ResearchFreshness }) {
  const details = [
    `${research.researchedDimensionCount}/${research.configuredDimensionCount} criteria researched`,
    research.staleDimensionKeys.length > 0 ? `${research.staleDimensionKeys.length} stale` : null,
    research.missingDimensionKeys.length > 0 ? `${research.missingDimensionKeys.length} missing` : null,
  ].filter(Boolean).join(", ");
  return (
    <Badge
      aria-label={`${label} research: ${FRESHNESS_LABEL[research.status]}; ${details}`}
      title={details}
      variant={research.status === "fresh" ? "secondary" : "outline"}
    >
      {research.status === "fresh" ? <CheckCircle2 className="size-3" /> : <CalendarClock className="size-3" />}
      {label}: {FRESHNESS_LABEL[research.status]}
    </Badge>
  );
}

function DossierSkeleton() {
  return (
    <div className="space-y-5 p-6">
      <div className="flex gap-2"><Skeleton className="h-5 w-24" /><Skeleton className="h-5 w-28" /></div>
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" />
      </div>
      <Skeleton className="h-16" />
    </div>
  );
}

export function ProspectDossierCard({
  dossier,
  isLoading,
  isRequalifying,
  onRequalify,
  onRetryQualification,
  qualificationError,
  qualificationOperation,
  qualificationProgress,
  qualificationRetrying,
}: {
  dossier: ProspectDossier | null;
  isLoading: boolean;
  isRequalifying: boolean;
  onRequalify: () => void;
  onRetryQualification: () => void;
  qualificationError: string | null;
  qualificationOperation: {
    id: string;
    status: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
    progress: number;
    attempt: number;
    maxAttempts: number;
  } | null;
  qualificationProgress: {
    label?: string;
    phase?: string;
  } | null;
  qualificationRetrying: boolean;
}) {
  const operationFailed = qualificationOperation?.status === "failed";
  const actions = (
    <Button disabled={isRequalifying || operationFailed} onClick={onRequalify} size="sm" variant="outline">
      {isRequalifying ? <RefreshCw className="size-4 animate-spin" /> : <Target className="size-4" />}
      {isRequalifying ? "Scoring…" : "Re-score"}
    </Button>
  );

  return (
    <ListCard
      actions={actions}
      description="One decision snapshot for person fit, company fit, buying timing, exclusions, and research freshness."
      title="Sales intelligence dossier"
    >
      {qualificationOperation ? (
        <div
          aria-live="polite"
          className={`mx-6 mt-6 space-y-3 rounded-xl border p-4 ${operationFailed ? "border-destructive/40 bg-destructive/5" : "bg-muted/15"}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {operationFailed ? (
                <AlertTriangle className="size-4 text-destructive" />
              ) : qualificationOperation.status === "succeeded" ? (
                <CheckCircle2 className="size-4 text-chart-2" />
              ) : (
                <RefreshCw className="size-4 animate-spin text-muted-foreground" />
              )}
              <div>
                <p className="text-sm font-medium">
                  {operationFailed
                    ? "Scoring needs attention"
                    : qualificationOperation.status === "succeeded"
                      ? "Scoring complete"
                      : qualificationProgress?.label ?? "Scoring current research"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Operation {qualificationOperation.id} · attempt {qualificationOperation.attempt} of {qualificationOperation.maxAttempts}
                </p>
              </div>
            </div>
            {operationFailed ? (
              <Button disabled={qualificationRetrying} onClick={onRetryQualification} size="sm" variant="outline">
                <RefreshCw className={`size-4 ${qualificationRetrying ? "animate-spin" : ""}`} />
                {qualificationRetrying ? "Retrying…" : "Retry same operation"}
              </Button>
            ) : null}
          </div>
          <div
            aria-label="Qualification progress"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={qualificationOperation.progress}
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
          >
            <div
              className={`h-full rounded-full transition-[width] ${operationFailed ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${qualificationOperation.progress}%` }}
            />
          </div>
          {qualificationError ? <p className="text-sm text-destructive">{qualificationError}</p> : null}
        </div>
      ) : null}
      {isLoading || !dossier ? <DossierSkeleton /> : (
        <div className="space-y-5 p-6">
          <div className="flex flex-wrap items-center gap-2">
            {dossier.qualification.status ? (
              <Badge variant={STATUS_CONFIG[dossier.qualification.status].variant}>
                {STATUS_CONFIG[dossier.qualification.status].label}
              </Badge>
            ) : <Badge variant="outline">Not assessed</Badge>}
            <FreshnessBadge label="Person" research={dossier.person.research} />
            {dossier.account ? <FreshnessBadge label="Account" research={dossier.account.research} /> : (
              <Badge variant="outline"><Building2 className="size-3" />Account unresolved</Badge>
            )}
            {dossier.qualification.isStale ? (
              <Badge variant="outline"><AlertTriangle className="size-3 text-chart-1" />Decision needs refresh</Badge>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <ScoreTile
              band={personaBand(dossier.person.personaScore, dossier.person.hardExcluded)}
              explanation="Whether this person matches the target persona; this score gates qualification."
              label="Is this person worth pursuing?"
              score={dossier.person.personaScore}
            />
            <ScoreTile
              band={icpBand(dossier.account?.icpScore ?? null, dossier.account?.hardExcluded ?? false)}
              explanation="Whether the company matches the ideal-customer profile; this score gates qualification."
              label="Is this company worth pursuing?"
              score={dossier.account?.icpScore ?? null}
            />
            <ScoreTile
              band={timingBand(dossier.account?.timingScore ?? null)}
              explanation="How active the buying window is; timing prioritizes work but never changes the gate."
              label="Is now a good time?"
              score={dossier.account?.timingScore ?? null}
            />
          </div>

          <div className="grid gap-4 rounded-xl border bg-muted/15 p-4 lg:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <p className="text-sm leading-6 text-muted-foreground">{dossier.qualification.explanation}</p>
              <p className="text-sm font-medium">Next: {dossier.qualification.recommendedAction}</p>
              <p className="text-xs text-muted-foreground">
                Gates: ICP ≥ {dossier.qualification.thresholds.icpMinimum}, persona ≥ {dossier.qualification.thresholds.personaMinimum}; low-confidence cutoff {Math.round(dossier.qualification.thresholds.lowConfidenceCutoff * 100)}%.
              </p>
            </div>
            {dossier.account ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/outreach/accounts/${dossier.account.id}?fromProspect=${dossier.prospect.id}`}>
                  <Building2 className="size-4" />View {dossier.account.name}
                </Link>
              </Button>
            ) : null}
          </div>

          {(dossier.person.hardExcluded || dossier.account?.hardExcluded) ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mr-2 inline size-4" />
              Hard exclusion matched in {[
                dossier.person.hardExcluded ? "person research" : null,
                dossier.account?.hardExcluded ? "account research" : null,
              ].filter(Boolean).join(" and ")}.
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Snapshot {new Date(dossier.snapshotAt).toLocaleString()}
            {dossier.qualification.computedAt ? ` · Decision computed ${new Date(dossier.qualification.computedAt).toLocaleString()}` : ""}
          </p>
        </div>
      )}
    </ListCard>
  );
}
