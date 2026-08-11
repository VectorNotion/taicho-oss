"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Building2, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreRing } from "@/components/genui";
import { PageHeader } from "@/components/PageHeader";
import { AccountProspectsSection } from "@/components/prospects/AccountProspectsSection";
import { useDimensionResearch } from "@/products/outreach/ui/components/research/useDimensionResearch";
import { DimensionResearchSurface } from "@/products/outreach/ui/components/research/DimensionResearchSurface";

type DimensionMatch = {
  dimensionKey: string;
  matchScore: number;
  effectiveMatch: number;
  classification: string;
  hardExclusion: boolean;
  confidence: number;
};
type TimingBreakdown = { dimensionKey: string; dimensionValue: number; signalCount: number };
type AccountObservation = {
  dimensionKey: string;
  observedValue?: string;
  evidence: string[];
  confidence: number;
  matchScore?: number;
  effectiveMatch?: number;
  classification?: string;
  hardExclusion?: boolean;
};
type AccountTimingSignals = {
  dimensionKey: string;
  signals: Array<{ signal: string; date: string; evidence: string[]; confidence: number }>;
  dimensionValue?: number;
  signalCount: number;
};
type AccountProspect = {
  id: string;
  name: string;
  title?: string;
  status: string;
  personaScore: number | null;
  qualificationStatus: string | null;
  lastContactedAt?: string;
  nextAction?: { id: string; title: string; dueAt: string } | null;
};
type AccountDetail = {
  id: string;
  name: string;
  createdAt: string;
  icpScore: number | null;
  timingScore: number | null;
  hardExcluded: boolean;
  reviewReason?: string;
  computedAt?: string;
  icpMatches: DimensionMatch[];
  icpObservations: AccountObservation[];
  timingBreakdown: TimingBreakdown[];
  timingSignals: AccountTimingSignals[];
  prospects: AccountProspect[];
};

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
    <div className="flex flex-wrap gap-2">
      {unique.map((url) => (
        <a
          key={url}
          className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-primary"
          href={url}
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

function ObservationBlock({ observation }: { observation: AccountObservation }) {
  const percent = Math.round((observation.effectiveMatch ?? 0) * 100);
  const excluded = Boolean(observation.hardExclusion);
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium capitalize">{formatDimensionKey(observation.dimensionKey)}</span>
        {excluded && <AlertTriangle className="size-3.5 text-destructive" />}
      </div>
      {observation.observedValue ? (
        <p className="text-sm leading-6 text-muted-foreground">{observation.observedValue}</p>
      ) : (
        <p className="text-sm text-muted-foreground">No observation recorded.</p>
      )}
      <EvidenceLinks urls={observation.evidence} />
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Match</span>
          <span className="font-medium tabular-nums">{percent}%</span>
        </div>
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full transition-all duration-500 ${excluded ? "bg-destructive" : "bg-chart-2"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function TimingSignalBlock({ entry }: { entry: AccountTimingSignals }) {
  const percent = Math.round((entry.dimensionValue ?? 0) * 100);
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium capitalize">{formatDimensionKey(entry.dimensionKey)}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {entry.signalCount} {entry.signalCount === 1 ? "signal" : "signals"}
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-chart-1 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      {entry.signals.length > 0 && (
        <ul className="space-y-2 pt-1">
          {entry.signals.map((signal, index) => (
            <li key={index} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">{signal.signal}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{signal.date}</span>
              </div>
              <EvidenceLinks urls={signal.evidence} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountDetailSkeleton() {
  return (
    <div className="w-full min-w-0 space-y-8">
      <div>
        <Skeleton className="mb-4 h-5 w-28" />
        <Skeleton className="h-9 w-64" />
      </div>
      <Skeleton className="h-24" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

export default function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const research = useDimensionResearch(`/api/outreach/accounts/${id}/research/stream`);

  const loadAccount = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setLoading(true);
      try {
        const response = await fetch(`/api/outreach/accounts/${id}`);
        if (response.status === 404) {
          setNotFound(true);
          return;
        }
        if (!response.ok) throw new Error("Failed to fetch account");
        setAccount(await response.json());
      } catch (error) {
        console.error("Error fetching account:", error);
        toast.error("Could not load this account — refresh to try again.");
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  useEffect(() => {
    if (!research.final) return;
    if (account) toast.success(`Research complete for ${account.name}`);
    void loadAccount({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [research.final]);

  if (loading) return <AccountDetailSkeleton />;

  if (notFound || !account) {
    return (
      <div className="w-full min-w-0 space-y-8">
        <Link
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          href="/outreach/accounts"
        >
          <ArrowLeft className="size-4" /> All accounts
        </Link>
        <div className="grid justify-items-center gap-3 py-16 text-center">
          <Building2 className="size-9 text-muted-foreground" />
          <p className="font-medium">Account not found</p>
        </div>
      </div>
    );
  }

  const isTarget = account.icpScore != null && account.icpScore >= 70;
  const qualifiedCount = account.prospects.filter((p) => p.qualificationStatus === "QUALIFIED").length;
  const showResearchSurface = research.isStreaming || research.dimensions.length > 0;

  return (
    <div className="w-full min-w-0 space-y-8">
      <div>
        <Link
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          href="/outreach/accounts"
        >
          <ArrowLeft className="size-4" /> All accounts
        </Link>
        <PageHeader
          actions={
            <Button disabled={research.isStreaming} onClick={() => research.start()}>
              <Search className="size-4" /> Research account
            </Button>
          }
          description="Company fit and buying-window timing. Fit gates. Timing ranks."
          title={account.name}
        />
      </div>

      {/* Scores band — compact, full width, so it doesn't strand a whole column. */}
      <Card>
        <CardContent className="flex flex-col gap-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-8">
            <ScoreRing label="ICP fit" score={account.icpScore == null ? null : Math.round(account.icpScore)} />
            <ScoreRing label="Timing" score={account.timingScore == null ? null : Math.round(account.timingScore)} />
          </div>
          <div className="space-y-1.5 sm:text-right">
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {account.hardExcluded ? (
                <Badge variant="destructive">Hard excluded</Badge>
              ) : account.icpScore == null ? (
                <Badge variant="secondary">Not researched</Badge>
              ) : isTarget ? (
                <Badge variant="default">Target account</Badge>
              ) : (
                <Badge variant="outline">Below ICP threshold</Badge>
              )}
              <span className="text-sm text-muted-foreground">
                {qualifiedCount} of {account.prospects.length} {account.prospects.length === 1 ? "prospect" : "prospects"} qualified
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Fit gates. Timing ranks.</p>
            {account.reviewReason ? (
              <p className="max-w-md text-xs text-muted-foreground">{account.reviewReason}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Research findings — two balanced columns of similar height. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Company fit</CardTitle>
            <CardDescription>What research found for each ICP dimension, and how well it matches your ideal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {account.icpObservations.length > 0 ? (
              account.icpObservations.map((observation) => (
                <ObservationBlock key={observation.dimensionKey} observation={observation} />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Not researched yet — run Research account.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timing signals</CardTitle>
            <CardDescription>Dated buying-window signals, decayed by recency.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {account.timingSignals.length > 0 ? (
              account.timingSignals.map((entry) => (
                <TimingSignalBlock key={entry.dimensionKey} entry={entry} />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No timing signals found yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {showResearchSurface && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="size-4" /> Live research
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DimensionResearchSurface
              dimensions={research.dimensions}
              entityName={account.name}
              isStreaming={research.isStreaming}
            />
          </CardContent>
        </Card>
      )}

      <AccountProspectsSection
        accountId={account.id}
        accountName={account.name}
        onRefresh={() => void loadAccount({ silent: true })}
        prospects={account.prospects}
      />
    </div>
  );
}
