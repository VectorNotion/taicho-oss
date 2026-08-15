"use client";

import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
  User,
} from "lucide-react";
import { LiveDot } from "@/components/LiveDot";
import { ListCard } from "@/components/ListCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentMeter } from "@/components/genui";
import { icpBand, personaBand, timingBand, type ScoreBand } from "@/lib/score-bands";
import type { CompanySummary } from "./CompanySummaryBar";
import type { DimensionLane } from "../research/useDimensionResearch";

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
  const unique = [...new Set(urls)].filter(Boolean).slice(0, 4);
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
  hardExclusion,
}: {
  dimensionKey: string;
  observedValue?: string;
  evidence: string[];
  effectiveMatch?: number;
  hardExclusion?: boolean;
}) {
  const percent = effectiveMatch == null ? null : Math.round(effectiveMatch * 100);
  return (
    <div className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium capitalize">
          {formatDimensionKey(dimensionKey)}
          {hardExclusion ? <AlertTriangle className="ml-1 inline size-3.5 text-destructive" /> : null}
        </span>
        {percent == null ? null : <span className="text-xs font-medium tabular-nums">{percent}%</span>}
      </div>
      {observedValue ? <p className="text-sm leading-6 text-muted-foreground">{observedValue}</p> : null}
      <EvidenceLinks urls={evidence} />
      {effectiveMatch == null ? null : (
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

function ResearchLoader({
  dimensions,
  label,
}: {
  dimensions: DimensionLane[];
  label: "person" | "account";
}) {
  const scored = dimensions.filter((dimension) => dimension.phase === "matched").length;

  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4" role="status">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/5 px-3 py-2.5 text-sm">
        <LiveDot className="font-medium text-primary" label={`Researching ${label}`} />
        {dimensions.length > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {scored}/{dimensions.length} criteria scored
          </span>
        ) : null}
      </div>

      {dimensions.length === 0 ? (
        <div className="space-y-3" aria-label={`Preparing ${label} research criteria`}>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      ) : (
        <ul className="divide-y">
          {dimensions.map((dimension) => {
            const state = dimension.phase === "matched"
              ? "Scored"
              : dimension.phase === "found"
                ? "Scoring evidence"
                : "Searching sources";
            const Icon = dimension.phase === "matched"
              ? CheckCircle2
              : dimension.phase === "found"
                ? Sparkles
                : Search;
            return (
              <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" key={dimension.dimensionKey}>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium capitalize">
                    {formatDimensionKey(dimension.name || dimension.dimensionKey)}
                  </p>
                  <p className="text-xs text-muted-foreground">{state}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ResearchError({ message }: { message: string }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function ProspectResearchInsights({
  persona,
  personaLoading,
  account,
  accountLoading,
  companyName,
  personResearchDimensions = [],
  accountResearchDimensions = [],
  isResearchingPerson = false,
  isResearchingAccount = false,
  personResearchError,
  accountResearchError,
  accountResearchAvailable = true,
  accountNeedsResolution = false,
  onResearchPerson,
  onResearchAccount,
}: {
  persona: PersonaInsights | null;
  personaLoading: boolean;
  account: CompanySummary | null;
  accountLoading: boolean;
  companyName?: string;
  personResearchDimensions?: DimensionLane[];
  accountResearchDimensions?: DimensionLane[];
  isResearchingPerson?: boolean;
  isResearchingAccount?: boolean;
  personResearchError?: string | null;
  accountResearchError?: string | null;
  accountResearchAvailable?: boolean;
  accountNeedsResolution?: boolean;
  onResearchPerson: () => void;
  onResearchAccount: () => void;
}) {
  const hasPersonResearch = Boolean(persona?.dimensions.length);
  const hasAccountResearch = Boolean(account?.icpScore != null)
    || account?.timingScore != null
    || Boolean(account?.icpObservations?.length)
    || Boolean(account?.timingSignals?.length);
  const personaExcluded = Boolean(persona?.dimensions.some((dimension) => dimension.hardExclusion));
  const icpObservations = account?.icpObservations ?? [];
  const timingSignals = account?.timingSignals ?? [];

  return (
    <ListCard
      description="What research found about this person and their company, with evidence behind each score."
      title="Research insights"
    >
      <div className="grid gap-4 p-6 lg:grid-cols-2">
        <section className="rounded-xl border p-4" aria-labelledby="person-insights-title">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                <User className="size-4" />
              </span>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Person</p>
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
                disabled={personaLoading || isResearchingPerson}
                onClick={onResearchPerson}
                size="sm"
                variant="secondary"
              >
                {isResearchingPerson ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                {isResearchingPerson ? "Researching…" : hasPersonResearch ? "Re-research person" : "Research person"}
              </Button>
            </div>
          </div>

          {isResearchingPerson ? (
            <ResearchLoader dimensions={personResearchDimensions} label="person" />
          ) : personaLoading ? (
            <SectionSkeleton />
          ) : (
            <>
              {personResearchError ? <ResearchError message={personResearchError} /> : null}
              {persona && persona.dimensions.length > 0 ? (
                <div className="space-y-3">
                  {persona.dimensions.map((dimension) => (
                    <FitInsight
                      dimensionKey={dimension.dimensionKey}
                      effectiveMatch={dimension.effectiveMatch}
                      evidence={dimension.evidence}
                      hardExclusion={dimension.hardExclusion}
                      key={dimension.dimensionKey}
                      observedValue={dimension.observedValue}
                    />
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No person research yet.
                </p>
              )}
            </>
          )}
        </section>

        <section className="rounded-xl border p-4" aria-labelledby="company-insights-title">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Company</p>
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
                disabled={accountLoading || !accountResearchAvailable || isResearchingAccount}
                onClick={onResearchAccount}
                size="sm"
                title={accountResearchAvailable ? undefined : "Add a company before researching the account"}
                variant="secondary"
              >
                {isResearchingAccount ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                {isResearchingAccount
                  ? "Researching…"
                  : accountNeedsResolution
                    ? "Resolve & research account"
                    : hasAccountResearch
                      ? "Re-research account"
                      : "Research account"}
              </Button>
            </div>
          </div>

          {isResearchingAccount ? (
            <ResearchLoader dimensions={accountResearchDimensions} label="account" />
          ) : accountLoading ? (
            <SectionSkeleton />
          ) : (
            <>
              {accountResearchError ? <ResearchError message={accountResearchError} /> : null}
              {account && (icpObservations.length > 0 || timingSignals.length > 0) ? (
                <div className="space-y-4">
                  {icpObservations.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">ICP findings</p>
                      {icpObservations.map((observation) => (
                        <FitInsight
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
                            <span className="text-xs text-muted-foreground">
                              {entry.signalCount} {entry.signalCount === 1 ? "signal" : "signals"}
                            </span>
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
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {companyName ? "No company research yet." : "Add a company to include ICP and timing insight."}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </ListCard>
  );
}
