"use client";

import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentMeter } from "@/components/genui";
import { icpBand, timingBand, type ScoreBand } from "@/lib/score-bands";
import { DimensionResearchSurface } from "../research/DimensionResearchSurface";
import type { DimensionLane } from "../research/useDimensionResearch";

/** The account summary as seen from a prospect — mirrors AccountForProspect. */
export interface CompanySummary {
  id: string;
  name: string;
  prospectCount: number;
  qualifiedCount: number;
  icpScore: number | null;
  timingScore: number | null;
  isTarget: boolean;
  hardExcluded: boolean;
}

function ScoreCell({
  label,
  score,
  band,
  excluded,
}: {
  label: string;
  score: number | null;
  band: ScoreBand;
  excluded?: boolean;
}) {
  const value = score == null ? null : Math.round(score);
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          {label}
        </span>
        <Badge className="px-1.5 py-0 text-[10px]" variant={band.variant}>
          {band.label}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <SegmentMeter excluded={excluded} fraction={value == null ? null : value / 100} />
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {value == null ? "–" : value}
        </span>
      </div>
    </div>
  );
}

/**
 * A company bar for the prospect page: the person belongs to a company, and
 * whether that company is worth pursuing (ICP fit) and worth pursuing *now*
 * (timing) is decided at the account level. This surfaces that verdict inline —
 * fit, timing, and target status — with a link to the account, so you rarely
 * need to leave the prospect to know the company situation.
 */
export function CompanySummaryBar({
  account,
  isLoading,
  companyName,
  researchDimensions = [],
  isResearching = false,
}: {
  account: CompanySummary | null;
  isLoading: boolean;
  /** Fallback name when the prospect has a company but no resolved account yet. */
  companyName?: string;
  /** Account research lanes, cascaded from prospect research (scope: 'account'). */
  researchDimensions?: DimensionLane[];
  /** Whether the prospect research (which cascades to the company) is streaming. */
  isResearching?: boolean;
}) {
  // The company's research fills in on this card — no need to open the account.
  const showResearch = isResearching || researchDimensions.length > 0;
  const research = showResearch ? (
    <div className="border-t px-4 py-3">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        Company research
      </p>
      <DimensionResearchSurface
        dimensions={researchDimensions}
        entityName={account?.name ?? companyName ?? "company"}
        isStreaming={isResearching}
      />
    </div>
  ) : null;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          <Skeleton className="size-10 rounded-xl" />
          <Skeleton className="h-4 w-40" />
          <div className="ml-auto flex gap-6">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-28" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!account) {
    if (!companyName) return null;
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Building2 className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{companyName}</p>
            <p className="text-xs text-muted-foreground">
              {showResearch
                ? "Researching this company…"
                : "Not researched yet — researching a prospect researches the company too."}
            </p>
          </div>
        </CardContent>
        {research}
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{account.name}</span>
              {account.hardExcluded ? (
                <Badge variant="destructive">Excluded</Badge>
              ) : account.isTarget ? (
                <Badge>Target</Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {account.qualifiedCount} of {account.prospectCount}{" "}
              {account.prospectCount === 1 ? "prospect" : "prospects"} qualified
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6 lg:gap-8">
          <ScoreCell
            band={icpBand(account.icpScore, account.hardExcluded)}
            excluded={account.hardExcluded}
            label="ICP fit"
            score={account.icpScore}
          />
          <ScoreCell band={timingBand(account.timingScore)} label="Timing" score={account.timingScore} />
        </div>

        <Button asChild size="sm" variant="outline">
          <Link href={`/outreach/accounts/${account.id}`}>
            View account
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </CardContent>
      {research}
    </Card>
  );
}
