"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Target, User } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreRing } from "@/components/genui";
import { ListRow, ListRows } from "@/components/ListRow";
import { PageHeader } from "@/components/PageHeader";

type DimensionMatch = {
  dimensionKey: string;
  matchScore: number;
  effectiveMatch: number;
  classification: string;
  hardExclusion: boolean;
  confidence: number;
};
type TimingBreakdown = { dimensionKey: string; dimensionValue: number; signalCount: number };
type AccountProspect = {
  id: string;
  name: string;
  title?: string;
  status: string;
  personaScore: number | null;
  qualificationStatus: string | null;
};
type AccountDetail = {
  id: string;
  name: string;
  createdAt: string;
  icpScore: number | null;
  timingScore: number | null;
  icpMatches: DimensionMatch[];
  timingBreakdown: TimingBreakdown[];
  prospects: AccountProspect[];
};

const QUALIFICATION_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  QUALIFIED: { label: "Qualified", variant: "default" },
  CONTACT_DISCOVERY_REQUIRED: { label: "Find another contact", variant: "outline" },
  REVIEW: { label: "Needs review", variant: "secondary" },
  HARD_EXCLUDED: { label: "Hard excluded", variant: "destructive" },
  UNQUALIFIED: { label: "Unqualified", variant: "secondary" },
};

function formatDimensionKey(key: string): string {
  return key.replaceAll("_", " ");
}

function MatchRow({ match }: { match: DimensionMatch }) {
  const percent = Math.round(match.effectiveMatch * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="capitalize text-muted-foreground">{formatDimensionKey(match.dimensionKey)}</span>
        <span className="font-medium tabular-nums">{percent}</span>
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

function AccountDetailSkeleton() {
  return (
    <div className="w-full min-w-0 space-y-8">
      <div>
        <Skeleton className="mb-4 h-5 w-28" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}

export default function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch(`/api/outreach/accounts/${id}`)
      .then(async (response) => {
        if (response.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        if (!response.ok) throw new Error("Failed to fetch account");
        return response.json();
      })
      .then((data) => {
        if (cancelled || !data) return;
        setAccount(data);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error fetching account:", error);
        toast.error("Could not load this account — refresh to try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

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
          actions={isTarget ? <Badge variant="default">Target account</Badge> : undefined}
          description="Company fit and buying-window timing. Fit gates. Timing ranks."
          title={account.name}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="size-4" /> Account scores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              <ScoreRing label="ICP" score={account.icpScore == null ? null : Math.round(account.icpScore)} />
              <ScoreRing label="Timing" score={account.timingScore == null ? null : Math.round(account.timingScore)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Company fit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {account.icpMatches.length > 0 ? (
              account.icpMatches.map((match) => <MatchRow key={match.dimensionKey} match={match} />)
            ) : (
              <p className="text-sm text-muted-foreground">Not scored yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timing signals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {account.timingBreakdown.length > 0 ? (
              account.timingBreakdown.map((entry) => (
                <div key={entry.dimensionKey} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="capitalize text-muted-foreground">{formatDimensionKey(entry.dimensionKey)}</span>
                    <span className="font-medium tabular-nums">
                      {entry.signalCount} {entry.signalCount === 1 ? "signal" : "signals"}
                    </span>
                  </div>
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-chart-1 transition-all duration-500"
                      style={{ width: `${Math.round(entry.dimensionValue * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No timing signals found yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          <div className="border-b px-6 py-4">
            <h2 className="text-sm font-medium">
              Prospects ({account.prospects.length})
            </h2>
            <p className="text-sm text-muted-foreground">People found at this account.</p>
          </div>
          {account.prospects.length > 0 ? (
            <ListRows>
              {account.prospects.map((prospect) => {
                const qualification = prospect.qualificationStatus
                  ? QUALIFICATION_BADGE[prospect.qualificationStatus]
                  : null;
                return (
                  <ListRow
                    badge={qualification ? <Badge variant={qualification.variant}>{qualification.label}</Badge> : undefined}
                    href={`/outreach/prospects/${prospect.id}`}
                    key={prospect.id}
                    leading={
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        <User className="size-4" />
                      </span>
                    }
                    meta={[
                      prospect.title || "Prospect",
                      `Persona ${prospect.personaScore == null ? "not scored" : Math.round(prospect.personaScore)}`,
                    ]}
                    title={prospect.name}
                  />
                );
              })}
            </ListRows>
          ) : (
            <div className="grid justify-items-center gap-3 px-6 py-12 text-center">
              <User className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No prospects at this account yet.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
